/**
 * The trend detection engine: turns collected mentions into the scored
 * snapshots every page reads. Deterministic; no model, no guessing.
 *
 * What it computes, per topic, over a 24-hour window:
 *   - observed  mentions, unique authors, communities, engagement
 *   - baseline  the trailing 7-day mention rate, the topic's own normal
 *   - velocity  engagement units per hour of exposure
 *   - growth    rate vs its own baseline (null when there is no baseline)
 *   - interest  0–100 against the rolling baseline, confidence-shrunk
 *   - breakout  0–1 blend of growth, velocity share and community spread
 *   - status    breakout / rising / stable / cooling / building
 *
 * The maths lives in metrics.ts as pure functions; this file is the SQL
 * that feeds them and the writes that persist them.
 */

import { q, sql } from '../db'
import { mean } from './metrics'
import { breakoutOf, confidenceOf, growthOf, interestIndex, statusOf, velocityOf } from './metrics'
import { recordAlert } from './store'
import { getSettings } from './settings'
import { TOPIC_CATEGORIES } from './registry'
import type { TrendStatus } from './types'

const DAY = 86_400_000
export const WINDOW_HOURS = 24
const BASELINE_DAYS = 7

type TopicAggregate = {
  topic_id: string
  mentions: number
  authors: number
  subreddits: number
  engagement: string | number
  first_at: string
  first_ever: string | null
  baseline_mentions?: number
}

export type ComputedTopic = {
  topic_id: string
  mentions: number
  unique_authors: number
  subreddits: number
  engagement: number
  velocity: number | null
  growth: number | null
  interest: number
  breakout: number | null
  confidence: number
  status: TrendStatus
}

/**
 * Score every topic with mentions in the window and persist a snapshot per
 * topic. One `captured_at` for the batch, so the whole reading is
 * internally consistent and a retry is a no-op.
 */
