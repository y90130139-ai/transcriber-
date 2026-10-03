/**
 * Alerts set in words (/q phase 2). The assistant proposes one (status
 * 'proposed'); the team taps Save in OPS and it is 'active'. The bot polls
 * GET /api/bot/alerts every minute: due watches are checked here against the
 * portal, each new event is written once (watch_id + key is unique, so nothing
 * repeats), and unsent events are handed over with fixed wording - no model
 * call when an alert fires.
 */
import { sql } from '../db'
import { newId } from '../models'
import { loadSweep } from '../sweep'
import { loadModelEarnings } from '../earnings/board'
import { loadModels } from '../performance/load'
import { usualPlays } from '../performance/shoutouts'
import { findModel } from './tools'
import { KINDS, due, isQuietHour, readParams, isKind, type WatchKind, type WatchParams } from './watch-kinds'

export const MAX_ATTEMPTS = 3
export const MAX_ACTIVE_PER_CHAT = 30

export type Watch = {
  id: string; chat_id: string; kind: WatchKind; params: WatchParams; label: string
  activated_at: number; last_checked_at: number | null; state: Record<string, unknown>
}
type Event = { key: string; text: string }

const ms = (v: unknown) => (v === null || v === undefined ? null : Date.parse(String(v instanceof Date ? v.toISOString() : v)))
const usd = (cents: number) => `$${(cents / 100).toLocaleString('en-US', { maximumFractionDigits: 0 })}`

export async function propose(chatId: string, createdBy: string | null, kindRaw: unknown, raw: Record<string, unknown>) {
  if (!isKind(kindRaw)) return { error: `Not something I can watch. I can watch: ${Object.keys(KINDS).join(', ')}.` }
  const params = readParams(kindRaw, raw)
  if ('error' in params) return params
  if (raw.model) {
    const hit = await findModel(raw.model)
    params.model = hit.name
    params.model_id = hit.id
  }
  const [{ n }] = await sql.query(
    `select count(*)::int n from transcriber.assistant_watches where chat_id = $1 and status = 'active'`, [chatId])
  if (Number(n) >= MAX_ACTIVE_PER_CHAT) return { error: `This chat already has ${MAX_ACTIVE_PER_CHAT} alerts. Delete one first (/q alerts).` }
  const id = newId()
  const label = KINDS[kindRaw].label(params)
  await sql.query(
    `insert into transcriber.assistant_watches (id, chat_id, kind, params, label, created_by) values ($1,$2,$3,$4,$5,$6)`,
    [id, chatId, kindRaw, JSON.stringify(params), label, createdBy],
  )
  return { proposal_id: id, label, note: 'Shown to the team with Save / Cancel buttons. Nothing is watched until someone taps Save.' }
}

/** Save, Cancel (a proposal) or Delete (an active one). Scoped to the chat it
 *  was made in, so a tap elsewhere can never change it. */
export async function decide(id: string, chatId: string, action: 'save' | 'cancel' | 'delete') {
  const from = action === 'delete' ? 'active' : 'proposed'
  const to = action === 'save' ? 'active' : action === 'cancel' ? 'cancelled' : 'deleted'
  const rows = await sql.query(
    `update transcriber.assistant_watches
        set status = $4, activated_at = case when $4 = 'active' then now() else activated_at end
      where id = $1 and chat_id = $2 and status = $3 returning label, status`,
    [id, chatId, from, to],
  )
  if (rows.length) return { ok: true, label: String(rows[0].label), status: String(rows[0].status) }
  const [row] = await sql.query(`select label, status from transcriber.assistant_watches where id = $1 and chat_id = $2`, [id, chatId])
  return row ? { ok: false, label: String(row.label), status: String(row.status) } : null
}

export async function listWatches(chatId: string) {
  const rows = await sql.query(
    `select w.id, w.label, w.activated_at, w.created_by,
            (select count(*) from transcriber.assistant_alerts a where a.watch_id = w.id and a.sent_at is not null)::int fired
       from transcriber.assistant_watches w where w.chat_id = $1 and w.status = 'active' order by w.activated_at`,
    [chatId],
  )
  return rows.map((r) => ({ id: String(r.id), label: String(r.label), since: r.activated_at, by: r.created_by, fired: Number(r.fired) }))
}

// --------------------------------------------------------------- checking

async function surveyEvents(w: Watch, column: 'submitted_at' | 'opened_at', verb: string): Promise<Event[]> {
  const rows = await sql.query(
    `select s.id, m.name from transcriber.surveys s join transcriber.models m on m.id = s.model_id
      where s.${column} > to_timestamp($1 / 1000.0) and ($2::text is null or s.model_id = $2)`,
    [w.activated_at, w.params.model_id ?? null],
  )
  return rows.map((r) => ({ key: String(r.id), text: `📝 ${String(r.name)} ${verb} the questionnaire.` }))
}

async function planNotOpened(w: Watch): Promise<Event[]> {
  const s = await loadSweep()
  return s.rows
    .filter((r) => r.status === 'active' && r.plan_status === 'sent' && r.plan_id && r.opened === false)
    .filter((r) => (r.days_since_sent ?? 0) >= (w.params.days ?? 1))
    .filter((r) => !w.params.model_id || r.id === w.params.model_id)
    .map((r) => ({
      key: String(r.plan_id),
      text: `👀 ${r.name} has not opened this week's plan - sent ${r.days_since_sent} day${r.days_since_sent === 1 ? '' : 's'} ago.`,
    }))
}

