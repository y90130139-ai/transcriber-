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
import { GERMAN_FORMAT_TAG, GERMAN_TYPES, findGerman, germanBrief } from '@/lib/german'
import { taxonomy } from '@/lib/taxonomy'
import DropSelect from '../dashboard/DropSelect'

type Template = { id: string; label: string; format: string | null; body: string | null }

const FORMATS = taxonomy.format.tags

export default function CustomCard({ planId, onAdded }: { planId: string; onAdded: () => void }) {
  const [open, setOpen] = useState(false)
  const [templates, setTemplates] = useState<Template[]>([])
  const [picked, setPicked] = useState('')
  const [label, setLabel] = useState('')
  const [format, setFormat] = useState('')
  /** Which numbered German format, when `format` is the German tag. */
  const [germanNo, setGermanNo] = useState('')
  const [body, setBody] = useState('')
  const [saveAs, setSaveAs] = useState(true)
  /** "We need 7 of the same template" — one ask, N numbered cards. */
  const [count, setCount] = useState(1)
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
      body: JSON.stringify({ custom: { label, format: format || undefined, body, count } }),
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
    setGermanNo('')
    setBody('')
    setPicked('')
    setBusy(false)
    setNote(count > 1 ? `${count} on the week.` : 'On the week.')
    setCount(1)
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
        <DropSelect
          label="Start from a template"
          value={picked}
          onChange={pick}
          options={[
            { value: '', label: 'Blank template…' },
            ...templates.map((template) => ({ value: template.id, label: template.label })),
          ]}
        />
        <DropSelect
          label="Format"
          value={format}
          onChange={(value) => { setFormat(value); setGermanNo('') }}
          options={[
            { value: '', label: 'Format…' },
            ...FORMATS.map((tag) => ({ value: tag.id, label: tag.label })),
          ]}
        />
      </div>

      {/* The German playbook (2026-10-08): one format tag, 57 numbered
          variations. Picking one writes the doc's own row — direction,
          versions, caption — into the card, and the label if it is empty. */}
      {format === GERMAN_FORMAT_TAG && (
        <select
          value={germanNo}
          aria-label="What kind of German format?"
          onChange={(event) => {
            const no = event.target.value
            setGermanNo(no)
            const picked = findGerman(no)
            if (!picked) return
            setLabel((current) => current.trim() ? current : `German #${picked.no} · ${picked.name}`)
            setBody((current) => current.trim() ? `${current.trim()}\n\n${germanBrief(picked)}` : germanBrief(picked))
          }}
        >
          <option value="">What kind of German format?</option>
          {GERMAN_TYPES.map((type) => (
            <optgroup key={type.id} label={`${type.label} — ${type.blurb}`}>
              {type.formats.map((entry) => (
                <option key={entry.no} value={entry.no}>#{entry.no} · {entry.name}</option>
              ))}
            </optgroup>
          ))}
        </select>
      )}
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
      {/* The mixed-source rule (2026-10-08): directions make it a card of
          ours; none make it a blank, parked off their page until written. */}
      {!body.trim() && (
        <p className="customcard-note">
          No directions yet, so this lands as a <b>blank</b> — on the week for the
          team, hidden from them until someone writes it (the Source select on the card).
        </p>
      )}
      <div className="customcard-row">
        <label className="customcard-save">
          <input type="checkbox" checked={saveAs} onChange={(event) => setSaveAs(event.target.checked)} />
          {picked ? 'Update the template too' : 'Keep as a template'}
        </label>
        <label className="customcard-save" title="How many cards of this — each gets its own number">
          ×
          <input
            type="number"
            min={1}
            max={30}
            value={count}
            style={{ width: '4ch' }}
            onChange={(event) => setCount(Math.max(1, Math.min(30, Number(event.target.value) || 1)))}
          />
        </label>
        <button type="button" className="btn btn-small" disabled={busy || !label.trim()} onClick={() => void add()}>
          {busy ? 'Adding…' : count > 1 ? `Add ${count} to the week` : 'Add to the week'}
        </button>
        <button type="button" className="btn btn-small btn-quiet" onClick={() => setOpen(false)}>Close</button>
      </div>
      {note && <p className="customcard-note" role="status">{note}</p>}
    </div>
  )
}
