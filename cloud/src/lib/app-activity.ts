/** Her app activity (Geno, 2026-10-14).
 *
 * The console can already see her latest state — `last_login_at`, whether a
 * week was ever opened. It cannot see her history, and history is what tells
 * a creator who is drifting from one who never got in. This file is both
 * halves: `logAppEvent` writes one row per act the app can see, and
 * `activityForModel` composes her whole story — those rows plus everything
 * the other tables already timestamp — into one timeline.
 *
 * The return value lets first-run milestones stay in the phone's retry queue
 * until they land. Other activity remains best-effort for the user action.
 */
import { nanoid } from 'nanoid'
import { sql } from './db'

export type AppEventKind = 'signin' | 'plan_open' | 'discover' | 'tour' | 'onboarding'

const newId = () => nanoid(12)

export async function logAppEvent(
  modelId: string | null | undefined,
  kind: AppEventKind,
  detail?: string | null,
  /** First-run milestones happen once (tour, onboarding): a second report —
   *  a reinstall, a re-read of the screen — must not double the timeline. */
  options?: { once?: boolean },
): Promise<boolean> {
  if (!modelId) return false
  try {
    if (options?.once) {
      await sql.query(
        `insert into transcriber.app_events (id, model_id, kind, detail)
         select $1, $2, $3, $4
          where not exists (
            select 1 from transcriber.app_events where model_id = $2 and kind = $3
          )`,
        [newId(), modelId, kind, detail?.slice(0, 300) ?? null],
      )
      return true
    }
    await sql.query(
      `insert into transcriber.app_events (id, model_id, kind, detail) values ($1, $2, $3, $4)`,
      [newId(), modelId, kind, detail?.slice(0, 300) ?? null],
    )
    return true
  } catch {
    console.error('[app-activity] write_failed', kind)
    return false
  }
}

/** One line of her story, already written in the console's voice. */
export type ActivityEvent = {
  at: string
  /** Coarse family — the timeline groups its marker by this. */
  kind: 'signin' | 'plan_open' | 'discover' | 'invite' | 'activated' | 'week_sent' | 'week_opened'
    | 'accepted' | 'declined' | 'filmed' | 'made' | 'take' | 'message' | 'inbox' | 'note_read'
    | 'survey' | 'device' | 'intake' | 'tour' | 'onboarding'
  /** Whose act it was: hers (`her`) or the team's (`team`). */
  by: 'her' | 'team'
  label: string
  detail: string | null
}

const cardName = (no: unknown, title: unknown): string => {
  const name = typeof title === 'string' && title.trim() ? title.trim() : null
  const label = no === null || no === undefined ? null : `V-${Number(no)}`
  return [label, name].filter(Boolean).join(' · ') || 'a card'
}

const snippet = (body: unknown): string | null => {
  if (typeof body !== 'string') return null
  const clean = body.replace(/\s+/g, ' ').trim()
  if (!clean) return null
  return clean.length > 140 ? `${clean.slice(0, 139)}…` : clean
}

/** Everything timestamped about her, newest first. The account's own fields
 *  (invite sent, activated, last sign-in) are merged in by the caller, which
 *  holds the account — this side stays database-only. */
