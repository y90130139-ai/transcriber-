/**
 * Repurpose one of her reels (Geno, 2026-09-27): a reel of hers that did well
 * goes back on her week as a Repurpose card marked "needs repurposing" — we
 * download it, run it through the batcher, send the fresh file back in her
 * group, and she posts it again. Ticking "Repurposed" in the plan editor tells
 * her card it is ready.
 *
 * Works from Scout's copy of the reel (the Analytics tab) as well as from the
 * library: a reel not yet in the library is queued for the Mac, the same way
 * her winners are (lib/hers.ts), so the card has a job to point at.
 */
import { nanoid } from 'nanoid'
import { sql } from './db'
import { jobsForPosts } from './hers'
import { normalizeUrl } from './links'
import { linksFor, mediaBase } from './media'
import { appendItems } from './models'
import { recreateTarget } from './week-target'

export const REPURPOSE_HOLD = 'We refresh this one and send it to you in your group chat. Post it again this week.'

type Result =
  | { error: string; status: number }
  | { added: number; week_of: string; plan_id: string; download: string | null; note: string | null }

/** The job for a reel, by shortcode — found in the library, or queued now. */
async function jobFor(modelId: string, code: string, handle: string | null): Promise<string> {
  const found = (await jobsForPosts([code])).get(code)
  if (found) return found
  const url = `https://www.instagram.com/reel/${code}/`
  const [row] = await sql.query(
    `insert into transcriber.jobs (id, kind, source, source_key, label, batch_id, transcribe)
     values ($1, 'link', $2, $3, $4, $5, true)
     on conflict (source_key) do update set source_key = excluded.source_key
     returning id`,
    [nanoid(12), url, normalizeUrl(url), `Repurpose · @${handle ?? 'hers'}`.slice(0, 80), `hers-${modelId}`],
  )
  return String(row.id)
}

/** A file to download right now: Instagram's own link while it lives, else
 *  the Mac's copy once it has one. Null means "the Mac is fetching it". */
async function downloadFor(code: string, jobId: string): Promise<string | null> {
  const [post] = await sql.query(
    `select case when media_until > now() then video_url end as video_url
       from transcriber.creator_posts where post_id = $1`,
    [code],
  )
  if (post?.video_url) return String(post.video_url)
  const [t] = await sql.query(`select folder from transcriber.transcripts where job_id = $1`, [jobId])
  const base = t?.folder ? await mediaBase() : null
  return base && t?.folder ? linksFor(base, String(t.folder)).download : null
}

export async function repurposeReel(modelId: string, code: string, askedPlan: unknown): Promise<Result> {
  const [post] = await sql.query(`select handle from transcriber.creator_posts where post_id = $1`, [code])
  const target = await recreateTarget(modelId, askedPlan)
  if ('error' in target) return target
  const jobId = await jobFor(modelId, code, post?.handle ? String(post.handle) : null)
  const added = await appendItems(target.planId, modelId, [jobId], () => ({
    bucket: 'repurpose',
    axis: null,
    source_post: code,
    source_url: `https://www.instagram.com/reel/${code}/`,
    hold: REPURPOSE_HOLD,
  }))
  const download = await downloadFor(code, jobId)
  return {
    added,
    week_of: target.weekOf,
    plan_id: target.planId,
    download,
    note: download ? null : 'The Mac is fetching the video — download it from the library once it lands.',
  }
}
