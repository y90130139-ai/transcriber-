/**
 * What the OPS assistant can read. Read-only, every one of them: each tool is a
 * projection of a loader the console already uses, cut down to what answers a
 * question. Money leaves here in dollars. `core.scrub` runs over every result
 * on top of this, so a token can never slip through a future column.
 */
import { sql } from '../db'
import { loadSweep } from '../sweep'
import { statuses } from '../survey/store'
import { loadEarningsBoard, loadModelEarnings, EARNINGS_WINDOWS, type EarningsWindow } from '../earnings/board'
import { loadBoard, WINDOWS, type WindowDays } from '../performance/load'
import type { ToolSpec } from './core'
import { reportFor } from './bot-reports'

const usd = (cents: number | null | undefined) => (cents === null || cents === undefined ? null : Math.round(Number(cents)) / 100)

const WINDOW_SCHEMA = { type: 'integer', enum: [7, 30, 90], description: 'Days to look back: 7, 30 or 90.' } as const

function windowOf(value: unknown, allowed: readonly number[]): number {
  const n = Number(value)
  return allowed.includes(n) ? n : 7
}

type ModelHit = { id: string; name: string; status: string }

/** Finds one model by the name the team typed. Several close matches are an
 *  error that lists them, so the assistant asks rather than guesses. */
export async function findModel(name: unknown): Promise<ModelHit> {
  const wanted = String(name ?? '').trim()
  if (!wanted) throw new Error('Which model? Give a name.')
  const rows = await sql.query(
    `select id, name, status from transcriber.models
      where lower(name) = lower($1) or name ilike $2 escape '\\' or handle ilike $2 escape '\\'
      order by (lower(name) = lower($1)) desc, name limit 5`,
    [wanted, `%${wanted.replace(/[\\%_]/g, (c) => `\\${c}`)}%`],
  )
  const hits = rows.map((r) => ({ id: String(r.id), name: String(r.name), status: String(r.status) }))
  if (hits.length === 0) throw new Error(`No model matches "${wanted}".`)
  const exact = hits.find((h) => h.name.toLowerCase() === wanted.toLowerCase())
  if (exact) return exact
  if (hits.length > 1) throw new Error(`"${wanted}" could be: ${hits.map((h) => h.name).join(', ')}. Which one?`)
  return hits[0]
}

async function roster() {
  const rows = await sql.query(
    `select m.name, m.handle, m.status, m.tier, m.priority, m.creator_type, m.weekly_target, m.filming_days,
            m.formats, m.timezone, m.place, m.inactive_reason, m.inactive_since,
            m.telegram_chat_id is not null as telegram_linked,
            (select count(*) from transcriber.earnings_accounts a where a.model_id = m.id)::int as onlyfans_accounts
       from transcriber.models m order by m.status, m.name`,
  )
  return { note: 'filming_days: 0 = Sunday. priority/tier are internal.', models: rows }
}

async function modelProfile(input: Record<string, unknown>) {
  const hit = await findModel(input.name)
  const [row] = await sql.query(
    `select name, handle, status, tier, priority, creator_type, persona, formats, hooks, wont_do,
            filming_days, weekly_target, timezone, place, standing_rules, notes, delivery_note,
            socials, solo, inactive_reason, inactive_note, inactive_since, created_at
       from transcriber.models where id = $1`,
    [hit.id],
  )
  return row
}

async function questionnaire() {
  const [all, names] = await Promise.all([
    statuses(),
    sql.query(`select id, name, status from transcriber.models`),
  ])
  const byId = new Map(names.map((m) => [String(m.id), { name: String(m.name), status: String(m.status) }]))
  const seen = new Set(all.map((s) => s.model_id))
  return {
    note: 'One reminder goes out 3 days after the link, 10:00-20:00 New York, active models only. Aurore gets no marketing.',
    surveys: all.map((s) => ({ model: byId.get(s.model_id)?.name ?? s.model_id, model_status: byId.get(s.model_id)?.status, state: s.state, at: s.at, error: s.error })),
    never_sent: names.filter((m) => !seen.has(String(m.id))).map((m) => ({ model: String(m.name), model_status: String(m.status) })),
  }
}