export async function computeTopicMetrics(now = new Date()): Promise<ComputedTopic[]> {
  const settings = await getSettings()

  const aggregates = await q<TopicAggregate>(
    `with windowed as (
       select m.topic_id,
              count(*)::int                                   as mentions,
              count(distinct m.author) filter (where m.author is not null)::int as authors,
              count(distinct m.subreddit)::int                 as subreddits,
              min(m.mentioned_at)                              as first_at
         from reddit.topic_mentions m
         join reddit.reddit_posts p on p.id = m.post_id and p.is_deleted = false
         join reddit.tracked_subreddits ts on ts.id = m.subreddit and (not $1::boolean or ts.adult)
        where m.mentioned_at >= now() - interval '24 hours'
        group by m.topic_id
     ),
     engaged as (
       select m.topic_id,
              sum(coalesce(p.score, 0) + coalesce(p.comments, 0))::bigint as engagement
         from reddit.topic_mentions m
         join reddit.reddit_posts p on p.id = m.post_id and p.is_deleted = false
         join reddit.tracked_subreddits ts on ts.id = m.subreddit and (not $1::boolean or ts.adult)
        where m.mentioned_at >= now() - interval '24 hours'
        group by m.topic_id
     ),
     baseline as (
       select m.topic_id, count(*)::int as n
         from reddit.topic_mentions m
         join reddit.reddit_posts p on p.id = m.post_id and p.is_deleted = false
         join reddit.tracked_subreddits ts on ts.id = m.subreddit and (not $1::boolean or ts.adult)
        where m.mentioned_at >= now() - interval '8 days'
          and m.mentioned_at <  now() - interval '24 hours'
        group by m.topic_id
     ),
     first_ever as (
       select m.topic_id, min(m.mentioned_at) as first_at
         from reddit.topic_mentions m
         join reddit.tracked_subreddits ts on ts.id = m.subreddit and (not $1::boolean or ts.adult)
        group by m.topic_id
     )
     select w.topic_id, w.mentions, w.authors, w.subreddits,
            coalesce(e.engagement, 0) as engagement,
            w.first_at,
            f.first_at as first_ever,
            coalesce(b.n, 0) as baseline_mentions
        from windowed w
        join reddit.topic_entities t on t.id = w.topic_id and t.adult and t.category = any($2::text[])
       left join engaged e on e.topic_id = w.topic_id
       left join baseline b on b.topic_id = w.topic_id
       left join first_ever f on f.topic_id = w.topic_id`,
    [settings.adult_only, TOPIC_CATEGORIES],
  )

  if (!aggregates.length) return []

  // First pass: rate maths that does not depend on the batch.
  const staged = aggregates.map((row) => {
    const mentions = Number(row.mentions)
    const engagement = Number(row.engagement)
    const firstAt = Date.parse(row.first_at)
    const firstEver = row.first_ever ? Date.parse(row.first_ever) : firstAt
    const exposureDays = clamp((now.getTime() - firstAt) / DAY, 0.25, 1)
    const historyDays = clamp((now.getTime() - firstEver) / DAY, 0, BASELINE_DAYS)
    const baselineObservedDays = clamp((now.getTime() - 24 * 3_600_000 - firstEver) / DAY, 1, BASELINE_DAYS)
    const baselineMentions = Number((row as TopicAggregate & { baseline_mentions?: number }).baseline_mentions ?? 0)
    const currentRate = mentions / exposureDays
    const baselineRate = baselineMentions / baselineObservedDays
    const confidence = confidenceOf({
      mentions,
      authors: Number(row.authors),
      baselineDays: historyDays,
    })
    const engagementHours = Math.max(1, (now.getTime() - firstAt) / 3_600_000)
    return {
      topic_id: row.topic_id,
      mentions,
      unique_authors: Number(row.authors),
      subreddits: Number(row.subreddits),
      engagement,
      confidence,
      growth: growthOf(currentRate, baselineRate),
      velocity: velocityOf(engagement, engagementHours),
      currentRate,
      baselineRate,
    }
  })

  // The velocity share is relative to this batch's fastest topic — one of
  // the three inputs to breakout.
  const topVelocity = Math.max(0, ...staged.map((row) => row.velocity ?? 0))

  const computed: ComputedTopic[] = staged.map((row) => {
    const interest = interestIndex({
      currentRate: row.currentRate,
      baselineRate: row.baselineRate,
      confidence: row.confidence,
    })
    const breakout = breakoutOf({
      growth: row.growth,
      velocityShare: topVelocity > 0 ? (row.velocity ?? 0) / topVelocity : 0,
      subreddits: row.subreddits,
      confidence: row.confidence,
    })
    const status = statusOf({
      growth: row.growth,
      interest,
      confidence: row.confidence,
      mentions: row.mentions,
      thresholds: {
        breakoutInterest: settings.breakout_interest,
        breakoutGrowth: settings.breakout_growth,
        minMentions: settings.min_mentions,
      },
    })
    return {
      topic_id: row.topic_id,
      mentions: row.mentions,
      unique_authors: row.unique_authors,
      subreddits: row.subreddits,
      engagement: row.engagement,
      velocity: row.velocity,
      growth: row.growth,
      interest,
      breakout,
      confidence: row.confidence,
      status,
    }
  })

  const capturedAt = now.toISOString()
  await sql.query(
    `insert into reddit.topic_metric_snapshots
       (topic_id, captured_at, window_hours, mentions, unique_authors, subreddits,
        engagement, velocity, growth, interest, breakout, confidence, status)
     select * from unnest(
       $1::text[], $2::timestamptz[], $3::int[], $4::int[], $5::int[], $6::int[],
       $7::bigint[], $8::real[], $9::real[], $10::real[], $11::real[], $12::real[], $13::text[]
     )
     on conflict (topic_id, captured_at, window_hours) do nothing`,
    [
      computed.map((row) => row.topic_id),
      computed.map(() => capturedAt),
      computed.map(() => WINDOW_HOURS),
      computed.map((row) => row.mentions),
      computed.map((row) => row.unique_authors),
      computed.map((row) => row.subreddits),
      computed.map((row) => row.engagement),
      computed.map((row) => row.velocity),
      computed.map((row) => row.growth),
      computed.map((row) => row.interest),
      computed.map((row) => row.breakout),
      computed.map((row) => row.confidence),
      computed.map((row) => row.status),
    ],
  )

  await generateTopicAlerts(computed, settings, now)
  return computed
}

/**
 * Alerts are once-each by construction: the dedupe key carries the day, so
 * a topic that is still breaking out tomorrow gets tomorrow's alert and
 * nothing re-fires today. Only signals the settings say matter are written.
 */