async function weekNetBelow(w: Watch): Promise<Event[]> {
  const floor = (w.params.usd ?? 0) * 100
  const models = w.params.model_id
    ? [{ id: w.params.model_id, name: w.params.model ?? '' }]
    : (await sql.query(`select id, name from transcriber.models where status = 'active'`)).map((m) => ({ id: String(m.id), name: String(m.name) }))
  const activatedDay = new Date(w.activated_at).toISOString().slice(0, 10)
  const out: Event[] = []
  for (const m of models) {
    const e = await loadModelEarnings(m.id, 7)
    const week = e.week
    if (!week || week.provisional || week.to < activatedDay || week.net >= floor) continue
    out.push({ key: `${m.id}:${week.from}`, text: `📉 ${m.name} closed the week of ${week.from} at ${usd(week.net)} net, under your $${w.params.usd} line.` })
  }
  return out
}

async function reelOverUsual(w: Watch, now: number): Promise<Event[]> {
  const models = await loadModels(w.params.model_id ?? undefined)
  const handles = [...new Set(models.flatMap((m) => m.handles))]
  if (!handles.length) return []
  const rows = await sql.query(
    `select handle, post_id, posted_at, plays from transcriber.creator_posts
      where handle = any($1::text[]) and kind = 'reel' and plays is not null and posted_at > now() - interval '75 days'`,
    [handles],
  )
  const since = Math.max(w.activated_at - 72 * 3_600_000, now - 72 * 3_600_000)
  const out: Event[] = []
  for (const m of models) {
    const posts = rows
      .filter((r) => m.handles.includes(String(r.handle)))
      .map((r) => ({ handle: String(r.handle), post_id: String(r.post_id), posted_at: Date.parse(String(r.posted_at)), plays: Number(r.plays), likes: null, comments: null }))
    const usual = usualPlays(posts, now)
    if (!usual) continue
    for (const p of posts) {
      const times = p.plays / usual
      if (p.posted_at < since || times < (w.params.times ?? 0)) continue
      out.push({
        key: p.post_id,
        text: `🚀 ${m.name}'s reel is at ${times.toFixed(1)}x her usual views (${p.plays.toLocaleString('en-US')} plays).\nhttps://www.instagram.com/reel/${p.post_id}/`,
      })
    }
  }
  return out
}

/** Fires when the count crosses above the line, and again only after it has
 *  dropped back under it. */
async function failedAbove(w: Watch): Promise<{ events: Event[]; state: Record<string, unknown> }> {
  const [{ n }] = await sql.query(`select count(*)::int n from transcriber.jobs where status = 'failed'`)
  const count = Number(n)
  const above = count > (w.params.count ?? 0)
  const wasAbove = w.state.above === true
  const events = above && !wasAbove
    ? [{ key: `crossed:${Date.now()}`, text: `⚠️ Failed reel downloads are at ${count}, above your line of ${w.params.count}.` }]
    : []
  return { events, state: { above } }
}

export async function checkWatch(w: Watch, now: number): Promise<{ events: Event[]; state?: Record<string, unknown> }> {
  switch (w.kind) {
    case 'questionnaire_answered': return { events: await surveyEvents(w, 'submitted_at', 'finished') }
    case 'questionnaire_opened': return { events: await surveyEvents(w, 'opened_at', 'opened') }
    case 'plan_not_opened': return { events: await planNotOpened(w) }
    case 'week_net_below': return { events: await weekNetBelow(w) }
    case 'reel_over_usual': return { events: await reelOverUsual(w, now) }
    case 'failed_downloads_above': return failedAbove(w)
  }
}

async function evaluate(now: number) {
  const rows = await sql.query(
    `select id, chat_id, kind, params, label, activated_at, last_checked_at, state
       from transcriber.assistant_watches where status = 'active'`,
  )
  for (const r of rows) {
    const w: Watch = {
      id: String(r.id), chat_id: String(r.chat_id), kind: r.kind as WatchKind, params: r.params as WatchParams,
      label: String(r.label), activated_at: ms(r.activated_at) ?? now, last_checked_at: ms(r.last_checked_at),
      state: (r.state as Record<string, unknown>) ?? {},
    }
    if (!isKind(w.kind) || !due(w.last_checked_at, w.kind, now)) continue
    try {
      const { events, state } = await checkWatch(w, now)
      for (const e of events) {
        await sql.query(
          `insert into transcriber.assistant_alerts (id, watch_id, key, text) values ($1,$2,$3,$4)
           on conflict (watch_id, key) do nothing`,
          [newId(), w.id, e.key, `${e.text}\n(alert: ${w.label.charAt(0).toLowerCase()}${w.label.slice(1)})`],
        )
      }
      await sql.query(
        `update transcriber.assistant_watches set last_checked_at = now(), state = coalesce($2::jsonb, state) where id = $1`,
        [w.id, state ? JSON.stringify(state) : null],
      )
    } catch (error) {
      console.error('watch check failed', w.id, error)
    }
  }
}

/** What the bot should post now. Quiet hours hold everything until 09:00. */
export async function dueAlerts(now = Date.now()) {
  if (isQuietHour(now)) return []
  await evaluate(now)
  const rows = await sql.query(
    `select a.id, a.text, w.chat_id from transcriber.assistant_alerts a
       join transcriber.assistant_watches w on w.id = a.watch_id
      where a.sent_at is null and a.attempts < $1 and w.status = 'active'
      order by a.created_at limit 20`,
    [MAX_ATTEMPTS],
  )
  return rows.map((r) => ({ id: String(r.id), chat_id: String(r.chat_id), text: String(r.text) }))
}

export async function recordAlert(id: string, ok: boolean, error: string | null) {
  const rows = await sql.query(
    `update transcriber.assistant_alerts
        set sent_at = case when $2 then now() end, attempts = attempts + 1, error = case when $2 then null else $3 end
      where id = $1 and sent_at is null returning id`,
    [id, ok, ok ? null : (error ?? 'no reason').slice(0, 300)],
  )
  return rows.length > 0
}
