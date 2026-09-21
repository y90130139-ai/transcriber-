/**
 * Ingesting her own winners, so a reskin card has something to point at.
 *
 * A plan item points at a library job and inherits the link, the transcript,
 * the tags, the engagement and the playable video from it. Her own posts live
 * in `creator_posts` — counts and a shortcode, no video, no words. That is
 * enough to *grade* a winner and not nearly enough to *brief* one: "recreate
 * this" with no clip to rewatch and no record of what she said is the kind of
 * card that comes back filmed wrong.
 *
 * So her winners go through the same pipe every library item goes through.
 * Nothing new is built: a row in `jobs` with her post's URL, and the Mac does
 * the rest — fetch, transcribe, OCR, tag. What comes back is her own hook line
 * in her own words, which is exactly what the ladder needs to say "same
 * opening, new outfit".
 *
 * Only winners and iterations are ingested. The rest of her feed is not worth
 * a download, and Whisper's free tier is shared with the failover path.
 */
import { nanoid } from 'nanoid'
import { sql } from './db'
import { bankFor, type BankPost } from './bank'
import { normalizeUrl } from './links'

/** Her own work, marked as such — the library shows the label on the card. */
const LABEL = 'hers'

export type Ingested = {
  model_id: string
  name: string
  considered: number
  queued: number
  already: number
}

/**
 * Queue her graded posts for the full pipeline.
 *
 * Idempotent by construction: `jobs.source_key` is unique, so a second run
 * adds nothing. `transcribe` is true — unlike the metadata-only ingest of her
 * feed, a winner is being reskinned and her words are the thing being kept.
 */
export async function ingestHers(modelId: string, limit = 12): Promise<Ingested | null> {
  const bank = await bankFor(modelId)
  if (!bank) return null

  // Winners first: they are what the 70% is built from, and the cap is a
  // budget, not a preference.
  const posts = [...bank.winners, ...bank.iterations].slice(0, limit)
  if (posts.length === 0) {
    return { model_id: bank.model_id, name: bank.name, considered: 0, queued: 0, already: 0 }
  }

  const rows = posts.map((post) => ({
    id: nanoid(12),
    url: post.url,
    key: normalizeUrl(post.url),
    label: labelFor(post),
  }))

  const added = await sql.query(
    `insert into transcriber.jobs (id, kind, source, source_key, label, batch_id, transcribe)
     select * from unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::text[],
                          $6::text[], $7::boolean[])
     on conflict (source_key) do nothing
     returning id`,
    [
      rows.map((row) => row.id),
      rows.map(() => 'link'),
      rows.map((row) => row.url),
      rows.map((row) => row.key),
      rows.map((row) => row.label),
      rows.map(() => `hers-${modelId}`),
      rows.map(() => true),
    ],
  )

  return {
    model_id: bank.model_id,
    name: bank.name,
    considered: posts.length,
    queued: added.length,
    already: posts.length - added.length,
  }
}

/** What the queue and the library show: whose it is, and why it is here. */
function labelFor(post: BankPost): string {
  const multiple = post.multiple >= 10 ? Math.round(post.multiple) : post.multiple.toFixed(1)
  return `${LABEL} · ${multiple}× @${post.handle}`.slice(0, 80)
}

/**
 * The job rows already ingested for her posts, keyed by shortcode.
 *
 * Two ways in, because a post can reach the library by either and only one of
 * them fills `transcripts.post_id`: her own ingest here, or the scout picking
 * her reel off the watchlist when her account is also being researched (which
 * happens — her handles are on it). Matching on `post_id` alone missed the
 * second, measured on Milky Sins: two winners, one match.
 *
 * The shortcode is matched against the job's source URL rather than pattern-
 * matched out of it: the URL is the thing the job was keyed on, and a
 * shortcode is unique enough that a containment test cannot collide.
 */
export async function jobsForPosts(postIds: string[]): Promise<Map<string, string>> {
  if (postIds.length === 0) return new Map()
  const rows = await sql.query(
    `select x.code, coalesce(t.job_id, j.id) as job_id
       from unnest($1::text[]) as x(code)
       left join transcriber.transcripts t on t.post_id = x.code
       left join transcriber.jobs j
              on j.source like '%' || x.code || '%'
             and j.status <> 'failed'
      where coalesce(t.job_id, j.id) is not null`,
    [postIds],
  )
  return new Map(rows.map((row) => [String(row.code), String(row.job_id)]))
}

/**
 * Her posts the Mac tried and could not fetch, and never transcribed.
 *
 * Measured 2026-09-21: 12 of 62 failed — age-gated, or an empty media
 * response — and the cookies retry was refused the same way. Until the next
 * roster pass brings a direct link (`requeueWithFreshLinks`), re-queuing
 * changes nothing. A failed job was still matched by
 * `jobsForPosts`, which turned her 908× winner into five cards pointing at a
 * video that never arrived. The planner passes these over instead.
 */
export async function unfetchable(postIds: string[]): Promise<Set<string>> {
  if (postIds.length === 0) return new Set()
  const rows = await sql.query(
    `select x.code
       from unnest($1::text[]) as x(code)
      where exists (select 1 from transcriber.jobs j
                     where j.source like '%' || x.code || '%' and j.status = 'failed')
        and not exists (select 1 from transcriber.jobs j
                         where j.source like '%' || x.code || '%' and j.status <> 'failed')
        and not exists (select 1 from transcriber.transcripts t where t.post_id = x.code)`,
    [postIds],
  )
  return new Set(rows.map((row) => String(row.code)))
}

/**
 * Put her failed downloads back in the queue once a fresh link exists for them.
 *
 * Runs whenever the roster pass stores her posts, because that pass is what
 * reads the CDN links a failed winner needs. Nobody has to notice the failure
 * or press retry: the next pass heals it. The retry budget resets because the
 * thing that failed — resolving the page — is no longer what will be tried.
 */
export async function requeueWithFreshLinks(): Promise<number> {
  const rows = await sql.query(
    `update transcriber.jobs j
        set status = 'queued', error = null, stage = null, attempts = 0,
            claimed_at = null, updated_at = now()
      where j.status = 'failed'
        and j.error like 'could not download%'
        and exists (select 1 from transcriber.creator_posts cp
                     where j.source like '%/' || cp.post_id || '/%'
                       and cp.video_url is not null and cp.media_until > now())
      returning j.id`,
  )
  return rows.length
}
