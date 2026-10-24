/**
 * The dashboard's numbers, read from Scout's rows for every model's own
 * Instagram accounts (her `handle` plus every Instagram in `socials`).
 * The rules live in `math.ts`; this only gathers and adds up.
 */
import { sql } from '../db'
import {
  TAG_LABEL, attentionReasons, autoTag, daysBetween, median, reelsByDay, sumHeld, direction, followerSeries, viewsByDay, viewsChange,
  type Direction, type Post, type Snapshot, type TagKey,
} from './math'

export const WINDOWS = [7, 30, 90] as const
export type WindowDays = (typeof WINDOWS)[number]

const DAY = 86_400_000
const ZONE = 'America/New_York'
const TOP_REELS = 18

export type Point = { day: string; value: number }

export type ModelPerf = {
  id: string
  name: string
  photo_url: string | null
  handles: string[]
  followers: number | null
  followers_gain: number | null
  followers_pct: number | null
  /** First day follower history exists for her, inside the period. */
  tracked_since: string | null
  views_period: number
  views_prev: number
  lifetime_views: number
  reels_period: number
  posts_period: number
  reels_per_week: number
  story_days: number
  story_days_observed: number
  last_posted_at: string | null
  views_change: number | null
  trend: Direction | null
  auto_tag: TagKey | null
  tag: TagKey | null
  tag_label: string | null
  tag_pinned: boolean
  /** Why she reads Needs attention, in plain words (empty otherwise). */
  attention_reasons: string[]
  followers_spark: number[]
}

export type Reel = {
  post_id: string
  handle: string
  model_id: string
  model_name: string
  photo_url: string | null
  posted_at: string | null
  plays: number | null
  likes: number | null
  comments: number | null
  video_url: string | null
  poster_url: string | null
  permalink: string
  /** Times her usual views (median of her settled reels); null when unknown. */
  multiple: number | null
}

export type Board = {
  days: WindowDays
  from: string
  to: string
  models: ModelPerf[]
  followers_series: Point[]
  followers_prev: Point[]
  views_series: Point[]
  views_prev: Point[]
  reels_series: Point[]
  top_reels: Reel[]
}

export type ModelRow = {
  id: string; name: string; photo_url: string | null; weekly_target: number
  performance_tag: TagKey | null; handles: string[]
}

