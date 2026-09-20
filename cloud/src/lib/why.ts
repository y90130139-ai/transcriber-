/**
 * "Why it worked" — the measured reasons behind a library winner.
 *
 * Every threshold is a named constant, measured on the 405 library items the
 * sweep has data for (2026-09-20), so a wrong call is a number to change:
 *
 *   sound   2+ watched creators on the same non-original sound within ±14
 *           days. Fires on 17 of 405 — rare, and meaningful when it does.
 *           Same bar `risingSounds` uses, so the two can never disagree.
 *   run     2+ of her other reels past 3× her median in the 7 days before.
 *           Fires on 151 of 405: winners cluster, and a reel that landed
 *           while the account was hot owes some of it to the account.
 *   format  2+ more of her library reels in the same format. Formats that sit on
 *           more than a third of the whole library (text-overlay,
 *           thirst-trap) are styles, not formats, and are left out.
 *   shared  1.8+ shares per 1,000 plays: p90 of 2,458 swept reels over 1k
 *           plays. Shares are `media_repost_count`, public for every reel.
 *   new     none of the above, on a post the sweep actually measured.
 *
 * Only a post at 2×+ her median plays gets reasons at all: the creator sheet
 * lists every post, flops included, and a streak does not explain a flop.
 * The multiple uses the sweep's baseline (`candidates()` in scout.ts: 120 days
 * of every post, not just kept ones), so it matches the number a pick was made
 * on. Library items the sweep never saw (or saw without plays) get format
 * reasons only, and are never called "new concept" — absence of data is not
 * evidence of novelty.
 */
import { sql } from './db'
import { BASELINE_DAYS, MIN_BASELINE_REELS } from './scout'
import type { Reason, Why } from './reasons'

/** Reasons are only given for a post that beat her normal. Below this multiple
 *  of her median plays there is nothing to explain — a streak does not
 *  explain a flop. */
export const WORKED_MIN_MULTIPLE = 2
export const SOUND_MIN_CREATORS = 2
export const SOUND_WINDOW_DAYS = 14
export const RUN_MULTIPLE = 3
export const RUN_MIN_HITS = 2
export const RUN_WINDOW_DAYS = 7
export const FORMAT_MIN_PRIOR = 2
/** A format on more than this share of the library is a style. */
export const FORMAT_GENERIC_SHARE = 1 / 3
export const SHARE_PER_1K = 1.8
/** Below this, a share rate is two shares and a rounding error. */
export const SHARE_MIN_PLAYS = 1000

/** Reasons for each of `jobIds`, keyed by job id. One query, any size. */
export async function whyItWorked(jobIds: string[]): Promise<Map<string, Why>> {
  const out = new Map<string, Why>()
  if (jobIds.length === 0) return out

  const rows = await sql.query(
    `with lib as (
       select t.job_id, t.author, s.post_id, s.handle, s.posted_at, s.plays,
              s.audio_id, s.audio_title, s.original_audio, p.reposts
         from transcriber.transcripts t
         left join transcriber.sightings s on s.post_id = t.post_id
         left join transcriber.creator_posts p on p.post_id = t.post_id
        where t.job_id = any($1::text[])
     ),
     base as (
       select handle, percentile_cont(0.5) within group (order by plays) as med
         from transcriber.sightings
        where plays is not null and not pinned
          and posted_at >= now() - ($2 || ' days')::interval
          and handle in (select handle from lib where handle is not null)
        group by handle
       having count(*) >= $3
     ),
     generic as (
       select g.tag
         from transcriber.tags g
        where g.axis = 'format'
        group by g.tag
       having count(*) > $4::float * (select count(*) from transcriber.transcripts)
     )
     select l.job_id,
            (l.plays is not null and b.med > 0) as measured,
            round((l.plays / nullif(b.med, 0))::numeric, 2)::float as multiple,
            l.audio_title,
            l.plays,
            l.reposts,
            case when l.audio_id is not null and l.original_audio is not true then (
              select count(distinct s2.handle)::int
                from transcriber.sightings s2
               where s2.audio_id = l.audio_id
                 and s2.posted_at between l.posted_at - ($5 || ' days')::interval
                                      and l.posted_at + ($5 || ' days')::interval
            ) end as sound_creators,
            case when b.med > 0 then (
              select count(*)::int
                from transcriber.sightings s2
               where s2.handle = l.handle and s2.post_id <> l.post_id
                 and s2.posted_at >= l.posted_at - ($6 || ' days')::interval
                 and s2.posted_at < l.posted_at
                 and s2.plays >= $7::float * b.med
            ) end as run_hits,
            f.tag as format, f.prior as format_prior
       from lib l
       left join base b on b.handle = l.handle
       left join lateral (
         select a.tag, count(*)::int as prior
           from transcriber.tags a
           join transcriber.tags o on o.axis = 'format' and o.tag = a.tag and o.job_id <> a.job_id
           join transcriber.transcripts t2 on t2.job_id = o.job_id and t2.author = l.author
          where a.job_id = l.job_id and a.axis = 'format'
            and a.tag not in (select tag from generic)
          group by a.tag
         having count(*) >= $8
          order by count(*) desc, a.tag
          limit 1
       ) f on true`,
    [
      jobIds,
      String(BASELINE_DAYS),
      MIN_BASELINE_REELS,
      FORMAT_GENERIC_SHARE,
      String(SOUND_WINDOW_DAYS),
      String(RUN_WINDOW_DAYS),
      RUN_MULTIPLE,
      FORMAT_MIN_PRIOR,
    ],
  )

  for (const row of rows) {
    const multiple = num(row.multiple)
    const measured = Boolean(row.measured)
    if (multiple !== null && multiple < WORKED_MIN_MULTIPLE) {
      out.set(String(row.job_id), { multiple, reasons: [], measured })
      continue
    }
    const reasons: Reason[] = []
    const sound = num(row.sound_creators)
    if (sound !== null && sound >= SOUND_MIN_CREATORS && row.audio_title) {
      reasons.push({ kind: 'sound', title: String(row.audio_title), creators: sound })
    }
    if (row.format) {
      reasons.push({ kind: 'format', format: String(row.format), times: Number(row.format_prior) })
    }
    // bigint arrives as a string; coerce before any arithmetic.
    const plays = num(row.plays)
    const reposts = num(row.reposts)
    if (plays !== null && reposts !== null && plays >= SHARE_MIN_PLAYS) {
      const per1k = Math.round((reposts / plays) * 10_000) / 10
      if (per1k >= SHARE_PER_1K) reasons.push({ kind: 'shared', per1k })
    }
    // Last, because it is the commonest: the rarer a reason, the more it says.
    const hits = num(row.run_hits)
    if (hits !== null && hits >= RUN_MIN_HITS) reasons.push({ kind: 'run', hits })
    if (measured && reasons.length === 0) reasons.push({ kind: 'new' })
    out.set(String(row.job_id), { multiple, reasons, measured })
  }
  return out
}

function num(value: unknown): number | null {
  if (value === null || value === undefined) return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}
