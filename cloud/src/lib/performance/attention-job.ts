/**
 * Writing the week's Instagram cards out. The impure half of attention.ts,
 * kept apart so the thresholds and the wording stay testable without a
 * database.
 *
 * Her 30-day numbers decide the tag and the trend; her last 7 days decide the
 * stories. Last week's tag is read back from `model_standing` so "slipped from
 * Top performer" can be said at all — no single week's numbers show it.
 */
import { sql } from '../db'
import { loadBoard } from './load'
import { alert } from '../earnings/store'
import { eastern } from './shoutouts'
import { addDays } from '../dates'
import { igDigest, storyGoodNews, type IgStanding } from './attention'
import type { TagKey } from './math'

async function lastWeekTags(weekOf: string): Promise<Map<string, TagKey | null>> {
  const rows = await sql.query(
    `select model_id, auto_tag from transcriber.model_standing where week_of = $1::date`,
    [addDays(weekOf, -7)],
  )
  return new Map(rows.map((r) => [String(r.model_id), (r.auto_tag as TagKey | null) ?? null]))
}

async function rememberTags(weekOf: string, rows: { id: string; tag: TagKey | null; trend: string | null }[]) {
  for (const r of rows) {
    await sql.query(
      `insert into transcriber.model_standing (model_id, week_of, auto_tag, trend) values ($1, $2::date, $3, $4)
         on conflict (model_id, week_of) do update set auto_tag = excluded.auto_tag, trend = excluded.trend`,
      [r.id, weekOf, r.tag, r.trend],
    )
  }
}

export async function instagramAttentionAlerts(now = Date.now()) {
  const et = eastern(now)
  const monday = addDays(et.date, -((et.weekday + 6) % 7))
  const [month, week, was] = await Promise.all([loadBoard(30, undefined, now), loadBoard(7, undefined, now), lastWeekTags(monday)])
  const stories = new Map(week.models.map((m) => [m.id, m]))

  const standings: IgStanding[] = month.models
    .filter((m) => m.handles.length)
    .map((m) => {
      const w = stories.get(m.id)
      return {
        name: m.name,
        tag: m.auto_tag,
        wasTag: was.get(m.id) ?? null,
        trend: m.trend,
        reasons: m.attention_reasons,
        followersGain: m.followers_gain,
        viewsChange: m.views_change,
        reelsPerWeek: m.reels_per_week,
        storyDays: w?.story_days ?? 0,
        storyObserved: w?.story_days_observed ?? 0,
        lastPostedAt: m.last_posted_at,
      }
    })

  await rememberTags(monday, month.models.map((m) => ({ id: m.id, tag: m.auto_tag, trend: m.trend })))

  const cards = igDigest(standings, now)
  const good = storyGoodNews(standings)
  const body = [cards, good].filter(Boolean).join('\n\n')
  if (!body) return { week_of: monday, models: standings.length, sent: false }
  await alert(`ig:${monday}`, `📱 INSTAGRAM — WEEK OF ${monday}\n\n${body}`, 'social')
  return { week_of: monday, models: standings.length, sent: true }
}
