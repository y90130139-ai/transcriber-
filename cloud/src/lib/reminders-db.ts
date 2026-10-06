/** The database half of plan reminders — see reminders.ts for the rules. */
import { sql } from './db'
import { planItemsFor } from './plans'
import { currentWeekOf, nudgeCounts, nudgeDue, nudgeWindow, type Nudge } from './reminders'

export async function dueReminders(now = Date.now()): Promise<Nudge[]> {
  const kind = nudgeWindow(now)
  if (!kind) return []
  const weekOf = currentWeekOf(now)
  const rows = await sql.query(
    `select p.id as plan_id, p.week_of, m.id as model_id, m.name, m.telegram_chat_id as chat_id
       from transcriber.plans p
       join transcriber.models m on m.id = p.model_id
      where p.week_of = $1 and p.status = 'sent'
        and m.status = 'active' and m.telegram_chat_id is not null
        and not exists (select 1 from transcriber.plan_nudges n
                         where n.plan_id = p.id and n.kind = $2)`,
    [weekOf, kind],
  )
  const due: Nudge[] = []
  for (const row of rows) {
    const items = await planItemsFor(String(row.plan_id))
    const counts = nudgeCounts(items)
    if (!nudgeDue(kind, counts)) continue
    due.push({
      id: `${row.plan_id}:${kind}`,
      kind,
      plan_id: String(row.plan_id),
      model_id: String(row.model_id),
      model_name: String(row.name),
      chat_id: String(row.chat_id),
      week_of: String(row.week_of).slice(0, 10),
      ...counts,
    })
  }
  return due
}

/** Recorded whether it went or not, so the same nudge is never offered twice. */
export async function recordReminder(planId: string, kind: string, ok: boolean, error: string | null) {
  await sql.query(
    `insert into transcriber.plan_nudges (plan_id, kind, ok, error)
     values ($1, $2, $3, $4)
     on conflict (plan_id, kind) do nothing`,
    [planId, kind, ok, error],
  )
}
