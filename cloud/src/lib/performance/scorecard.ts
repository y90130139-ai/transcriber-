/**
 * Her weekly scorecard (Geno, 2026-09-27): a picture of her own numbers,
 * sent to her by the Gosian bot every Monday at 11:00 ET — followers and
 * growth, views, posting, the audience line, which way she is trending, and
 * one plain next step. Down weeks are said honestly, framed as what to do.
 */
import { sql } from '../db'
import { loadBoard } from './load'
import { addDays, eastern } from './shoutouts'
import type { Direction } from './math'

export type Scorecard = {
  name: string
  photo_url: string | null
  handle: string | null
  followers: number | null
  followers_gain: number | null
  views: number
  reels_per_week: number
  story_days: number
  story_days_observed: number
  trend: Direction | null
  series: number[]
  next_step: string
  week_label: string
}

/** One next step, in "you" words. The same judgement as the dashboard's tag. */
export function nextStep(trend: Direction | null, reelsPerWeek: number, weeklyTarget: number, viewsChange: number | null): string {
  const aim = Math.max(5, Math.ceil((weeklyTarget || 21) / 3))
  if (trend === 'down') {
    if (reelsPerWeek < aim) return `Post more consistently this week — you're at ${reelsPerWeek} reels a week, aim for ${aim}+.`
    if (viewsChange !== null && viewsChange < 0) return 'Views dipped on your latest reels — open with your strongest second: start mid-moment, no intro.'
    return 'A slower week — post every day this week and try one new hook.'
  }
  if (trend === 'up') return "You're growing — keep posting like this and repeat what worked in your top reels."
  if (trend === 'flat') return reelsPerWeek < aim
    ? `Steady — to push it up, post more: ${aim}+ reels this week.`
    : 'Steady — try one new hook this week to get things moving.'
  return 'Keep posting — your trend shows once there are a few more reels to read.'
}

export async function scorecardFor(modelId: string, now = Date.now()): Promise<Scorecard | null> {
  const board = await loadBoard(7, modelId, now)
  const m = board.models[0]
  if (!m) return null
  const [row] = await sql.query(`select weekly_target from transcriber.models where id = $1`, [modelId])
  const et = eastern(now)
  const monday = addDays(et.date, -((et.weekday + 6) % 7))
  return {
    name: m.name,
    photo_url: m.photo_url,
    handle: m.handles[0] ?? null,
    followers: m.followers,
    followers_gain: m.followers_gain,
    views: m.views_period,
    reels_per_week: m.reels_per_week,
    story_days: m.story_days,
    story_days_observed: m.story_days_observed,
    trend: m.trend,
    series: m.followers_spark,
    next_step: nextStep(m.trend, m.reels_per_week, Number(row?.weekly_target) || 21, m.views_change),
    week_label: `Week of ${addDays(monday, -7)}`,
  }
}

/** Monday 11:00 ET through Tuesday: last week's card is due. Linked models
 *  with Instagram readings only; each week once (the scorecards table). */
export async function dueScorecards(origin: string, now = Date.now()) {
  const et = eastern(now)
  if (!((et.weekday === 1 && et.hour >= 11) || et.weekday === 2)) return []
  const monday = addDays(et.date, -((et.weekday + 6) % 7))
  const rows = await sql.query(
    `select m.id, m.name, m.telegram_chat_id, m.access_token
       from transcriber.models m
      where m.status = 'active' and m.telegram_chat_id is not null and m.token_revoked_at is null
        and not exists (select 1 from transcriber.scorecards s where s.model_id = m.id and s.week_of = $1::date)
        and exists (
          select 1 from transcriber.creator_snapshots c
           where c.handle = lower(ltrim(m.handle, '@')) and c.seen_at > now() - interval '8 days'
             -- An account reading under 50 followers is the wrong or an empty
             -- account on file (Ivy 0, Chelsea 5, Ria 23 on 2026-09-27) — a
             -- card saying so would help nobody.
             and c.followers >= 50)`,
    [monday],
  )
  return rows.map((r) => ({
    id: `c:${String(r.id)}:${monday}`,
    model_id: String(r.id),
    model_name: String(r.name),
    chat_id: String(r.telegram_chat_id),
    week_of: monday,
    image_url: `${origin}/api/plan/${String(r.access_token)}/scorecard?w=${monday}`,
  }))
}

export async function recordScorecard(id: string, modelId: string, weekOf: string, ok: boolean, error: string | null) {
  const rows = await sql.query(
    `insert into transcriber.scorecards (id, model_id, week_of, sent_at, error)
     values ($1, $2, $3::date, case when $4 then now() end, $5)
     on conflict (id) do nothing returning id`,
    [id, modelId, weekOf, ok, ok ? null : error],
  )
  return rows.length > 0
}
