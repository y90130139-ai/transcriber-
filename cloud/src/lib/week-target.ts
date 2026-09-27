/**
 * Which week a card of hers lands on when it is added from outside the plan
 * editor's own list — Recreate and Repurpose. Moved out of the posts route so
 * both paths share one rule.
 *
 * The week named (`askedPlan`, the one open in the editor) when there is one
 * and it is still a draft; otherwise `workingWeek` (lib/carry.ts). A sent week
 * is never written to: a card appearing on a plan she has already opened is a
 * card nobody reviewed.
 */
import { workingWeek, type WeekRef } from './carry'
import { addDays, currentWeekOf } from './dates'
import { sql } from './db'
import { newId } from './models'

/** The last day of the week the plan belongs to. Same as creating one. */
const DUE_OFFSET_DAYS = 6

export type Target = { planId: string; weekOf: string } | { error: string; status: number }

export async function recreateTarget(modelId: string, askedPlan: unknown): Promise<Target> {
  if (typeof askedPlan === 'string' && askedPlan) {
    const [plan] = await sql.query(
      `select id, status, to_char(week_of, 'YYYY-MM-DD') as week_of
         from transcriber.plans where id = $1 and model_id = $2`,
      [askedPlan, modelId],
    )
    if (!plan) return { error: 'That week is gone. Reopen the plan and try again.', status: 404 }
    if (String(plan.status) !== 'draft') {
      return { error: 'That week is already sent. Open a draft week and add it there.', status: 409 }
    }
    return { planId: String(plan.id), weekOf: String(plan.week_of) }
  }

  const [model] = await sql.query(`select timezone from transcriber.models where id = $1`, [modelId])
  const weeks = (await sql.query(
    `select id, to_char(week_of, 'YYYY-MM-DD') as week_of, status
       from transcriber.plans where model_id = $1`,
    [modelId],
  )) as WeekRef[]
  const pick = workingWeek(weeks, currentWeekOf(String(model?.timezone ?? 'America/New_York')))
  if (pick.kind === 'existing') return { planId: pick.id, weekOf: pick.week_of }

  const [made] = await sql.query(
    `insert into transcriber.plans (id, model_id, week_of, due_date)
     values ($3, $1, $2::date, $4::date)
     on conflict (model_id, week_of) do update set updated_at = now()
     returning id, status`,
    [modelId, pick.week_of, newId(), addDays(pick.week_of, DUE_OFFSET_DAYS)],
  )
  if (String(made.status) !== 'draft') {
    return { error: 'Their next week is already sent. Open a draft week and add it there.', status: 409 }
  }
  return { planId: String(made.id), weekOf: pick.week_of }
}
