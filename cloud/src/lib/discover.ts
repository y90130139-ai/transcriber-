/**
 * Discover: a model swiping through library reels picked for her
 * (Geno, 2026-10-06 — "kind of like Tinder... they could click certain
 * videos to their plans. We could get notified").
 *
 * The picks are `suggestionsFor` — the same engine the console's rail uses,
 * with the same guards (her won't-dos, topic gate, nothing already on a week,
 * nothing she declined, nothing a solo model can't film). This module only
 * remembers what she was shown and what she did with it:
 *
 *   served   dealt into her deck, not yet answered
 *   pass     swiped away — never dealt again
 *   star     saved to her shelf; OPS is told once, and she can put it on
 *            her own week from the shelf
 *
 * Stars feed the same taste scores her 👍 votes do (`TASTE` in match.ts), so
 * the deck sharpens as she uses it.
 */
import { sql } from './db'
import { linksFor, mediaBase } from './media'
import { suggestionsFor } from './match'
import { appendItems } from './models'
import { recreateTarget } from './week-target'

/** Cards in her deck at a time. Small on purpose: a 40-deep deck is a chore,
 *  a 10-deep one is a coffee break, and every refill re-ranks with her
 *  latest taste. */
const DECK = 10

export type DiscoverCard = {
  job_id: string
  preview: string | null
  duration_sec: number | null
  url: string | null
  formats: string[]
  has_thumb: boolean
  /** Signed link to the file on the Mac, while the Mac is awake — inline
   *  playback in the deck (Geno, 2026-10-07: watch it on the spot, sound
   *  and all, like the library). Null when the Mac sleeps; the card falls
   *  back to the Instagram link exactly as before. */
  video: string | null
  /** Only on starred rows: the plan item her star became, if she added it. */
  item_id?: string | null
  week_of?: string | null
}

async function detailsFor(jobIds: string[]): Promise<Map<string, DiscoverCard>> {
  if (jobIds.length === 0) return new Map()
  const rows = await sql.query(
    `select t.job_id, t.folder, t.webpage_url, t.duration_sec, (t.thumbnail is not null) as has_thumb,
            left(coalesce(nullif(t.on_screen_text, ''), t.plain), 160) as preview,
            coalesce((select array_agg(g.tag) from transcriber.tags g
                       where g.job_id = t.job_id and g.axis = 'format'), '{}') as formats
       from transcriber.transcripts t where t.job_id = any($1::text[])`,
    [jobIds],
  )
  const base = rows.some((row) => row.folder) ? await mediaBase() : null
  return new Map(rows.map((row) => [String(row.job_id), {
    job_id: String(row.job_id),
    preview: (row.preview as string | null)?.trim() || null,
    duration_sec: row.duration_sec === null ? null : Number(row.duration_sec),
    url: (row.webpage_url as string | null) ?? null,
    formats: Array.isArray(row.formats) ? (row.formats as string[]) : [],
    has_thumb: Boolean(row.has_thumb),
    video: base && row.folder ? linksFor(base, String(row.folder)).video : null,
  }]))
}

/** Her deck and her shelf. Tops the deck up from the engine, newest taste
 *  included, and remembers everything dealt so nothing repeats. */
