'use client'

/**
 * The editing team in the plan editor (Geno, 2026-10-07).
 *
 * Editing notes are in-house: her page never renders them any more; this
 * is where they go instead. Each card can be pointed at an editor, even
 * while its note is still being prepared; "Tell them" emails newly assigned work (when
 * Resend is configured) and always hands over their token link to paste
 * into Telegram — same idea as a model's plan link, no login.
 */
import { useCallback, useEffect, useState } from 'react'
import DropSelect from '../dashboard/DropSelect'

export type EditorRow = {
  id: string
  name: string
  email: string | null
  is_head: boolean
  access_token: string
  assigned: number
  waiting: number
}

export function useEditors() {
  const [editors, setEditors] = useState<EditorRow[]>([])
  const reload = useCallback(async () => {
    const response = await fetch('/api/editors').catch(() => null)
    if (response?.ok) setEditors((await response.json()).editors ?? [])
  }, [])
  useEffect(() => { void reload() }, [reload])
  return { editors, reload }
}

/** The per-card select, under the editing-notes box. */
export function EditorAssign({ itemId, editors, value, onChanged }: {
  itemId: string
  editors: EditorRow[]
  value: string | null
  onChanged: () => void
}) {
  const assigned = editors.some((editor) => editor.id === value) ? value ?? '' : ''
  return (
    <label className="editorassign">
      <span className="axis-name">Editor</span>
      <DropSelect
        label="Editor"
        value={assigned}
        disabled={editors.length === 0}
        onChange={(next) => {
          void fetch('/api/editors', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ assign: { item_id: itemId, editor_id: next || null } }),
          }).then(() => onChanged())
        }}
        options={[
          { value: '', label: 'Nobody yet' },
          ...editors.map((editor) => ({
            value: editor.id,
            label: `${editor.name}${editor.is_head ? ' · head' : ''}`,
          })),
        ]}
      />
    </label>
  )
}

/** The team panel: who they are, what is waiting on them, the notify
 *  button and their link. Adding someone takes a name; email is optional
 *  and only matters once Resend is configured. */
export function EditorsPanel({ editors, reload }: { editors: EditorRow[]; reload: () => void }) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [said, setSaid] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  async function add() {
    if (!name.trim()) return
    await fetch('/api/editors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email: email || undefined, is_head: editors.length === 0 }),
    }).catch(() => null)
    setName('')
    setEmail('')
    reload()
  }

  async function notify(editor: EditorRow) {
    setBusy(editor.id)
    setSaid(null)
    const response = await fetch('/api/editors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notify: editor.id }),
    }).catch(() => null)
    const body = await response?.json().catch(() => null)
    if (body?.sent) setSaid(`Emailed ${editor.name}.`)
    else setSaid(body?.why ?? 'That did not go out.')
    setBusy(null)
    reload()
  }

  async function copyLink(editor: EditorRow) {
    const url = `${window.location.origin}/e/${editor.access_token}`
    await navigator.clipboard?.writeText(url).catch(() => null)
    setSaid(`${editor.name}'s link copied — paste it to them once; it stays the same.`)
  }

  return (
    <div className="editorspanel" data-open={open || undefined}>
      <button type="button" className="editorspanel-toggle" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className="queue-fold-title">Editors</span>
        <span className="queue-fold-count">
          {editors.length} on the team
          {editors.some((e) => e.waiting > 0) && <b> · {editors.reduce((n, e) => n + e.waiting, 0)} to send</b>}
        </span>
      </button>
      {open && (
        <div className="editorspanel-body">
          {editors.map((editor) => (
            <div className="editorspanel-row" key={editor.id}>
              <span className="editorspanel-name">
                {editor.name}{editor.is_head ? ' · head' : ''}
                <small>{editor.email ?? 'no email'} · {editor.assigned} assigned{editor.waiting ? ` · ${editor.waiting} new` : ''}</small>
              </span>
              <button type="button" className="chip" disabled={busy === editor.id || editor.waiting === 0}
                onClick={() => void notify(editor)}>
                {busy === editor.id ? 'Sending…' : 'Tell them'}
              </button>
              <button type="button" className="chip" onClick={() => void copyLink(editor)}>Copy link</button>
            </div>
          ))}
          <div className="editorspanel-row">
            <input type="text" value={name} placeholder="Name" aria-label="Editor name" onChange={(event) => setName(event.target.value)} />
            <input type="email" value={email} placeholder="Email (optional)" aria-label="Editor email" onChange={(event) => setEmail(event.target.value)} />
            <button type="button" className="chip" disabled={!name.trim()} onClick={() => void add()}>Add</button>
          </div>
          {said && <p className="editorspanel-said" role="status">{said}</p>}
        </div>
      )}
    </div>
  )
}
