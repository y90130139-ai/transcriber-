/** Standing, read from the database: heat, suggested priority, and the facts
 *  behind both. The judgement itself lives in `engagement.ts`; this only
 *  gathers what it reads. */
import { sql } from './db'
import { currentWeekOf } from './dates'
import {
  WINDOW_WEEKS, SERIES_POINTS, engagementOf, previousSuggestion, suggestPriority, trendOf,
  type Engagement, type Priority, type RevenueBand, type SentWeek, type Suggestion, type Trend,
} from './engagement'

export type Standing = {
  model_id: string
  priority: Priority | null
  priority_set_at: string | null
  revenue_band: RevenueBand | null
  revenue_set_at: string | null
  engagement: Engagement
  suggestion: Suggestion
  /** Which way her score moved since one sent week ago, with its history.
   *  Null under two sent weeks. */
  trend: Trend | null
  /** What the suggestion was one sent week ago, when it can be known. */
  previous_suggestion: Priority | null
  /** Her most recent act of any kind: a visit, a tap, a message. */
  last_active: string | null
  /** Cards carried forward from an earlier week and still not filmed. */
  backlog: number
  /** Her newest sent weeks, newest first, for the strip in her sheet. */
  weeks: SentWeek[]
}

/** Far enough back to roll the four-week read back SERIES_POINTS times for
 *  someone sent most weeks, near enough that last spring does not decide this
 *  autumn. */
const LOOKBACK_WEEKS = (WINDOW_WEEKS + SERIES_POINTS) * 2

const iso = (value: unknown): string | null =>
  value ? new Date(value as string).toISOString() : null

export async function loadStanding(modelId?: string): Promise<Map<string, Standing>> {
  const thisWeek = currentWeekOf()
  const only = modelId ?? null

  const [models, weeks, activity] = await Promise.all([
    sql.query(
      `select m.id, m.priority, m.priority_set_at, m.revenue_band, m.revenue_set_at,
              exists (
                select 1 from transcriber.plan_items i
                  join transcriber.plans p on p.id = i.plan_id
                 where p.model_id = m.id and i.posted_at is not null
              ) as posting_tracked
         from transcriber.models m
        where ($1::text is null or m.id = $1)`,
      [only],
    ),
    // Sent weeks only. A draft is invisible to her and must never count.
    sql.query(
      `select p.model_id, to_char(p.week_of, 'YYYY-MM-DD') as week_of,
              coalesce(p.sent_at, p.updated_at) as sent_at, p.opened_at,
              count(i.id)::int as items,
              count(i.id) filter (where i.accepted_at is not null)::int as accepted,
              count(i.id) filter (where i.declined_at is not null)::int as declined,
              count(i.id) filter (where i.filmed_at   is not null)::int as filmed,
              count(i.id) filter (where i.posted_at   is not null)::int as posted,
              coalesce(sum((select count(*) from transcriber.plan_messages n
                             where n.item_id = i.id and n.author = 'model')), 0)::int as messages
         from transcriber.plans p
         left join transcriber.plan_items i on i.plan_id = p.id
        where p.status = 'sent'
          and ($2::text is null or p.model_id = $2)
          and p.week_of > $1::date - interval '${LOOKBACK_WEEKS} weeks'
        group by p.id
        order by p.model_id, p.week_of desc`,
      [thisWeek, only],
    ),
    sql.query(
      `select m.id as model_id,
              greatest(
                (select max(e.at) from transcriber.plan_events e where e.model_id = m.id),
                (select max(p.opened_at) from transcriber.plans p where p.model_id = m.id),
                (select max(greatest(i.accepted_at, i.declined_at, i.filmed_at))
                   from transcriber.plan_items i join transcriber.plans p on p.id = i.plan_id
                  where p.model_id = m.id),
                (select max(n.created_at) from transcriber.plan_messages n
                   join transcriber.plan_items i on i.id = n.item_id
                   join transcriber.plans p on p.id = i.plan_id
                  where p.model_id = m.id and n.author = 'model')
              ) as last_active,
              (select count(*) from transcriber.plan_items i
                 join transcriber.plans p on p.id = i.plan_id
                where p.model_id = m.id and i.carried_from is not null
                  and i.filmed_at is null and i.declined_at is null)::int as backlog
         from transcriber.models m
        where ($1::text is null or m.id = $1)`,
      [only],
    ),
  ])

  const weeksBy = new Map<string, SentWeek[]>()
  for (const row of weeks) {
    const list = weeksBy.get(String(row.model_id)) ?? []
    weeksBy.set(String(row.model_id), [...list, {
      week_of: String(row.week_of),
      sent_at: iso(row.sent_at) ?? new Date(0).toISOString(),
      opened_at: iso(row.opened_at),
      items: Number(row.items),
      accepted: Number(row.accepted),
      declined: Number(row.declined),
      filmed: Number(row.filmed),
      posted: Number(row.posted),
      messages: Number(row.messages),
    }])
  }
  const activityBy = new Map(activity.map((row) => [String(row.model_id), row]))

  const now = Date.now()
  return new Map(models.map((row) => {
    const id = String(row.id)
    const sent = weeksBy.get(id) ?? []
    const posting = Boolean(row.posting_tracked)
    const engagement = engagementOf(sent, now, posting)
    const revenue = (row.revenue_band as RevenueBand | null) ?? null
    const facts = activityBy.get(id)
    return [id, {
      model_id: id,
      priority: (row.priority as Priority | null) ?? null,
      priority_set_at: iso(row.priority_set_at),
      revenue_band: revenue,
      revenue_set_at: iso(row.revenue_set_at),
      engagement,
      suggestion: suggestPriority(revenue, engagement),
      trend: trendOf(sent, now, posting),
      previous_suggestion: previousSuggestion(revenue, sent, now, posting),
      last_active: iso(facts?.last_active),
      backlog: Number(facts?.backlog ?? 0),
      weeks: sent.slice(0, WINDOW_WEEKS),
    }]
  }))
}
