/**
 * The questionnaire's database side. Rules live in ./core (pure, tested);
 * this file only reads and writes.
 *
 * Flow: Geno presses Send (one model or all) → an open `surveys` row → the
 * Gosian bot polls /api/bot/surveys, posts her link in MARKETING, answers
 * back → she opens /p/<token>/survey → on submit her profile is updated in
 * the same transaction that closes the row. One reminder after 3 days.
 */
import { sql } from '../db'
import { newId } from '../models'
import { modelForToken } from '../plans'
import { eastern } from '../performance/shoutouts'
import { mergeProfile, type Answers, type CurrentProfile, type Priority } from './core'

const REMIND_AFTER_DAYS = 3
/** Reminders land in daytime New York, never at 3am. Sends are on Geno's tap. */
const REMIND_HOURS = { from: 10, to: 20 }

export type SurveyStatus = {
  model_id: string
  state: 'none' | 'queued' | 'sent' | 'opened' | 'answered' | 'failed'
  at: string | null
  priority: Priority | null
  error: string | null
}

/** Queue one model's questionnaire. A model with one already open keeps it. */
export async function requestSurvey(modelId: string) {
  const rows = await sql.query(
    `insert into transcriber.surveys (id, model_id)
     select $1, m.id from transcriber.models m where m.id = $2
     on conflict (model_id) where submitted_at is null do nothing
     returning id`,
    [newId(), modelId],
  )
  // A failed send left open is re-armed by asking again.
  const rearmed = await sql.query(
    `update transcriber.surveys set send_error = null
      where model_id = $1 and submitted_at is null and sent_at is null and send_error is not null
      returning id`,
    [modelId],
  )
  return { queued: rows.length > 0 || rearmed.length > 0 }
}

/** Every active model in a Telegram group who has never answered. Already
 *  sent and still open: left alone (the bot reminds once). Failed: re-armed. */
export async function requestAll() {
  const rows = await sql.query(
    `select m.id from transcriber.models m
      where m.status = 'active' and m.telegram_chat_id is not null and m.token_revoked_at is null
        and not exists (select 1 from transcriber.surveys s where s.model_id = m.id and s.submitted_at is not null)`,
  )
  let queued = 0
  for (const row of rows) if ((await requestSurvey(String(row.id))).queued) queued += 1
  return { queued }
}

export async function statuses(): Promise<SurveyStatus[]> {
  const rows = await sql.query(
    `select distinct on (s.model_id) s.model_id, s.sent_at, s.send_error, s.opened_at, s.submitted_at,
            s.created_at, s.priority
       from transcriber.surveys s
      order by s.model_id, s.created_at desc`,
  )
  return rows.map((r) => {
    const base = { model_id: String(r.model_id), priority: (r.priority as Priority) ?? null, error: null as string | null }
    if (r.submitted_at) return { ...base, state: 'answered' as const, at: String(r.submitted_at) }
    if (r.send_error) return { ...base, state: 'failed' as const, at: String(r.created_at), error: String(r.send_error) }
    if (r.opened_at) return { ...base, state: 'opened' as const, at: String(r.opened_at) }
    if (r.sent_at) return { ...base, state: 'sent' as const, at: String(r.sent_at) }
    return { ...base, state: 'queued' as const, at: String(r.created_at) }
  })
}

export type DueSurvey = {
  id: string
  kind: 'send' | 'reminder'
  model_id: string
  model_name: string
  chat_id: string
  link: string
}

export async function dueSurveys(origin: string, now = Date.now()): Promise<DueSurvey[]> {
  const et = eastern(now)
  const remindNow = et.hour >= REMIND_HOURS.from && et.hour < REMIND_HOURS.to
  const rows = await sql.query(
    `select s.id, s.model_id, m.name, m.telegram_chat_id, m.access_token,
            case when s.sent_at is null then 'send' else 'reminder' end as kind
       from transcriber.surveys s
       join transcriber.models m on m.id = s.model_id
      where s.submitted_at is null
        and m.status = 'active' and m.telegram_chat_id is not null and m.token_revoked_at is null
        and (
          (s.sent_at is null and s.send_error is null)
          or ($1 and s.sent_at < now() - make_interval(days => $2) and s.reminded_at is null and s.remind_error is null)
        )
      order by s.created_at`,
    [remindNow, REMIND_AFTER_DAYS],
  )
  return rows.map((r) => ({
    id: String(r.id),
    kind: r.kind as 'send' | 'reminder',
    model_id: String(r.model_id),
    model_name: String(r.name),
    chat_id: String(r.telegram_chat_id),
    link: `${origin}/p/${String(r.access_token)}/survey`,
  }))
}

/** The bot's answer for one send or reminder. Recorded either way: a failure
 *  is not retried until Geno sends again. */
