/**
 * Messages the assistant drafts for a creator (/q phase 3). Geno's call: anyone
 * in OPS may ask for one, only Geno's own tap sends it. A draft is checked
 * against draft-rules before it is ever shown, re-checked when Send is tapped
 * (she may have been deactivated or unlinked since), and the bot checks the
 * target group again before posting. Mirrors the earnings approve flow.
 */
import { sql } from '../db'
import { newId } from '../models'
import { findModel } from './tools'
import { draftProblems } from './draft-rules'

export async function proposeDraft(chatId: string, createdBy: string | null, modelName: unknown, textRaw: unknown) {
  const text = String(textRaw ?? '').trim()
  const hit = await findModel(modelName)
  const [m] = await sql.query(
    `select m.id, m.name, m.status, m.telegram_chat_id, coalesce(g.skip_campaigns, false) skip_campaigns
       from transcriber.models m left join transcriber.telegram_groups g on g.chat_id = m.telegram_chat_id
      where m.id = $1`, [hit.id])
  if (String(m.status) !== 'active') return { error: `${m.name} is not active, so nothing is sent to her.` }
  if (!m.telegram_chat_id) return { error: `${m.name}'s Telegram group is not linked in the portal.` }
  // Aurore (and any group that skips campaigns) gets no marketing - final.
  if (m.skip_campaigns === true) return { error: `${m.name} gets no marketing messages, so I can't draft one for her.` }
  const others = (await sql.query(`select name from transcriber.models where id <> $1`, [m.id])).map((r) => String(r.name))
  const problems = draftProblems(text, String(m.name), others)
  if (problems.length) return { error: `I can't draft that for ${m.name}: ${problems.join('; ')}. Reword it.` }
  const id = newId()
  await sql.query(
    `insert into transcriber.assistant_drafts (id, chat_id, model_id, model_name, target_chat_id, text, created_by)
     values ($1,$2,$3,$4,$5,$6,$7)`,
    [id, chatId, m.id, m.name, String(m.telegram_chat_id), text, createdBy],
  )
  return { draft_id: id, model: String(m.name), note: 'Shown in OPS with Send / Cancel. Only Geno can tap Send. It goes to her MARKETING topic exactly as written.' }
}

/** Send (Geno's tap, checked by the bot) or Cancel. Send re-checks she is
 *  still active and linked to the same group, then hands the text back. */
export async function decideDraft(id: string, chatId: string, action: 'approve' | 'cancel') {
  const [d] = await sql.query(
    `select d.*, m.status model_status, m.telegram_chat_id current_chat
       from transcriber.assistant_drafts d join transcriber.models m on m.id = d.model_id
      where d.id = $1 and d.chat_id = $2`,
    [id, chatId],
  )
  if (!d) return null
  if (String(d.status) !== 'proposed') return { ok: false, status: String(d.status), model_name: String(d.model_name) }
  if (action === 'cancel') {
    await sql.query(`update transcriber.assistant_drafts set status = 'cancelled', decided_at = now() where id = $1 and status = 'proposed'`, [id])
    return { ok: true, status: 'cancelled', model_name: String(d.model_name) }
  }
  if (String(d.model_status) !== 'active') return { ok: false, status: 'refused', reason: `${d.model_name} is no longer active`, model_name: String(d.model_name) }
  if (String(d.current_chat ?? '') !== String(d.target_chat_id)) return { ok: false, status: 'refused', reason: `${d.model_name}'s group changed since the draft`, model_name: String(d.model_name) }
  const rows = await sql.query(
    `update transcriber.assistant_drafts set status = 'approved', decided_at = now() where id = $1 and status = 'proposed' returning id`, [id])
  if (!rows.length) return { ok: false, status: 'approved', model_name: String(d.model_name) }
  return { ok: true, status: 'approved', model_name: String(d.model_name), text: String(d.text), target_chat_id: String(d.target_chat_id) }
}

export async function recordDraft(id: string, ok: boolean, error: string | null) {
  const rows = await sql.query(
    `update transcriber.assistant_drafts set status = $2, sent_at = case when $3 then now() end, error = $4
      where id = $1 and status = 'approved' returning id`,
    [id, ok ? 'sent' : 'failed', ok, ok ? null : (error ?? 'no reason').slice(0, 300)],
  )
  return rows.length > 0
}