async function generateTopicAlerts(
  rows: ComputedTopic[],
  settings: Awaited<ReturnType<typeof getSettings>>,
  now: Date,
): Promise<void> {
  if (!settings.alerts_enabled) return
  const day = now.toISOString().slice(0, 10)
  for (const row of rows) {
    if (row.status === 'breakout') {
      await recordAlert({
        id: `alert_${row.topic_id}_breakout_${day}`,
        dedupeKey: `${row.topic_id}:breakout:${day}`,
        kind: 'topic_breakout',
        subject: row.topic_id,
        title: `${row.topic_id} is breaking out`,
        body: `Interest ${row.interest}/100 with ${row.mentions} mentions across ${row.subreddits} communities.`,
        severity: 'warning',
      })
    }
    if (row.growth !== null && row.growth * 100 >= settings.alert_growth_pct) {
      await recordAlert({
        id: `alert_${row.topic_id}_growth_${day}`,
        dedupeKey: `${row.topic_id}:growth:${day}`,
        kind: 'topic_growth',
        subject: row.topic_id,
        title: `${row.topic_id} grew ${Math.round(row.growth * 100)}%`,
        body: `${row.mentions} mentions in the last 24h against its own recent baseline.`,
        severity: 'info',
      })
    }
    if (row.subreddits >= settings.alert_spread && row.mentions >= settings.min_mentions) {
      await recordAlert({
        id: `alert_${row.topic_id}_spread_${day}`,
        dedupeKey: `${row.topic_id}:spread:${day}`,
        kind: 'topic_spread',
        subject: row.topic_id,
        title: `${row.topic_id} appears in ${row.subreddits} communities`,
        body: 'Appearing across multiple communities is the strongest cross-community signal this engine measures.',
        severity: 'info',
      })
    }
    if (row.velocity !== null && row.velocity >= settings.alert_velocity) {
      await recordAlert({
        id: `alert_${row.topic_id}_velocity_${day}`,
        dedupeKey: `${row.topic_id}:velocity:${day}`,
        kind: 'topic_velocity',
        subject: row.topic_id,
        title: `${row.topic_id} is moving fast`,
        body: `Observed engagement is running at ${Math.round(row.velocity).toLocaleString('en-US')} units/hour.`,
        severity: 'info',
      })
    }
  }
}

/**
 * Subreddit activity spikes: this run's new-post count against the
 * community's own trailing baseline. Ratio, not absolute size, so a small
 * community spiking is heard too.
 */
export async function detectSubredditSpikes(now = new Date()): Promise<number> {
  const settings = await getSettings()
  if (!settings.alerts_enabled) return 0
  const rows = await q<{ subreddit: string; recent: string | number; baseline: string | number; snaps: string | number }>(
    `with recent as (
       select ss.subreddit, sum(ss.posts_new)::int as recent
         from reddit.subreddit_snapshots ss
         join reddit.tracked_subreddits ts on ts.id = ss.subreddit and (not $1::boolean or ts.adult)
        where ss.captured_at >= now() - interval '3 hours'
        group by ss.subreddit
     ), baseline as (
       select ss.subreddit,
              sum(ss.posts_new)::numeric / greatest(1, count(distinct date_trunc('day', ss.captured_at))) as baseline,
              count(*) as snaps
         from reddit.subreddit_snapshots ss
         join reddit.tracked_subreddits ts on ts.id = ss.subreddit and (not $1::boolean or ts.adult)
        where ss.captured_at >= now() - interval '8 days'
          and ss.captured_at <  now() - interval '3 hours'
        group by ss.subreddit
     )
     select b.subreddit, coalesce(r.recent, 0) as recent, b.baseline, b.snaps
       from baseline b left join recent r on r.subreddit = b.subreddit
      where b.snaps >= 3`,
    [settings.adult_only],
  )
  const day = now.toISOString().slice(0, 10)
  let written = 0
  for (const row of rows) {
    const recent = Number(row.recent)
    const baseline = Number(row.baseline)
    if (baseline <= 0) continue
    const ratio = recent / baseline
    if (recent >= 5 && ratio >= 3) {
      const ok = await recordAlert({
        id: `alert_sub_${row.subreddit}_spike_${day}`,
        dedupeKey: `sub:${row.subreddit}:spike:${day}`,
        kind: 'subreddit_spike',
        subject: row.subreddit,
        title: `r/${row.subreddit} activity spiked ${ratio.toFixed(1)}×`,
        body: `${recent} new posts in the last three hours against a baseline of about ${Math.round(baseline)}.`,
        severity: 'warning',
      })
      if (ok) written += 1
    }
  }
  return written
}

/** Collector failure alert — written when a run leaves errors behind. */
export async function alertCollector(unhealthy: number, note: string, now = new Date()): Promise<void> {
  const day = now.toISOString().slice(0, 10)
  await recordAlert({
    id: `alert_collector_${day}`,
    dedupeKey: `collector:errors:${day}`,
    kind: 'collector_failure',
    subject: 'collector',
    title: `Collector finished with ${unhealthy} problem${unhealthy === 1 ? '' : 's'}`,
    body: note,
    severity: 'critical',
  })
}

/** Average of the latest interest scores — the Overview chart's normalised
 *  line. Null when nothing has been computed yet (honest "no data"). */
export function averageDefined(values: (number | null)[]): number | null {
  const clean = values.filter((value): value is number => value !== null && Number.isFinite(value))
  return mean(clean)
}

const clamp = (value: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, value))
