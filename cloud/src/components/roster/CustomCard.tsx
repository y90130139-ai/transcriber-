'use client'

/**
 * A custom card for the plan (Geno, 2026-10-07): no library video behind
 * it — the team labels it, picks its format from the taxonomy's own list,
 * writes the directions, and it lands on her week like any other card
 * (minus the "Watch it" step, since there is nothing to watch).
 *
 * Templates make it repeatable: save one and it "just stays there" for
 * every later week, editable when a label was fat-fingered. Picking a
 * template prefills the fields; the card itself is always written fresh,
 * so a later template edit never rewrites cards already sent.
 */
import { useEffect, useState } from 'react'
import { taxonomy } from '@/lib/taxonomy'

type Template = { id: string; label: string; format: string | null; body: string | null }

const FORMATS = taxonomy.format.tags

export default function CustomCard({ planId, onAdded }: { planId: string; onAdded: () => void }) {
  const [open, setOpen] = useState(false)
  const [templates, setTemplates] = useState<Template[]>([])
  const [picked, setPicked] = useState('')
  const [label, setLabel] = useState('')
  const [format, setFormat] = useState('')
  const [body, setBody] = useState('')
  const [saveAs, setSaveAs] = useState(true)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    fetch('/api/templates')
      .then((response) => (response.ok ? response.json() : { templates: [] }))
      .then((data) => setTemplates(data.templates ?? []))
      .catch(() => setTemplates([]))
  }, [open])

  function pick(id: string) {
    setPicked(id)
    const template = templates.find((entry) => entry.id === id)
    if (!template) return
    setLabel(template.label)
    setFormat(template.format ?? '')
    setBody(template.body ?? '')
  }

  async function add() {
    if (!label.trim() || busy) return
    setBusy(true)
    setNote(null)
    const response = await fetch(`/api/plans/${planId}/items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ custom: { label, format: format || undefined, body } }),
    }).catch(() => null)
    if (!response?.ok) {
      setNote('The card did not land — try again.')
      setBusy(false)
      return
    }
    // The template outlives the card. Editing an existing pick updates it
    // in place; a fresh set of fields becomes a new one.
    if (saveAs) {
      const payload = { id: picked || undefined, label, format: format || undefined, body }
      await fetch('/api/templates', {
        method: picked ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }).catch(() => null)
    }
    setLabel('')
    setFormat('')
    setBody('')
    setPicked('')
    setBusy(false)
    setNote('On the week.')
    onAdded()
  }

  if (!open) {
    return (
      <button type="button" className="btn btn-small customcard-open" onClick={() => setOpen(true)}>
        + Custom card
      </button>
    )
  }

  return (
    <div className="customcard" role="group" aria-label="Add a custom card">
      <div className="customcard-row">
        <select value={picked} onChange={(event) => pick(event.target.value)} aria-label="Start from a template">
          <option value="">Blank template…</option>
          {templates.map((template) => (
            <option key={template.id} value={template.id}>{template.label}</option>
          ))}
        </select>
        <select value={format} onChange={(event) => setFormat(event.target.value)} aria-label="Format">
          <option value="">Format…</option>
          {FORMATS.map((tag) => (
            <option key={tag.id} value={tag.id}>{tag.label}</option>
          ))}
        </select>
      </div>
      <input
        type="text"
        value={label}
        onChange={(event) => setLabel(event.target.value)}
        placeholder="Label — what this card is (e.g. Weekly car Q&A)"
        maxLength={120}
      />
      <textarea
        value={body}
        onChange={(event) => setBody(event.target.value)}
        placeholder="Directions — what to film, what to say, anything she needs"
        rows={3}
      />
      <div className="customcard-row">
        <label className="customcard-save">
          <input type="checkbox" checked={saveAs} onChange={(event) => setSaveAs(event.target.checked)} />
          {picked ? 'Update the template too' : 'Keep as a template'}
        </label>
        <button type="button" className="btn btn-small" disabled={busy || !label.trim()} onClick={() => void add()}>
          {busy ? 'Adding…' : 'Add to the week'}
        </button>
        <button type="button" className="btn btn-small btn-quiet" onClick={() => setOpen(false)}>Close</button>
      </div>
      {note && <p className="customcard-note" role="status">{note}</p>}
    </div>
  )
}
