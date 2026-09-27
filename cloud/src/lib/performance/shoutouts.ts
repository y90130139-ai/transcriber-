/**
 * Shout-outs: the Gosian bot telling a model her reels are working
 * (Geno, 2026-09-27 — automatic, only reels that beat her own usual, a weekly
 * roundup plus an instant note for a big hit).
 *
 * Measured against HER, never the roster: 8K views is a huge week for a
 * 2K-follower account and nothing for a 500K one, and "4× your usual" is true
 * and encouraging for both.
 *
 *   usual     median plays of her reels posted 8–60 days ago (settled), at
 *             least five of them — without that there is nothing honest to say
 *   weekly    last Monday–Sunday (ET), reels at ≥ 2× her usual, best three;
 *             offered Monday 12:00 ET through Tuesday, once per week
 *   instant   a reel from the last 72 hours at ≥ 5× her usual, once per reel,
 *             at most one a day per model, only 10:00–20:00 ET
 *
 * A model with nothing above her usual gets nothing that week — silence beats
 * a hollow compliment. Only models linked to a Telegram group are offered.
 */
import { sql } from '../db'
import { median } from './math'
import { loadModels } from './load'

const ZONE = 'America/New_York'
const DAY = 86_400_000
export const SHOUT = {
  weeklyMultiple: 2,
  instantMultiple: 5,
  weeklyMax: 3,
  minBaseline: 5,
  instantHours: 72,
  instantWindow: [10, 20] as const,
  weeklyOpens: { weekday: 1, hour: 12 },
} as const

export type ShoutReel = {
  post_id: string
  handle: string
  plays: number
  likes: number | null
  comments: number | null
  multiple: number
  posted_at: string
  permalink: string
}

export type Shoutout = {
  id: string
  kind: 'weekly' | 'instant'
  model_id: string
  model_name: string
  chat_id: string
  week_of: string | null
  reels: ShoutReel[]
}

type Post = { handle: string; post_id: string; posted_at: number; plays: number; likes: number | null; comments: number | null }

/** Wall-clock parts of `now` in New York. */
export function eastern(now: number) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: ZONE, weekday: 'short', hour: 'numeric', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(now)).map((p) => [p.type, p.value]))
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(String(parts.weekday))
  return { weekday, hour: Number(parts.hour), date: `${parts.year}-${parts.month}-${parts.day}` }
}

/** Midnight in New York on `date`, as a UTC instant — 04:00Z in summer,
 *  05:00Z in winter. */
function easternMidnight(date: string): number {
  for (const hour of [4, 5]) {
    const at = Date.parse(`${date}T0${hour}:00:00Z`)
    const et = eastern(at)
    if (et.date === date && et.hour === 0) return at
  }
  return Date.parse(`${date}T04:00:00Z`)
}

export const addDays = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10)

/** Her usual views: the median of her settled reels, or null when too few. */
export function usualPlays(posts: Post[], now: number): number | null {
  const settled = posts
    .filter((p) => now - p.posted_at >= 8 * DAY && now - p.posted_at <= 60 * DAY)
    .map((p) => p.plays)
  if (settled.length < SHOUT.minBaseline) return null
  return median(settled)
}

const toReel = (p: Post, usual: number): ShoutReel => ({
  post_id: p.post_id,
  handle: p.handle,
  plays: p.plays,
  likes: p.likes,
  comments: p.comments,
  multiple: Math.round((p.plays / usual) * 10) / 10,
  posted_at: new Date(p.posted_at).toISOString(),
  permalink: `https://www.instagram.com/reel/${p.post_id}/`,
})

