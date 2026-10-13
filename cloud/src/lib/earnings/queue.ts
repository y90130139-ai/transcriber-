/**
 * The hand-off to the Gosian bot (2026-09-30).
 *
 * Sending one creator's numbers into another creator's group is the failure
 * this file exists to prevent. So a message is re-checked at the moment it is
 * approved, not only when it was drafted:
 *
 *   - it is still a draft (or approved and unsent, for a retry)
 *   - its model is still active and still linked to exactly the chat it was
 *     drafted for — relinking a group after drafting voids the draft
 *   - an Infloww account is still matched to that model and still connected
 *
 * Any mismatch refuses and says why; the bot tells OPS. The bot checks again
 * on its side that the chat is one of its own creator groups.
 */
import { sql } from '../db'

const RETRY_AFTER_MIN = 5

export type BotItem = { id: string; kind: 'weekly' | 'win' | 'monthly' | 'milestone'; model_id: string; model_name: string; chat_id: string; period: string; body: string }

const item = (r: Record<string, unknown>): BotItem => ({
  id: String(r.id), kind: r.kind as BotItem['kind'], model_id: String(r.model_id), model_name: String(r.model_name),
  chat_id: String(r.chat_id), period: String(r.period instanceof Date ? r.period.toISOString().slice(0, 10) : r.period).slice(0, 10), body: String(r.body),
})

export async function botQueue() {
  const drafts = await sql.query(
    `select e.*, m.name model_name from transcriber.earnings_messages e join transcriber.models m on m.id = e.model_id
      where e.status = 'draft' and e.ops_message_id is null order by e.created_at limit 20`,
  )
  // Approved but never confirmed sent: autosend, or a tap whose send failed
  // to report. Held back a few minutes so a tap in progress is not doubled.
  const sends = await sql.query(
    `select e.*, m.name model_name from transcriber.earnings_messages e join transcriber.models m on m.id = e.model_id
      where e.status = 'approved' and e.decided_at < now() - interval '${RETRY_AFTER_MIN} minutes'
      order by e.created_at limit 20`,
  )
  // `audience` tells the bot who to tag in MODEL PERFORMANCE: 'money' (Paige,
  // Geno, Marinko) or 'social' (Geno, Iona). Geno, 2026-10-10.
  const alerts = await sql.query(`select id, body, audience from transcriber.earnings_alerts where posted_at is null order by created_at limit 20`)
  return {
    drafts: drafts.map(item),
    sends: sends.map(item),
    alerts: alerts.map((a) => ({ id: String(a.id), body: String(a.body), audience: a.audience === 'social' ? 'social' : 'money' })),
  }
}

type Decision =
  | { ok: true; send?: BotItem }
  | { ok: false; error: string }

/** Why this message may not go to this chat right now, or null if it may. */
async function blocked(id: string): Promise<{ reason: string | null; row: Record<string, unknown> | null }> {
  const [row] = await sql.query(
    `select e.*, m.name model_name, m.status model_status, m.telegram_chat_id current_chat,
            (select count(*)::int from transcriber.earnings_accounts a
              where a.model_id = e.model_id and a.missing_since is null) accounts
       from transcriber.earnings_messages e join transcriber.models m on m.id = e.model_id
      where e.id = $1`,
    [id],
  )
  if (!row) return { reason: 'no such message', row: null }
  if (row.model_status !== 'active') return { reason: `${row.model_name} is not active`, row }
  if (!row.current_chat || String(row.current_chat) !== String(row.chat_id)) {
    return { reason: `${row.model_name}'s Telegram group changed since this was drafted`, row }
  }
  if (Number(row.accounts) === 0) return { reason: `no connected Infloww account is matched to ${row.model_name} any more`, row }
  return { reason: null, row }
}

export async function decide(id: string, body: Record<string, unknown>): Promise<Decision> {
  const action = String(body.action ?? '')

  if (action === 'shown') {
    await sql.query(`update transcriber.earnings_messages set ops_message_id = $2 where id = $1 and status = 'draft'`, [id, String(body.ops_message_id ?? 'posted')])
    return { ok: true }
  }

  if (action === 'skip') {
    const rows = await sql.query(
      `update transcriber.earnings_messages set status = 'skipped', decided_at = now() where id = $1 and status = 'draft' returning id`, [id],
    )
    return rows.length ? { ok: true } : { ok: false, error: 'already decided' }
  }

  if (action === 'approve' || action === 'retry') {
    const { reason, row } = await blocked(id)
    if (reason || !row) {
      if (row) await sql.query(`update transcriber.earnings_messages set status = 'failed', error = $2 where id = $1 and status in ('draft', 'approved')`, [id, reason])
      return { ok: false, error: reason ?? 'no such message' }
    }
    const from = action === 'approve' ? 'draft' : 'approved'
    const rows = await sql.query(
      `update transcriber.earnings_messages set status = 'approved', decided_at = now()
        where id = $1 and status = $2
          and ($2 = 'draft' or decided_at < now() - interval '${RETRY_AFTER_MIN} minutes')
        returning id`, [id, from],
    )
    if (!rows.length) return { ok: false, error: 'already decided' }
    return { ok: true, send: item(row) }
  }

  if (action === 'sent') {
    const ok = body.ok === true
    await sql.query(
      `update transcriber.earnings_messages
          set status = $2, sent_at = case when $2 = 'sent' then now() end, error = $3
        where id = $1 and status = 'approved'`,
      [id, ok ? 'sent' : 'failed', ok ? null : String(body.error ?? 'the bot did not say why').slice(0, 500)],
    )
    return { ok: true }
  }

  return { ok: false, error: `unknown action "${action}"` }
}

export async function alertPosted(id: string): Promise<boolean> {
  const rows = await sql.query(`update transcriber.earnings_alerts set posted_at = now() where id = $1 and posted_at is null returning id`, [id])
  return rows.length > 0
}