export async function recordSend(id: string, kind: 'send' | 'reminder', ok: boolean, error: string | null) {
  const rows = await sql.query(
    kind === 'send'
      ? `update transcriber.surveys set sent_at = case when $2 then now() end, send_error = case when $2 then null else $3 end
          where id = $1 and sent_at is null returning id`
      : `update transcriber.surveys set reminded_at = case when $2 then now() end, remind_error = case when $2 then null else $3 end
          where id = $1 and reminded_at is null returning id`,
    [id, ok, ok ? null : (error ?? 'no reason').slice(0, 500)],
  )
  return rows.length > 0
}

/** Her page: who she is, and her last answers if she has any (to prefill a retake). */
export async function surveyPage(token: string) {
  const model = await modelForToken(token)
  if (!model) return null
  await sql.query(
    `update transcriber.surveys set opened_at = now()
      where model_id = $1 and submitted_at is null and opened_at is null`,
    [model.id],
  )
  const [last] = await sql.query(
    `select answers, submitted_at from transcriber.surveys
      where model_id = $1 and submitted_at is not null order by submitted_at desc limit 1`,
    [model.id],
  )
  return {
    model: { id: model.id, name: model.name, photo_url: model.photo_url ?? null },
    // Never her priority: she is not told it (Geno, 2026-10-02).
    last: last ? { answers: last.answers as Answers, submitted_at: String(last.submitted_at) } : null,
  }
}

/** Apply her answers to her profile and close (or create) her survey row, in
 *  one transaction, so a half-saved profile cannot happen. */
export async function submitSurvey(token: string, answers: Answers) {
  const model = await modelForToken(token)
  if (!model) return null
  const [row] = await sql.query(
    `select weekly_target, filming_days, formats, wont_do, persona, priority
       from transcriber.models where id = $1`,
    [model.id],
  )
  const current: CurrentProfile = {
    weekly_target: Number(row.weekly_target),
    filming_days: (row.filming_days as number[]) ?? [],
    formats: (row.formats as string[]) ?? [],
    wont_do: (row.wont_do as string[]) ?? [],
    persona: (row.persona as string[]) ?? [],
    priority: (row.priority as Priority) ?? null,
  }
  const { profile, changes } = mergeProfile(current, answers)
  const priorityChanged = profile.priority !== current.priority

  await sql.transaction([
    sql.query(
      `update transcriber.models
          set weekly_target = $2, daily_capacity = $3, filming_days = $4::int[], best_times = $5::text[],
              formats = $6::text[], wont_do = $7::text[], persona = $8::text[], priority = $9,
              priority_set_at = case when $10 then now() else priority_set_at end,
              updated_at = now()
        where id = $1`,
      [model.id, profile.weekly_target, profile.daily_capacity, profile.filming_days, profile.best_times,
        profile.formats, profile.wont_do, profile.persona, profile.priority, priorityChanged],
    ),
    // Closes the open row if there is one; a retake with none open gets its own.
    sql.query(
      `with closed as (
         update transcriber.surveys
            set submitted_at = now(), lang = $2, answers = $3::jsonb, changes = $4::jsonb, priority = $5
          where model_id = $1 and submitted_at is null
          returning id)
       insert into transcriber.surveys (id, model_id, submitted_at, lang, answers, changes, priority)
       select $6, $1, now(), $2, $3::jsonb, $4::jsonb, $5
        where not exists (select 1 from closed)`,
      [model.id, answers.lang, JSON.stringify(answers), JSON.stringify(changes), profile.priority, newId()],
    ),
  ])
  return { priority: profile.priority, weekly: profile.weekly_target, changes }
}

/** The console's view of one model: her latest questionnaire, if any. */
export async function latestFor(modelId: string) {
  const [row] = await sql.query(
    `select s.id, s.created_at, s.sent_at, s.send_error, s.reminded_at, s.opened_at, s.submitted_at,
            s.lang, s.answers, s.changes, s.priority, m.best_times, m.daily_capacity,
            (m.telegram_chat_id is not null) as in_group
       from transcriber.models m
       left join lateral (
         select * from transcriber.surveys where model_id = m.id order by created_at desc limit 1
       ) s on true
      where m.id = $1`,
    [modelId],
  )
  return row ?? null
}

/**
 * A new model's questionnaire goes out by itself the first time her Telegram
 * group is linked (Geno, 2026-10-02: "yes automatically"). Only an active
 * model who has never had one — relinking, or linking someone who already
 * answered, sends nothing.
 */
export async function autoSurveyOnLink(modelId: string) {
  const rows = await sql.query(
    `insert into transcriber.surveys (id, model_id)
     select $1, m.id from transcriber.models m
      where m.id = $2 and m.status = 'active' and m.telegram_chat_id is not null
        and not exists (select 1 from transcriber.surveys s where s.model_id = m.id)
     on conflict do nothing
     returning id`,
    [newId(), modelId],
  )
  return { queued: rows.length > 0 }
}