/** What is due right now, not yet sent. Pure apart from the reads. */
export async function dueShoutouts(now = Date.now()): Promise<Shoutout[]> {
  const models = (await loadModels()).filter((m) => m.handles.length > 0)
  const linked = new Map(
    (await sql.query(`select id, telegram_chat_id from transcriber.models where telegram_chat_id is not null`))
      .map((row) => [String(row.id), String(row.telegram_chat_id)]),
  )
  const handles = models.flatMap((m) => m.handles)
  if (!handles.length) return []
  const rows = await sql.query(
    `select handle, post_id, posted_at, plays, likes, comments
       from transcriber.creator_posts
      where handle = any($1::text[]) and kind = 'reel' and plays is not null
        and posted_at > now() - interval '120 days'`,
    [handles],
  )
  const posts: Post[] = rows.map((r) => ({
    handle: String(r.handle), post_id: String(r.post_id), posted_at: Date.parse(String(r.posted_at)),
    plays: Number(r.plays), likes: r.likes === null ? null : Number(r.likes), comments: r.comments === null ? null : Number(r.comments),
  }))
  const sent = await sql.query(`select id, model_id, kind, post_ids, sent_at from transcriber.shoutouts`)
  const done = new Set(sent.map((r) => String(r.id)))
  const celebrated = new Set(sent.filter((r) => r.kind === 'instant').flatMap((r) => (r.post_ids as string[]) ?? []))
  const instantToday = new Set(sent
    .filter((r) => r.kind === 'instant' && r.sent_at && now - Date.parse(String(r.sent_at)) < DAY)
    .map((r) => String(r.model_id)))

  const et = eastern(now)
  // Monday 12:00 through Tuesday: last week's roundup is open.
  const weeklyOpen = (et.weekday === 1 && et.hour >= SHOUT.weeklyOpens.hour) || et.weekday === 2
  const thisMonday = addDays(et.date, -((et.weekday + 6) % 7))
  const lastMonday = addDays(thisMonday, -7)
  const lastWeekFrom = easternMidnight(lastMonday)
  const lastWeekTo = easternMidnight(thisMonday)
  const instantOpen = et.hour >= SHOUT.instantWindow[0] && et.hour < SHOUT.instantWindow[1]

  const out: Shoutout[] = []
  for (const model of models) {
    const chat = linked.get(model.id)
    if (!chat) continue
    const mine = posts.filter((p) => model.handles.includes(p.handle))
    const usual = usualPlays(mine, now)
    if (!usual) continue

    const weeklyId = `w:${model.id}:${lastMonday}`
    if (weeklyOpen && !done.has(weeklyId)) {
      const best = mine
        .filter((p) => p.posted_at >= lastWeekFrom && p.posted_at < lastWeekTo && p.plays >= usual * SHOUT.weeklyMultiple)
        .sort((a, b) => b.plays - a.plays)
        .slice(0, SHOUT.weeklyMax)
      if (best.length) {
        out.push({ id: weeklyId, kind: 'weekly', model_id: model.id, model_name: model.name, chat_id: chat, week_of: lastMonday, reels: best.map((p) => toReel(p, usual)) })
      }
    }

    if (instantOpen && !instantToday.has(model.id)) {
      const hit = mine
        .filter((p) => now - p.posted_at <= SHOUT.instantHours * 3_600_000 && p.plays >= usual * SHOUT.instantMultiple && !celebrated.has(p.post_id))
        .sort((a, b) => b.plays / usual - a.plays / usual)[0]
      if (hit && !done.has(`i:${hit.post_id}`)) {
        out.push({ id: `i:${hit.post_id}`, kind: 'instant', model_id: model.id, model_name: model.name, chat_id: chat, week_of: null, reels: [toReel(hit, usual)] })
      }
    }
  }
  return out
}

/** The bot's answer: recorded either way, so a failure is not retried. */
export async function recordShoutout(item: { id: string; model_id: string; kind: string; week_of: string | null; post_ids: string[] }, ok: boolean, error: string | null) {
  const rows = await sql.query(
    `insert into transcriber.shoutouts (id, model_id, kind, week_of, post_ids, sent_at, error)
     values ($1, $2, $3, $4::date, $5::text[], case when $6 then now() end, $7)
     on conflict (id) do nothing
     returning id`,
    [item.id, item.model_id, item.kind, item.week_of, item.post_ids, ok, ok ? null : error],
  )
  return rows.length > 0
}
