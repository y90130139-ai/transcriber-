/** What the Mac owes R2, and what R2 owes back.
 *
 * The worker uploads, not the app. The Mac already has the file, and routing
 * ten megabytes through a Vercel function is exactly the cap that forced phone
 * uploads to go browser-direct to Blob in the first place. So the app keeps the
 * list and the Mac does the bytes, on the same poll it already makes for jobs.
 */
import { sql } from './db'
import { r2KeyFor } from './r2'

/** A plan's videos are reclaimed once its week is this far behind. Three active
 *  models at a time is then about 720 MB, permanently inside R2's free tier. */
export const R2_RETENTION_DAYS = 21

/** Few enough that a poll stays quick; the queue drains over a minute or two. */
const UPLOAD_BATCH = 3
const DELETE_BATCH = 20

export type PendingUpload = { id: string; folder: string; key: string }

/** Items on a live plan whose video is not in R2 yet. */
export async function pendingUploads(): Promise<PendingUpload[]> {
  const rows = await sql.query(
    `select i.id, i.plan_id, i.job_id, t.folder
       from transcriber.plan_items i
       join transcriber.plans p on p.id = i.plan_id
       join transcriber.transcripts t on t.job_id = i.job_id
      where i.uploaded_at is null
        and i.r2_purged_at is null
        and t.folder is not null
        and p.week_of >= current_date - interval '${R2_RETENTION_DAYS} days'
      order by p.week_of desc, i.position
      limit ${UPLOAD_BATCH}`,
  )
  return rows.map((row) => ({
    id: String(row.id),
    folder: String(row.folder),
    key: r2KeyFor(String(row.plan_id), String(row.job_id)),
  }))
}

/** Objects whose week has closed. Retention is what keeps this free forever. */
export async function expiredObjects(): Promise<{ id: string; key: string }[]> {
  const rows = await sql.query(
    `select i.id, i.r2_key
       from transcriber.plan_items i
       join transcriber.plans p on p.id = i.plan_id
      where i.r2_key is not null
        and p.week_of < current_date - interval '${R2_RETENTION_DAYS} days'
      limit ${DELETE_BATCH}`,
  )
  return rows.map((row) => ({ id: String(row.id), key: String(row.r2_key) }))
}

/** Objects whose row is already gone — a deleted plan, item or model.
 *
 *  This list is only ever as complete as the delete routes that fill it. What
 *  finds the rest is `reconcileBucket` below. */
export async function orphanedKeys(): Promise<string[]> {
  const rows = await sql.query(
    `select key from transcriber.r2_trash order by created_at limit ${DELETE_BATCH}`,
  )
  return rows.map((row) => String(row.key))
}

/** An object younger than this is left alone by the reconcile in both
 *  directions. The Mac uploads and *then* reports, so an object put a second
 *  ago is legitimately in the bucket and not yet on any row; and a row stamped
 *  a second ago may not be in a listing yet. Either race, read literally,
 *  deletes a live video. */
const RECONCILE_GRACE_MINUTES = 60

/** How many strays one pass may queue. A reconcile that suddenly wants to
 *  delete a thousand objects is a bug in this file, not a thousand orphans,
 *  and the cap is what makes that survivable. */
const RECONCILE_MAX = 500

export type BucketObject = { key: string; modified: string | null }

export type Reconciliation = {
  listed: number
  /** Keys in the bucket that no row and no trash entry accounts for, now
   *  queued for the Mac to reclaim. */
  queued: number
  /** Rows claiming an object the bucket does not have, re-queued for upload.
   *  The opposite hole, and the one a creator actually sees: an item shown as
   *  ready whose player is dead. */
  requeued: number
  skipped: number
}

/**
 * Compare the bucket against the ledger, in both directions.
 *
 * `orphanedKeys` above can only see what the app's own delete routes wrote
 * down. Anything removed another way — a row deleted straight in SQL, a plan
 * dropped by a cascade that predates `trashKeys`, a bug — leaves an object
 * that nothing will ever ask about again, and R2 bills for it forever.
 *
 * The Mac lists the bucket, because the Mac is the only side holding
 * credentials that can. This is the ledger's answer: what to reclaim, and
 * what it thought was uploaded and is not.
 *
 * Deliberately queues rather than deletes. Everything found goes onto the same
 * `r2_trash` list the delete routes use and is reclaimed by the same batched
 * path on a later poll, so there is exactly one way an object leaves R2.
 */
export async function reconcileBucket(objects: BucketObject[]): Promise<Reconciliation> {
  const cutoff = Date.now() - RECONCILE_GRACE_MINUTES * 60_000
  const settled = objects.filter((object) => {
    const at = object.modified ? Date.parse(object.modified) : Number.NaN
    return Number.isFinite(at) && at < cutoff
  })

  const keys = settled.map((object) => object.key)
  const present = new Set(objects.map((object) => object.key))

  const strays = keys.length === 0 ? [] : await sql.query(
    `select k as key from unnest($1::text[]) k
      where not exists (select 1 from transcriber.plan_items i where i.r2_key = k)
        and not exists (select 1 from transcriber.r2_trash t where t.key = k)
      limit ${RECONCILE_MAX}`,
    [keys],
  )

  if (strays.length > 0) {
    await sql.query(
      `insert into transcriber.r2_trash (key)
       select unnest($1::text[]) on conflict (key) do nothing`,
      [strays.map((row) => String(row.key))],
    )
  }

  // The other direction. Only rows old enough to have settled, and only inside
  // retention — an object outside it is on its way to being reclaimed anyway.
  const claimed = await sql.query(
    `select i.id, i.r2_key
       from transcriber.plan_items i
       join transcriber.plans p on p.id = i.plan_id
      where i.r2_key is not null
        and i.uploaded_at < now() - interval '${RECONCILE_GRACE_MINUTES} minutes'
        and p.week_of >= current_date - interval '${R2_RETENTION_DAYS} days'`,
  )
  const missing = claimed
    .filter((row) => !present.has(String(row.r2_key)))
    .map((row) => String(row.id))
    .slice(0, RECONCILE_MAX)

  if (missing.length > 0) {
    // Not `recordPurged`: purged means retention took it and it must not come
    // back. This one should come back, so the row goes to plain un-uploaded
    // and `pendingUploads` finds it on the next poll.
    await sql.query(
      `update transcriber.plan_items
          set r2_key = null, r2_bytes = null, uploaded_at = null
        where id = any($1::text[])`,
      [missing],
    )
  }

  return {
    listed: objects.length,
    queued: strays.length,
    requeued: missing.length,
    skipped: objects.length - settled.length,
  }
}

export async function recordUploaded(id: string, key: string, bytes: number | null): Promise<void> {
  await sql.query(
    `update transcriber.plan_items
        set r2_key = $2, r2_bytes = $3, uploaded_at = now(), r2_purged_at = null
      where id = $1`,
    [id, key, bytes],
  )
}

/** Purged, not merely un-uploaded: without the stamp the very next poll would
 *  queue the same object for re-upload and the retention rule would loop. */
export async function recordPurged(ids: string[]): Promise<void> {
  if (ids.length === 0) return
  await sql.query(
    `update transcriber.plan_items
        set r2_key = null, r2_bytes = null, uploaded_at = null, r2_purged_at = now()
      where id = any($1::text[])`,
    [ids],
  )
}

export async function clearTrash(keys: string[]): Promise<void> {
  if (keys.length === 0) return
  await sql.query(`delete from transcriber.r2_trash where key = any($1::text[])`, [keys])
}