export async function discoverFor(modelId: string): Promise<{ deck: DiscoverCard[]; starred: DiscoverCard[] }> {
  const seen = await sql.query(
    `select job_id, action, item_id from transcriber.discover where model_id = $1`,
    [modelId],
  )
  const dealt = new Set(seen.map((row) => String(row.job_id)))
  const waiting = seen.filter((row) => row.action === 'served').map((row) => String(row.job_id))

  const room = DECK - waiting.length
  const fresh: string[] = []
  if (room > 0) {
    // Head-room because everything already dealt still comes back ranked.
    const picks = await suggestionsFor(modelId, DECK + dealt.size > 40 ? 40 : DECK + dealt.size)
    for (const pick of picks) {
      const id = String(pick.id)
      if (dealt.has(id) || fresh.includes(id)) continue
      fresh.push(id)
      if (fresh.length >= room) break
    }
    if (fresh.length > 0) {
      await sql.query(
        `insert into transcriber.discover (model_id, job_id)
         select $1, unnest($2::text[]) on conflict do nothing`,
        [modelId, fresh],
      )
    }
  }

  const starredRows = seen.filter((row) => row.action === 'star')
  const details = await detailsFor([...waiting, ...fresh, ...starredRows.map((row) => String(row.job_id))])
  const itemOf = new Map(starredRows.map((row) => [String(row.job_id), row.item_id ? String(row.item_id) : null]))

  const deck = [...waiting, ...fresh].map((id) => details.get(id)).filter(Boolean) as DiscoverCard[]
  const starred = starredRows
    .map((row) => details.get(String(row.job_id)))
    .filter(Boolean)
    .map((card) => ({ ...card!, item_id: itemOf.get(card!.job_id) ?? null }))
  return { deck, starred }
}

/** Her answer on one card. Only cards that were dealt to her can be acted
 *  on — a job id from anywhere else changes nothing. */
export async function actOnCard(modelId: string, jobId: string, action: 'star' | 'pass'): Promise<boolean> {
  const rows = await sql.query(
    `update transcriber.discover
        set action = $3, acted_at = now()
      where model_id = $1 and job_id = $2
      returning job_id`,
    [modelId, jobId, action],
  )
  return rows.length > 0
}

/** Star → card on her own working week, through the same door the console's
 *  Recreate uses (declines and the solo rule re-checked inside). */
export async function addStarToWeek(modelId: string, jobId: string): Promise<
  { added: true; week_of: string } | { added: false; reason: string }
> {
  const [star] = await sql.query(
    `select item_id from transcriber.discover
      where model_id = $1 and job_id = $2 and action = 'star'`,
    [modelId, jobId],
  )
  if (!star) return { added: false, reason: 'Star it first.' }
  if (star.item_id) return { added: false, reason: 'Already on your week.' }

  const target = await recreateTarget(modelId, null)
  if ('error' in target) return { added: false, reason: String(target.error) }

  const added = await appendItems(target.planId, modelId, [jobId])
  if (added === 0) return { added: false, reason: 'This one cannot go on your week.' }

  const [item] = await sql.query(
    `select id from transcriber.plan_items
      where plan_id = $1 and job_id = $2 order by created_at desc limit 1`,
    [target.planId, jobId],
  )
  if (item) {
    await sql.query(
      `update transcriber.discover set item_id = $3
        where model_id = $1 and job_id = $2`,
      [modelId, jobId, String(item.id)],
    )
  }
  return { added: true, week_of: target.weekOf }
}

/** Whether this job was ever dealt to this model — the thumb route's gate. */
export async function wasDealt(modelId: string, jobId: string): Promise<boolean> {
  const rows = await sql.query(
    `select 1 from transcriber.discover where model_id = $1 and job_id = $2`,
    [modelId, jobId],
  )
  return rows.length > 0
}

const FRESH_HOURS = 72

/** Stars the bot has not told OPS about yet. Like questions: only recent
 *  ones, so a backfill never floods the group. */
export async function unrelayedStars() {
  return sql.query(
    `select d.model_id, d.job_id, m.name as model_name, t.webpage_url,
            left(coalesce(nullif(t.on_screen_text, ''), t.plain), 120) as preview
       from transcriber.discover d
       join transcriber.models m on m.id = d.model_id
       join transcriber.transcripts t on t.job_id = d.job_id
      where d.action = 'star' and d.relayed_at is null and d.relay_error is null
        and d.acted_at > now() - interval '${FRESH_HOURS} hours'
      order by d.acted_at
      limit 20`,
  )
}

export async function recordStarRelay(modelId: string, jobId: string, ok: boolean, error: string | null) {
  await sql.query(
    `update transcriber.discover
        set relayed_at = case when $3 then now() else relayed_at end,
            relay_error = case when $3 then null else $4 end
      where model_id = $1 and job_id = $2`,
    [modelId, jobId, ok, error],
  )
}
