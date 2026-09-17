/** Her acts on her page, as a timeline. See `plan_events` in migrate.mjs.
 *
 * Best-effort by design: this is measurement, and a measurement that could
 * fail her tap would cost more than the gap it fills. Every error is swallowed
 * here and reported to the server log, never to her.
 */
import { sql } from './db'
import { newId } from './models'

export type EventKind = 'visit' | 'accept' | 'decline' | 'reopen' | 'film' | 'unfilm' | 'message'

/** A refresh is not a return. One visit per plan per half hour. */
const VISIT_GAP_MINUTES = 30

export async function logEvent(event: {
  modelId: string
  planId: string | null
  itemId?: string | null
  kind: EventKind
}): Promise<void> {
  try {
    if (event.kind === 'visit') {
      await sql.query(
        `insert into transcriber.plan_events (id, model_id, plan_id, kind)
         select $1, $2, $3, 'visit'
          where not exists (
            select 1 from transcriber.plan_events
             where plan_id = $3 and kind = 'visit'
               and at > now() - interval '${VISIT_GAP_MINUTES} minutes')`,
        [newId(), event.modelId, event.planId],
      )
      return
    }
    await sql.query(
      `insert into transcriber.plan_events (id, model_id, plan_id, item_id, kind)
       values ($1, $2, $3, $4, $5)`,
      [newId(), event.modelId, event.planId, event.itemId ?? null, event.kind],
    )
  } catch (error) {
    console.error('plan_events: could not record', event.kind, error)
  }
}
