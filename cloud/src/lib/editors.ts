/**
 * The editing team (Geno, 2026-10-07): each editor gets a token link,
 * exactly like a model's plan link: everything assigned to them, with the
 * notes and the files, no console login. Editing notes are also visible on
 * the creator's plan. Notifying is email when a Resend
 * key is on Vercel; without one, the console still hands over the link to
 * paste into Telegram — the ecosystem degrades, never blocks.
 */
import { randomBytes } from 'node:crypto'
import { sql } from './db'
import { newId } from './models'
import { planMediaFor, r2Config } from './r2'

export type Editor = {
  id: string
  name: string
  email: string | null
  is_head: boolean
  access_token: string
  assigned: number
  waiting: number
}

export async function listEditors(): Promise<Editor[]> {
  const rows = await sql.query(
    `select e.id, e.name, e.email, e.is_head, e.access_token,
            count(i.id)::int as assigned,
            count(i.id) filter (where i.editor_notified_at is null)::int as waiting
       from transcriber.editors e
       left join transcriber.plan_items i on i.editor_id = e.id
      where e.revoked_at is null
      group by e.id
      order by e.is_head desc, lower(e.name)`,
  )
  return rows.map((row) => ({
    id: String(row.id),
    name: String(row.name),
    email: row.email ? String(row.email) : null,
    is_head: Boolean(row.is_head),
    access_token: String(row.access_token),
    assigned: Number(row.assigned ?? 0),
    waiting: Number(row.waiting ?? 0),
  }))
}

export async function createEditor(name: string, email: string | null, isHead: boolean) {
  const [row] = await sql.query(
    `insert into transcriber.editors (id, name, email, is_head, access_token)
     values ($1, $2, $3, $4, $5) returning id`,
    [newId(), name.slice(0, 80), email, isHead, randomBytes(24).toString('base64url')],
  )
  return String(row.id)
}

export async function updateEditor(id: string, patch: { name?: string; email?: string | null; is_head?: boolean }) {
  await sql.query(
    `update transcriber.editors
        set name = coalesce($2, name),
            email = case when $3::bool then $4 else email end,
            is_head = coalesce($5, is_head)
      where id = $1`,
    [id, patch.name?.slice(0, 80) ?? null, 'email' in patch, patch.email ?? null, patch.is_head ?? null],
  )
}

/** One editor's worksheet: every card assigned to them, newest week first.
 *  Fan-facing fields only — the editor
 *  sees the work and the creator's public plan link, never notes to her
 *  or her money. */
export async function cardsForEditor(token: string) {
  const [editor] = await sql.query(
    `select id, name from transcriber.editors where access_token = $1 and revoked_at is null`,
    [token],
  )
  if (!editor) return null

  const rows = await sql.query(
    `select i.id, i.card_no, i.title, i.editing_notes, i.r2_key, i.uploaded_at, i.editor_notified_at,
            i.repurposed_at, p.week_of::text as week_of, m.name as model_name, m.drive_url,
            m.access_token, m.token_revoked_at
       from transcriber.plan_items i
       join transcriber.plans p on p.id = i.plan_id
       join transcriber.models m on m.id = p.model_id
       where i.editor_id = $1
       order by p.week_of desc, i.position`,
    [editor.id],
  )
  // Every editor can reach every creator's public plan link from their sheet,
  // even before a card has been assigned to them.
  const creatorRows = await sql.query(
    `select id, name, access_token
       from transcriber.models
      where token_revoked_at is null
      order by lower(name)`,
  )
  const config = r2Config()
  return {
    editor: { id: String(editor.id), name: String(editor.name) },
    creatorPlans: creatorRows.map((row) => ({
      id: String(row.id),
      name: String(row.name),
      url: `/p/${String(row.access_token)}`,
    })),
    cards: rows.map((row) => {
      const no = row.card_no === null || row.card_no === undefined ? null : Number(row.card_no)
      const weekOf = String(row.week_of).slice(0, 10)
      const media = config && row.r2_key && row.uploaded_at
        ? planMediaFor(config, String(row.r2_key), no ? `V-${no} edit.mp4` : `${String(row.id).slice(0, 12)}.mp4`)
        : null
      return {
        id: String(row.id),
        card: no ? `V-${no}` : String(row.id).slice(0, 6),
        title: row.title ? String(row.title) : null,
        notes: row.editing_notes ? String(row.editing_notes) : '',
        model: String(row.model_name),
        week_of: weekOf,
        folder: row.drive_url ? String(row.drive_url) : null,
        creatorPlan: row.access_token && !row.token_revoked_at
          ? `/p/${String(row.access_token)}?week=${weekOf}`
          : null,
        video: media?.video ?? null,
        download: media?.download ?? null,
        done: Boolean(row.repurposed_at),
      }
    }),
  }
}

/** Email through Resend when the key is there; the caller shows the portal
 *  link either way, so a missing key costs a convenience, not the handoff. */
export async function notifyEditor(editorId: string, origin: string): Promise<{ sent: boolean; why?: string; url: string; waiting: number }> {
  const [editor] = await sql.query(
    `select name, email, access_token from transcriber.editors where id = $1 and revoked_at is null`,
    [editorId],
  )
  if (!editor) throw new Error('no such editor')
  const url = `${origin}/e/${editor.access_token}`

  const rows = await sql.query(
    `select i.id, i.card_no, m.name as model_name, p.week_of::text as week_of
       from transcriber.plan_items i
       join transcriber.plans p on p.id = i.plan_id
       join transcriber.models m on m.id = p.model_id
       where i.editor_id = $1 and i.editor_notified_at is null`,
    [editorId],
  )
  if (rows.length === 0) return { sent: false, why: 'Nothing new to tell them about.', url, waiting: 0 }

  const key = process.env.RESEND_API_KEY
  const from = process.env.RESEND_FROM
  if (!key || !from) {
    return { sent: false, why: 'Email is not set up (RESEND_API_KEY / RESEND_FROM) — copy them the link instead.', url, waiting: rows.length }
  }
  if (!editor.email) return { sent: false, why: 'This editor has no email on file.', url, waiting: rows.length }

  const lines = rows.map((row) =>
    `• V-${row.card_no ?? '?'} — ${row.model_name}, week of ${String(row.week_of).slice(0, 10)}`)
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from,
      to: [String(editor.email)],
      subject: `${rows.length} edit${rows.length === 1 ? '' : 's'} ready for you`,
      text: `Hey ${editor.name},\n\nNew pieces assigned to you:\n\n${lines.join('\n')}\n\nThe creator plan links, notes and files are on your page:\n${url}\n\n— Gosian Media`,
    }),
  }).catch(() => null)
  if (!response?.ok) {
    const detail = response ? ` (${response.status})` : ''
    return { sent: false, why: `The email bounced off Resend${detail} — copy them the link instead.`, url, waiting: rows.length }
  }

  await sql.query(
    `update transcriber.plan_items set editor_notified_at = now() where id = any($1::text[])`,
    [rows.map((row) => String(row.id))],
  )
  return { sent: true, url, waiting: 0 }
}