async function weekPlans() {
  const s = await loadSweep()
  return {
    week_of: s.weekOf,
    rows: s.rows.map((r) => ({
      model: r.name, status: r.status, plan_status: r.plan_status, sent_on: r.sent_on, due_date: r.due_date,
      days_left: r.days_left, items: r.items, accepted: r.accepted, declined: r.declined, filmed: r.filmed,
      posted: r.posted, unread_questions: r.unread, answered: r.answered, opened: r.opened,
    })),
    lists: {
      never_opened: s.neverOpened, opened_no_answer: s.openedNoAnswer, overdue: s.overdue,
      slipped: s.slipped, waiting_on_us: s.ourSide, open_questions: s.questions,
    },
    score: s.score,
    library: s.library,
  }
}

async function earningsSummary(input: Record<string, unknown>) {
  const b = await loadEarningsBoard(windowOf(input.days, EARNINGS_WINDOWS) as EarningsWindow)
  return {
    window: b.window, pulled_at: b.pulledAt,
    total: { net_usd: usd(b.total.net), gross_usd: usd(b.total.gross), prev_net_usd: usd(b.total.prevNet), change_pct: b.total.change },
    accounts: b.accounts.map((a) => ({
      model: a.model_name, account: a.name, username: a.username, net_usd: usd(a.net), prev_net_usd: usd(a.prevNet),
      change_pct: a.change, share_pct: a.share, missing_since: a.missing_since, pull_error: a.pull_error,
    })),
    daily_net_usd: b.daily.map((d) => ({ day: d.day, net: usd(d.net) })),
  }
}

async function modelEarnings(input: Record<string, unknown>) {
  const hit = await findModel(input.name)
  const e = await loadModelEarnings(hit.id, windowOf(input.days, EARNINGS_WINDOWS) as EarningsWindow)
  if (e.accounts.length === 0) return { model: hit.name, note: 'No OnlyFans account is matched to this model in Infloww.' }
  const w = e.week
  return {
    model: hit.name, window: e.window,
    accounts: e.accounts.map((a) => ({ name: a.name, username: a.username, missing_since: a.missing_since })),
    window_net_usd: usd(e.daily.reduce((n, d) => n + d.net, 0)),
    daily: e.daily.map((d) => ({ day: d.day, net_usd: usd(d.net), subs: d.subs, renewals: d.renewals })),
    last_full_week: w && {
      from: w.from, to: w.to, net_usd: usd(w.net), prev_net_usd: usd(w.prevNet), change_pct: w.change,
      best_day: w.best && { day: w.best.day, net_usd: usd(w.best.net) }, split: w.split, subs: w.subs,
      renewals: w.renewals, avg4_usd: usd(w.avg4), vs_avg4_pct: w.vsAvg4, provisional: w.provisional,
    },
  }
}

async function reelPerformance(input: Record<string, unknown>) {
  const days = windowOf(input.days, WINDOWS) as WindowDays
  const modelId = input.name ? (await findModel(input.name)).id : undefined
  const b = await loadBoard(days, modelId)
  return {
    from: b.from, to: b.to,
    models: b.models.map((m) => ({
      model: m.name, handles: m.handles, followers: m.followers, followers_gain: m.followers_gain,
      views: m.views_period, views_prev: m.views_prev, views_change_pct: m.views_change, reels: m.reels_period,
      reels_per_week: m.reels_per_week, story_days: m.story_days, last_posted_at: m.last_posted_at,
      tag: m.tag_label, needs_attention: m.attention_reasons,
    })),
    top_reels: b.top_reels.slice(0, 10).map((r) => ({
      model: r.model_name, handle: r.handle, posted_at: r.posted_at, plays: r.plays, times_her_usual: r.multiple, link: r.permalink,
    })),
  }
}

async function downloads() {
  const [counts, failed, runs] = await Promise.all([
    sql.query(`select status, count(*)::int n from transcriber.jobs group by status`),
    sql.query(
      `select label, left(error, 160) error, attempts, updated_at from transcriber.jobs
        where status = 'failed' order by updated_at desc limit 10`,
    ),
    sql.query(
      `select started_at, finished_at, handles, sightings, picked, suggested, gated, cost_usd
         from transcriber.scout_runs order by finished_at desc limit 3`,
    ),
  ])
  return { jobs_by_status: counts, latest_failed: failed, last_scout_runs: runs }
}

