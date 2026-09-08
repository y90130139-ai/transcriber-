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

/** Objects whose row is already gone — a deleted plan, item or model. */
export async function orphanedKeys(): Promise<string[]> {
  const rows = await sql.query(
    `select key from transcriber.r2_trash order by created_at limit ${DELETE_BATCH}`,
  )
  return rows.map((row) => String(row.key))
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
