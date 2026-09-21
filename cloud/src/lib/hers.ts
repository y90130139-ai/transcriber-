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

/** The job rows already ingested for her posts, keyed by shortcode, so a card
 *  can be written against one. Her posts reach the library under her own
 *  handle, the same as any other author. */
export async function jobsForPosts(postIds: string[]): Promise<Map<string, string>> {
  if (postIds.length === 0) return new Map()
  const rows = await sql.query(
    `select t.post_id, t.job_id
       from transcriber.transcripts t
      where t.post_id = any($1::text[])`,
    [postIds],
  )
  return new Map(rows.map((row) => [String(row.post_id), String(row.job_id)]))
}