async function shoutouts(input: Record<string, unknown>) {
  const days = Math.min(Math.max(Number(input.days) || 14, 1), 90)
  const rows = await sql.query(
    `select m.name model, s.kind, s.week_of, cardinality(s.post_ids) reels, s.sent_at, s.error
       from transcriber.shoutouts s join transcriber.models m on m.id = s.model_id
      where s.created_at > now() - make_interval(days => $1) order by s.created_at desc`,
    [days],
  )
  return { days, shoutouts: rows }
}

async function botReports(input: Record<string, unknown>) {
  const [row] = await sql.query(`select generated_at, topics from transcriber.bot_snapshot where id = 'latest'`)
  if (!row) return { note: 'The bot has not shared its reports yet (it does so hourly).' }
  return { generated_at: row.generated_at, ...reportFor(row.topics as Record<string, string>, String(input.topic ?? '')) }
}

const NAME = { type: 'string', description: 'The model, as the team calls her (name or handle).' } as const

export const TOOLS: ToolSpec[] = [
  {
    name: 'roster',
    description: 'Every model: status (active/paused), tier, priority, weekly target, filming days, formats, time zone, whether her Telegram group is linked, how many OnlyFans accounts are matched, and why she is inactive if she is.',
    input_schema: { type: 'object', properties: {} },
    run: roster,
  },
  {
    name: 'model_profile',
    description: "One model's full profile: persona, formats, hooks, won't-do list, filming days, weekly target, socials, notes, solo or with a partner.",
    input_schema: { type: 'object', properties: { name: NAME }, required: ['name'] },
    run: modelProfile,
  },
  {
    name: 'questionnaire_status',
    description: 'The creator questionnaire: for each model whether it was queued, sent, opened, answered or failed (with the time), and who was never sent one.',
    input_schema: { type: 'object', properties: {} },
    run: questionnaire,
  },
  {
    name: 'week_plans',
    description: "This week's content plans per model: sent or draft, due date, cards, accepted, declined, filmed, posted, unread questions, opened or not; plus lists of who never opened, who opened but did not answer, overdue, slipped, and plans waiting on our side.",
    input_schema: { type: 'object', properties: {} },
    run: weekPlans,
  },
  {
    name: 'earnings_summary',
    description: 'OnlyFans earnings (Infloww) for the whole roster over the last 7, 30 or 90 days ending yesterday: total net and gross, the period before, every account with its model, net, change and share, the daily net, and when the data was last pulled.',
    input_schema: { type: 'object', properties: { days: WINDOW_SCHEMA } },
    run: earningsSummary,
  },
  {
    name: 'model_earnings',
    description: "One model's OnlyFans earnings: daily net, subs and renewals over 7, 30 or 90 days, and her last full Monday-Sunday week against the week before and her 4-week average.",
    input_schema: { type: 'object', properties: { name: NAME, days: WINDOW_SCHEMA }, required: ['name'] },
    run: modelEarnings,
  },
  {
    name: 'reel_performance',
    description: 'Instagram performance over 7, 30 or 90 days: per model views and change, followers and gain, reels posted, reels per week, story days, last post, needs-attention reasons; plus the top reels with how many times her usual views they got. Optionally for one model.',
    input_schema: { type: 'object', properties: { days: WINDOW_SCHEMA, name: NAME } },
    run: reelPerformance,
  },
  {
    name: 'downloads_and_scout',
    description: 'The reel download queue (jobs by status, the latest failures with their error) and the last Scout runs (accounts scanned, reels seen, picked, cost).',
    input_schema: { type: 'object', properties: {} },
    run: downloads,
  },
  {
    name: 'bot_reports',
    description: "The Gosian bot's own reports, refreshed hourly (say how fresh): today (stories, RSVP moves, questions, content plans sent this week), open_requests_and_questions (/ask and /request still waiting), upcoming_calendar (next 30 days of briefs, deadlines, locks), campaign_rsvps (who is in, out or silent per current campaign), birthdays_next_90_days, stories_and_streaks, drive_pipeline (content stuck in upload folders per model), content_snare (last to-do digest: needs approval, still to hand in). Call without a topic to list what is available.",
    input_schema: { type: 'object', properties: { topic: { type: 'string' } } },
    run: botReports,
  },
  {
    name: 'shoutouts_sent',
    description: 'Shout-outs the bot posted to models for reels that beat their usual views, over the last N days (default 14).',
    input_schema: { type: 'object', properties: { days: { type: 'integer', minimum: 1, maximum: 90 } } },
    run: shoutouts,
  },
]