export async function activityForModel(modelId: string): Promise<ActivityEvent[]> {
  const [events, plans, items, messages, surveys, devices, intake, inbox, inboxSeen] = await Promise.all([
    sql.query(
      `select kind, detail, created_at from transcriber.app_events
        where model_id = $1 order by created_at desc limit 400`,
      [modelId],
    ),
    sql.query(
      `select to_char(week_of, 'YYYY-MM-DD') as week_of, sent_at, opened_at
         from transcriber.plans
        where model_id = $1 and status = 'sent'
        order by week_of desc limit 60`,
      [modelId],
    ),
    sql.query(
      `select i.card_no, i.title, i.accepted_at, i.declined_at, i.decline_reason,
              i.filmed_at, i.made_at, i.take_uploaded_at, i.take_kind,
              to_char(p.week_of, 'YYYY-MM-DD') as week_of
         from transcriber.plan_items i
         join transcriber.plans p on p.id = i.plan_id
        where p.model_id = $1
        order by p.week_of desc limit 400`,
      [modelId],
    ),
    sql.query(
      `select n.author, n.body, n.created_at, n.seen_at, i.card_no, i.title
         from transcriber.plan_messages n
         join transcriber.plan_items i on i.id = n.item_id
         join transcriber.plans p on p.id = i.plan_id
        where p.model_id = $1
        order by n.created_at desc limit 300`,
      [modelId],
    ),
    sql.query(
      `select sent_at, opened_at, submitted_at from transcriber.surveys
        where model_id = $1 order by created_at desc limit 12`,
      [modelId],
    ),
    sql.query(
      `select platform, created_at from transcriber.model_devices
        where model_id = $1 order by created_at desc limit 20`,
      [modelId],
    ),
    sql.query(
      `select filename, created_at from transcriber.model_intake
        where model_id = $1 order by created_at desc limit 20`,
      [modelId],
    ),
    // What she wrote in the team inbox (2026-10-14) — a thread of its own,
    // not a card thread. Authored by her only: a group with two models must
    // not put one woman's words on the other's page.
    sql.query(
      `select tm.body, tm.attachment_name, tm.created_at, t.title
         from transcriber.thread_messages tm
         join transcriber.threads t on t.id = tm.thread_id
         join transcriber.thread_members mb on mb.thread_id = tm.thread_id
        where mb.member_type = 'model' and mb.member_id = $1
          and tm.author_type = 'model' and tm.author_id = $1 and tm.deleted_at is null
        order by tm.created_at desc limit 100`,
      [modelId],
    ),
    // ...and when she last opened it — the shared per-model seat's seen mark.
    sql.query(
      `select max(mb.seen_at) as seen_at from transcriber.thread_members mb
        where mb.member_type = 'model' and mb.member_id = $1`,
      [modelId],
    ),
  ])

  const out: ActivityEvent[] = []
  const at = (value: unknown): string | null => {
    if (value === null || value === undefined) return null
    const iso = value instanceof Date ? value.toISOString() : String(value)
    return Number.isNaN(Date.parse(iso)) ? null : iso
  }

  for (const row of events) {
    const stamp = at(row.created_at)
    if (!stamp) continue
    const kind = String(row.kind)
    if (kind === 'signin') {
      out.push({ at: stamp, kind: 'signin', by: 'her', label: 'Signed in to the app', detail: null })
    } else if (kind === 'plan_open') {
      out.push({ at: stamp, kind: 'plan_open', by: 'her', label: 'Opened her week in the app', detail: typeof row.detail === 'string' ? row.detail : null })
    } else if (kind === 'discover') {
      const pass = row.detail === 'pass'
      out.push({
        at: stamp, kind: 'discover', by: 'her',
        label: pass ? 'Passed on a reel in Discover' : 'Starred a reel in Discover',
        detail: null,
      })
    } else if (kind === 'tour') {
      out.push({ at: stamp, kind: 'tour', by: 'her', label: 'Completed the tour', detail: null })
    } else if (kind === 'onboarding') {
      out.push({ at: stamp, kind: 'onboarding', by: 'her', label: 'Completed the onboarding', detail: null })
    }
  }

  for (const row of plans) {
    const sent = at(row.sent_at)
    if (sent) out.push({ at: sent, kind: 'week_sent', by: 'team', label: `Week of ${row.week_of} sent`, detail: null })
    const opened = at(row.opened_at)
    if (opened) out.push({ at: opened, kind: 'week_opened', by: 'her', label: `Opened the week of ${row.week_of}`, detail: null })
  }

  for (const row of items) {
    const card = cardName(row.card_no, row.title)
    const accepted = at(row.accepted_at)
    if (accepted) out.push({ at: accepted, kind: 'accepted', by: 'her', label: `Took on ${card}`, detail: null })
    const declined = at(row.declined_at)
    if (declined) {
      out.push({
        at: declined, kind: 'declined', by: 'her', label: `Turned down ${card}`,
        detail: typeof row.decline_reason === 'string' && row.decline_reason.trim() ? row.decline_reason.trim() : null,
      })
    }
    const filmed = at(row.filmed_at)
    if (filmed) out.push({ at: filmed, kind: 'filmed', by: 'her', label: `Ticked off ${card} as filmed`, detail: null })
    const made = at(row.made_at)
    if (made) out.push({ at: made, kind: 'made', by: 'her', label: `Said she already made ${card}`, detail: null })
    const take = at(row.take_uploaded_at)
    if (take) {
      out.push({
        at: take, kind: 'take', by: 'her',
        label: `Sent her take for ${card}`,
        detail: row.take_kind === 'photo' ? 'A photo' : row.take_kind === 'clip' ? 'A filmed clip' : null,
      })
    }
  }

  for (const row of messages) {
    const card = cardName(row.card_no, row.title)
    const written = at(row.created_at)
    if (row.author === 'model' && written) {
      out.push({ at: written, kind: 'message', by: 'her', label: `Wrote on ${card}`, detail: snippet(row.body) })
    }
    const seen = at(row.seen_at)
    if (row.author === 'operator' && seen) {
      out.push({ at: seen, kind: 'note_read', by: 'her', label: `Read the team's note on ${card}`, detail: null })
    }
  }

  for (const row of surveys) {
    const sent = at(row.sent_at)
    if (sent) out.push({ at: sent, kind: 'survey', by: 'team', label: 'Questionnaire sent', detail: null })
    const opened = at(row.opened_at)
    if (opened) out.push({ at: opened, kind: 'survey', by: 'her', label: 'Opened the questionnaire', detail: null })
    const submitted = at(row.submitted_at)
    if (submitted) out.push({ at: submitted, kind: 'survey', by: 'her', label: 'Submitted her answers', detail: null })
  }

  for (const row of devices) {
    const registered = at(row.created_at)
    if (registered) {
      out.push({
        at: registered, kind: 'device', by: 'her',
        label: 'Turned on notifications',
        detail: row.platform === 'ios' ? 'iPhone' : row.platform === 'android' ? 'Android' : null,
      })
    }
  }

  for (const row of intake) {
    const stamp = at(row.created_at)
    if (stamp) {
      out.push({
        at: stamp, kind: 'intake', by: 'team',
        label: 'Intake added to her file',
        detail: typeof row.filename === 'string' && row.filename.trim() ? row.filename.trim() : null,
      })
    }
  }

  for (const row of inbox) {
    const stamp = at(row.created_at)
    if (!stamp) continue
    const thread = typeof row.title === 'string' && row.title.trim() ? row.title.trim() : 'the team'
    out.push({
      at: stamp, kind: 'inbox', by: 'her',
      label: `Wrote in the inbox · ${thread}`,
      detail: snippet(row.body) ?? (typeof row.attachment_name === 'string' ? row.attachment_name : null),
    })
  }
  const inboxSeenAt = inboxSeen[0] ? at(inboxSeen[0].seen_at) : null
  if (inboxSeenAt) {
    out.push({ at: inboxSeenAt, kind: 'inbox', by: 'her', label: 'Read her inbox', detail: null })
  }

  return out.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 250)
}
