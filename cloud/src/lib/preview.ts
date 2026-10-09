import { sql } from './db'
import { planItemsFor, type Plan, type PlanItem, type PlanModel } from './plans'

/**
 * THE CONSOLE'S VIEW OF HER PAGE.
 *
 * This deliberately does NOT live in `plans.ts`. That file opens with an
 * isolation boundary saying no query in it takes an id from the request, and
 * that statement has to stay true — it is the one line a future reader will
 * trust when asking whether a model's phone can reach another model's week.
 * This function takes a plan id from the request, so it lives out here where
 * it cannot weaken that claim.
 *
 * WHAT IT IS FOR. `loadPlan` answers "what should she be looking at right
 * now", which means **sent plans only**, and only within a fortnight of this
 * week — drafts are invisible to her by design. That makes it useless for the
 * console preview, where the entire point is to look at a draft *before*
 * sending it. This answers a different question: "render plan X exactly as her
 * page would, whatever its status".
 *
 * WHY IT SHARES `planItemsFor`. The preview's only claim is that it is what
 * she will see. A second query written to look like the first would drift the
 * first time either gained a column, and it would drift silently — the preview
 * would keep rendering, just wrongly. One query, two callers.
 *
 * ACCESS. Console session only. The route that calls this checks `isSignedIn`
 * before it does anything else. There is no token path to it.
 */
export async function loadPlanPreview(planId: string): Promise<
  { model: PlanModel; plan: Plan; items: PlanItem[] } | null
> {
  // `photo_url`, `drive_url` and `delivery_note` are selected because her page
  // renders all three. `models.notes` is not, and must not be — it is internal
  // and the preview is a render of her page, not of the row behind it.
  // The week's row and its items are both keyed by the plan id — one wait
  // (2026-10-09).
  const [[row], items] = await Promise.all([
    sql.query(
      `select p.id,
              to_char(p.week_of, 'YYYY-MM-DD') as week_of,
              to_char(p.due_date, 'YYYY-MM-DD') as due_date,
              p.title, p.intro,
              to_char(p.opened_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as opened_at,
              m.id as model_id, m.name, m.photo_url, m.filming_days, m.timezone,
              m.weekly_target, m.standing_rules, m.drive_url, m.delivery_note
         from transcriber.plans p
         join transcriber.models m on m.id = p.model_id
        where p.id = $1`,
      [planId],
    ),
    planItemsFor(planId),
  ])
  if (!row) return null

  const model: PlanModel = {
    id: String(row.model_id),
    name: String(row.name),
    photo_url: (row.photo_url as string | null) ?? null,
    filming_days: Array.isArray(row.filming_days) ? (row.filming_days as number[]) : [],
    timezone: String(row.timezone),
    weekly_target: Number(row.weekly_target ?? 0),
    standing_rules: (row.standing_rules as string | null) ?? null,
    drive_url: (row.drive_url as string | null) ?? null,
    delivery_note: (row.delivery_note as string | null) ?? null,
  }

  const plan: Plan = {
    id: String(row.id),
    week_of: String(row.week_of),
    due_date: (row.due_date as string | null) ?? null,
    title: (row.title as string | null) ?? null,
    intro: (row.intro as string | null) ?? null,
    opened_at: (row.opened_at as string | null) ?? null,
  }

  return { model, plan, items }
}