const num = (value: unknown): number | null => {
  if (value === null || value === undefined) return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

const dayIn = (ms: number): string => new Intl.DateTimeFormat('en-CA', { timeZone: ZONE }).format(new Date(ms))

export async function loadModels(onlyId?: string): Promise<ModelRow[]> {
  const rows = await sql.query(
    `select m.id, m.name, m.photo_url, m.weekly_target, m.performance_tag,
            array_remove(array(
              select distinct h from unnest(
                array_append(
                  coalesce((select array_agg(lower(ltrim(s->>'handle', '@')))
                              from jsonb_array_elements(
                                     case when jsonb_typeof(m.socials) = 'array' then m.socials else '[]'::jsonb end) s
                             where s->>'platform' ilike 'instagram%'), '{}'),
                  nullif(lower(ltrim(m.handle, '@')), ''))) h), null) as handles
       from transcriber.models m
      where m.status = 'active' and ($1::text is null or m.id = $1)
      order by m.name`,
    [onlyId ?? null],
  )
  return rows.map((row) => ({
    id: String(row.id),
    name: String(row.name),
    photo_url: row.photo_url ? String(row.photo_url) : null,
    weekly_target: Number(row.weekly_target) || 21,
    performance_tag: (row.performance_tag as TagKey | null) ?? null,
    handles: ((row.handles as string[] | null) ?? []).filter(Boolean),
  }))
}

async function loadRows(handles: string[], since: string) {
  const [snaps, posts, lifetime] = await Promise.all([
    sql.query(
      `select handle, to_char((seen_at at time zone '${ZONE}')::date, 'YYYY-MM-DD') as day,
              max(followers) as followers, bool_or(coalesce(has_story, false)) as story
         from transcriber.creator_snapshots
        where handle = any($1::text[]) and seen_at >= $2::timestamptz and followers is not null
        group by 1, 2`,
      [handles, since],
    ),
    // Every post, not just the period's: a views trend needs twenty settled
    // reels, and a quiet account's are older than any period.
    sql.query(
      `select handle, post_id, kind, posted_at, plays, likes, comments
         from transcriber.creator_posts
        where handle = any($1::text[]) and posted_at is not null`,
      [handles],
    ),
    sql.query(
      `select handle, coalesce(sum(plays), 0) as plays
         from transcriber.creator_posts where handle = any($1::text[]) group by handle`,
      [handles],
    ),
  ])
  return {
    snaps: snaps.map((row) => ({
      handle: String(row.handle), day: String(row.day), followers: Number(row.followers), story: Boolean(row.story),
    })) as Snapshot[],
    posts: posts.map((row) => ({
      handle: String(row.handle), post_id: String(row.post_id), kind: row.kind ? String(row.kind) : null,
      posted_at: row.posted_at ? new Date(String(row.posted_at)).toISOString() : null,
      plays: num(row.plays), likes: num(row.likes), comments: num(row.comments),
    })) as Post[],
    lifetime: new Map(lifetime.map((row) => [String(row.handle), Number(row.plays) || 0])),
  }
}

function inRange(posted: string | null, fromMs: number, toMs: number): boolean {
  if (!posted) return false
  const t = Date.parse(posted)
  return t >= fromMs && t < toMs
}

function perfFor(model: ModelRow, rows: Awaited<ReturnType<typeof loadRows>>, days: WindowDays, now: number): ModelPerf {
  const mine = new Set(model.handles)
  const snaps = rows.snaps.filter((s) => mine.has(s.handle))
  const posts = rows.posts.filter((p) => mine.has(p.handle))
  const start = now - days * DAY
  const prevStart = now - 2 * days * DAY
  const period = daysBetween(dayIn(start), dayIn(now))

  const series = followerSeries(snaps.filter((s) => s.day >= period[0]), period)
  const followers = series.length ? series[series.length - 1].value : null
  const gain = series.length > 1 ? series[series.length - 1].value - series[0].value : null
  const pct = gain !== null && series[0].value > 0 ? gain / series[0].value : null

  const current = posts.filter((p) => inRange(p.posted_at, start, now))
  const previous = posts.filter((p) => inRange(p.posted_at, prevStart, start))
  const reels = current.filter((p) => p.kind === 'reel')
  const sumPlays = (list: Post[]) => list.reduce((total, p) => total + (p.plays ?? 0), 0)

  const storyDays = new Set(snaps.filter((s) => s.day >= period[0] && s.story).map((s) => s.day)).size
  const observed = new Set(snaps.filter((s) => s.day >= period[0]).map((s) => s.day)).size
  const lastPosted = posts.reduce<string | null>((latest, p) => (!latest || (p.posted_at ?? '') > latest ? p.posted_at : latest), null)
  const daysSince = lastPosted ? (now - Date.parse(lastPosted)) / DAY : null

  const views = viewsChange(posts, now)
  const trend = direction(views.change, pct)
  const reelsPerWeek = (reels.length / days) * 7
  const auto = autoTag({
    reelsSeen: posts.filter((p) => p.kind === 'reel').length,
    daysSinceLastPost: daysSince,
    reelsPerWeek,
    weeklyTarget: model.weekly_target,
    trend,
  })
  const tag = model.performance_tag ?? auto
  const reasons = tag !== 'attention' ? [] : model.performance_tag === 'attention'
    ? ['Tagged Needs attention by hand.']
    : attentionReasons({
        reelsSeen: posts.filter((p) => p.kind === 'reel').length,
        daysSinceLastPost: daysSince,
        reelsPerWeek,
        weeklyTarget: model.weekly_target,
        trend,
        viewsChange: views.change,
        followersGain: gain,
      })

  return {
    id: model.id,
    name: model.name,
    photo_url: model.photo_url,
    handles: model.handles,
    followers,
    followers_gain: gain,
    followers_pct: pct,
    tracked_since: series[0]?.day ?? null,
    views_period: sumPlays(reels),
    views_prev: sumPlays(previous.filter((p) => p.kind === 'reel')),
    lifetime_views: model.handles.reduce((total, h) => total + (rows.lifetime.get(h) ?? 0), 0),
    reels_period: reels.length,
    posts_period: current.length,
    reels_per_week: Math.round(reelsPerWeek * 10) / 10,
    story_days: storyDays,
    story_days_observed: observed,
    last_posted_at: lastPosted,
    views_change: views.change,
    trend,
    auto_tag: auto,
    tag,
    tag_label: tag ? TAG_LABEL[tag] : null,
    tag_pinned: model.performance_tag !== null,
    attention_reasons: reasons,
    followers_spark: series.map((point) => point.value),
  }
}

async function topReels(models: ModelRow[], fromIso: string, onlyHandles?: string[], usual: number | null = null): Promise<Reel[]> {
  const owner = new Map<string, ModelRow>()
  for (const m of models) for (const h of m.handles) owner.set(h, m)
  const handles = onlyHandles ?? [...owner.keys()]
  if (!handles.length) return []
  const rows = await sql.query(
    `select post_id, handle, posted_at, plays, likes, comments,
            case when media_until > now() then poster_url end as poster_url,
            case when media_until > now() then video_url end as video_url
       from transcriber.creator_posts
      where handle = any($1::text[]) and kind = 'reel' and plays is not null and posted_at >= $2::timestamptz
      order by plays desc
      limit $3`,
    [handles, fromIso, TOP_REELS],
  )
  return rows.map((row) => {
    const model = owner.get(String(row.handle))
    return {
      post_id: String(row.post_id),
      handle: String(row.handle),
      model_id: model?.id ?? '',
      model_name: model?.name ?? String(row.handle),
      photo_url: model?.photo_url ?? null,
      posted_at: row.posted_at ? new Date(String(row.posted_at)).toISOString() : null,
      plays: num(row.plays),
      likes: num(row.likes),
      comments: num(row.comments),
      video_url: row.video_url ? String(row.video_url) : null,
      poster_url: row.poster_url ? String(row.poster_url) : null,
      permalink: `https://www.instagram.com/reel/${String(row.post_id)}/`,
      multiple: usual && num(row.plays) !== null ? Math.round(((num(row.plays) as number) / usual) * 10) / 10 : null,
    }
  })
}

/** Her usual views: the median of her reels 8–60 days old, five or more —
 *  the same measure the shout-outs use (lib/performance/shoutouts.ts). */
function usualOf(posts: Post[], now: number): number | null {
  const settled = posts
    .filter((p) => p.kind === 'reel' && p.plays !== null && p.posted_at)
    .filter((p) => { const age = now - Date.parse(p.posted_at as string); return age >= 8 * DAY && age <= 60 * DAY })
    .map((p) => p.plays as number)
  return settled.length >= 5 ? median(settled) : null
}

/** The whole roster, or one model when `modelId` is given. */
export async function loadBoard(days: WindowDays, modelId?: string, now = Date.now()): Promise<Board> {
  const models = await loadModels(modelId)
  const handles = [...new Set(models.flatMap((m) => m.handles))]
  const from = dayIn(now - days * DAY)
  const to = dayIn(now)
  const period = daysBetween(from, to)
  const prevPeriod = daysBetween(dayIn(now - 2 * days * DAY), dayIn(now - days * DAY - DAY))
  // The week's reads and the top-reels board have no order between them —
  // both only need `models` — so they ride one wait (2026-10-09).
  const [rows, top_reels] = await Promise.all([
    handles.length
      ? loadRows(handles, new Date(now - 2 * days * DAY).toISOString())
      : Promise.resolve({ snaps: [], posts: [], lifetime: new Map<string, number>() }),
    topReels(models, new Date(now - days * DAY).toISOString(), modelId ? handles : undefined),
  ])
  const usual = modelId ? usualOf(rows.posts, now) : null

  const perModel = models.map((m) => perfFor(m, rows, days, now))
  const snapsFor = (m: ModelRow) => rows.snaps.filter((s) => m.handles.includes(s.handle))
  const followersNow = sumHeld(models.map((m) => followerSeries(snapsFor(m).filter((s) => s.day >= from), period)), period)
  const followersPrev = sumHeld(
    models.map((m) => followerSeries(snapsFor(m).filter((s) => s.day < from), prevPeriod)), prevPeriod,
  )
  const inPeriod = rows.posts.filter((p) => p.kind === 'reel' && inRange(p.posted_at, now - days * DAY, now))
  const inPrev = rows.posts.filter((p) => p.kind === 'reel' && inRange(p.posted_at, now - 2 * days * DAY, now - days * DAY))

  return {
    days,
    from,
    to,
    models: perModel,
    followers_series: followersNow,
    followers_prev: followersPrev,
    views_series: viewsByDay(inPeriod, period),
    views_prev: viewsByDay(inPrev, prevPeriod),
    reels_series: reelsByDay(inPeriod, period),
    // `multiple` (against her usual views) needs the posts, so it is stamped
    // on after both reads land rather than blocking the board on it.
    top_reels: usual === null
      ? top_reels
      : top_reels.map((reel) => reel.plays !== null
        ? { ...reel, multiple: Math.round((reel.plays / usual) * 10) / 10 }
        : reel),
  }
}

/** One model's accounts, each on its own line, for her Analytics tab. */
export async function accountBreakdown(handles: string[], days: WindowDays, now = Date.now()) {
  if (!handles.length) return []
  const rows = await loadRows(handles, new Date(now - days * DAY).toISOString())
  const period = daysBetween(dayIn(now - days * DAY), dayIn(now))
  return handles.map((handle) => {
    const series = followerSeries(rows.snaps.filter((s) => s.handle === handle), period)
    const reels = rows.posts.filter((p) => p.handle === handle && p.kind === 'reel' && inRange(p.posted_at, now - days * DAY, now))
    return {
      handle,
      followers: series.length ? series[series.length - 1].value : null,
      followers_gain: series.length > 1 ? series[series.length - 1].value - series[0].value : null,
      reels_period: reels.length,
      views_period: reels.reduce((total, p) => total + (p.plays ?? 0), 0),
      tracked: series.length > 0,
    }
  })
}
