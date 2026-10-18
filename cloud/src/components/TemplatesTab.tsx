'use client'

/**
 * Templates (Geno, 2026-10-12): the team's own reusable card blanks — a
 * label, a format, the directions. Saved here, they are the same list the
 * Add card panel's Template picker reads, so anything added or deleted on
 * this page shows up there the next time the panel opens.
 *
 * Redesigned (2026-10-13): the console's own frame and kicker, a search over
 * the shelf once it grows, skeleton rows while it reads, a retry when the
 * read fails, and a two-step delete that names what it is about to drop.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import DropSelect from './dashboard/DropSelect'
import { thumbUrl } from '@/lib/format'
import { taxonomy } from '@/lib/taxonomy'

type Template = {
  id: string
  label: string
  format: string | null
  body: string | null
  /** A German template's playbook entry and the video it rides (2026-10-16). */
  variant?: string | null
  job_id?: string | null
  /** Whether that video has a poster frame the card can show (2026-10-18). */
  has_thumb?: boolean
}

const FORMAT_LABELS = new Map(taxonomy.format.tags.map((tag) => [tag.id, tag.label]))
const DELETE_ARM_MS = 4000

export default function TemplatesTab() {
  const [templates, setTemplates] = useState<Template[]>([])
  const [customFormats, setCustomFormats] = useState<{ id: string; label: string }[]>([])
  const [loading, setLoading] = useState(true)
  const [loadFailed, setLoadFailed] = useState(false)
  /** The id being edited — null is a new template. */
  const [editing, setEditing] = useState<string | null>(null)
  const [label, setLabel] = useState('')
  const [format, setFormat] = useState('')
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<{ text: string; bad?: boolean } | null>(null)
  const [find, setFind] = useState('')
  /** The row whose Delete is armed — the second click is the one that drops it. */
  const [armed, setArmed] = useState<string | null>(null)
  const labelInput = useRef<HTMLInputElement>(null)
  const armTimer = useRef<number | null>(null)

  const load = useCallback(async () => {
    setLoadFailed(false)
    const response = await fetch('/api/templates').catch(() => null)
    if (!response?.ok) {
      setLoading(false)
      setLoadFailed(true)
      return
    }
    const data = await response.json().catch(() => ({}))
    setTemplates(Array.isArray(data.templates) ? data.templates as Template[] : [])
    setLoading(false)
  }, [])

  useEffect(() => { void load() }, [load])
  useEffect(() => {
    fetch('/api/formats')
      .then((response) => (response.ok ? response.json() : { formats: [] }))
      .then((data) => {
        setCustomFormats(Array.isArray(data.formats) ? data.formats : [])
      })
      .catch(() => { setCustomFormats([]) })
  }, [])
  useEffect(() => () => { if (armTimer.current) window.clearTimeout(armTimer.current) }, [])

  const formatLabels = useMemo(() => new Map([
    ...FORMAT_LABELS,
    ...customFormats.map((entry) => [entry.id, entry.label] as const),
  ]), [customFormats])

  function startNew() {
    setEditing(null)
    setLabel('')
    setFormat('')
    setBody('')
    setNote(null)
    labelInput.current?.focus()
  }

  function startEdit(template: Template) {
    setEditing(template.id)
    setLabel(template.label)
    setFormat(template.format ?? '')
    setBody(template.body ?? '')
    setNote(null)
    setArmed(null)
    labelInput.current?.focus()
  }

  async function save() {
    if (busy) return
    if (!label.trim()) {
      setNote({ text: 'Give it a label first — it is what the picker shows.', bad: true })
      labelInput.current?.focus()
      return
    }
    setBusy(true)
    const response = await fetch('/api/templates', {
      method: editing ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: editing ?? undefined,
        label: label.trim(),
        format: format || undefined,
        body,
      }),
    }).catch(() => null)
    const data = await response?.json().catch(() => ({})) ?? {}
    setBusy(false)
    if (!response?.ok) {
      setNote({ text: data.error ?? 'That did not save — try again.', bad: true })
      return
    }
    await load()
    setNote({ text: editing ? 'Saved — the picker reads it next time it opens.' : 'Added — the picker reads it next time it opens.' })
    startNew()
  }

  function armDelete(template: Template) {
    if (armTimer.current) window.clearTimeout(armTimer.current)
    setArmed(template.id)
    armTimer.current = window.setTimeout(() => setArmed(null), DELETE_ARM_MS)
  }

  async function remove(template: Template) {
    if (armTimer.current) window.clearTimeout(armTimer.current)
    setArmed(null)
    setTemplates((current) => current.filter((row) => row.id !== template.id))
    if (editing === template.id) startNew()
    await fetch(`/api/templates?id=${encodeURIComponent(template.id)}`, { method: 'DELETE' }).catch(() => null)
    void load()
  }

  const shown = useMemo(() => {
    const needle = find.trim().toLowerCase()
    const filtered = !needle ? templates : templates.filter((template) =>
      template.label.toLowerCase().includes(needle)
      || (template.body ?? '').toLowerCase().includes(needle)
      || (template.format ? (formatLabels.get(template.format) ?? template.format).toLowerCase().includes(needle) : false))
    // Cards with a cover lead the shelf; the blanks sit at the bottom
    // (2026-10-18). A stable sort, so each group keeps its alphabetical order.
    const covered = (template: Template) => Boolean(template.job_id && template.has_thumb)
    return [...filtered].sort((a, b) => Number(covered(b)) - Number(covered(a)))
  }, [templates, find, formatLabels])

  const said = note && <p className="hint" data-tone={note.bad ? 'bad' : undefined} role="status">{note.text}</p>

  return (
    <div className="dash">
      <header className="dash-head">
        <div>
          <p className="dash-kicker">The app</p>
          <h2 className="dash-title">Templates</h2>
          <p className="dash-sub">Reusable card blanks — the Add card picker reads this list.</p>
        </div>
        <span className="chip chip-static">{templates.length} saved</span>
      </header>

      <div className="tpl-grid">
        <section className="tpl-form" aria-label={editing ? 'Edit template' : 'New template'}>
          <p className="axis-name">{editing ? 'Edit template' : 'New template'}</p>
          <div className="form-row">
            <label className="axis-name" htmlFor="tpl-label">Label</label>
            <input
              ref={labelInput}
              id="tpl-label"
              className="field"
              value={label}
              maxLength={120}
              placeholder="What the picker shows"
              onChange={(event) => setLabel(event.target.value)}
            />
            <p className="tpl-hint">The name this blank is listed under, here and in the picker.</p>
          </div>
          <div className="form-row">
            <span className="axis-name">Format</span>
            <DropSelect
              label="Format"
              value={format}
              onChange={setFormat}
              options={[
                { value: '', label: 'Any format' },
                ...taxonomy.format.tags.map((tag) => ({ value: tag.id, label: tag.label })),
                ...customFormats.map((entry) => ({ value: entry.id, label: entry.label, group: 'Our own' })),
              ]}
            />
            <p className="tpl-hint">Leave it any when the blank works for every format.</p>
          </div>
          <div className="form-row">
            <label className="axis-name" htmlFor="tpl-body">Directions</label>
            <textarea
              id="tpl-body"
              className="field"
              rows={6}
              value={body}
              placeholder="What the card says when this template is picked"
              onChange={(event) => setBody(event.target.value)}
            />
            <p className="tpl-hint">The words the card carries when this blank is picked.</p>
          </div>
          {said}
          <div className="tpl-form-foot">
            {editing && (
              <button type="button" className="btn btn-small btn-quiet" onClick={startNew}>Cancel</button>
            )}
            <button type="button" className="btn btn-small" disabled={busy} onClick={() => void save()}>
              {busy ? 'Saving…' : editing ? 'Save changes' : 'Add template'}
            </button>
          </div>
        </section>

        <section className="tpl-list" aria-label="Saved templates">
          {!loading && !loadFailed && templates.length > 0 && (
            <div className="tpl-list-bar">
              <label className="tpl-search">
                <input
                  value={find}
                  onChange={(event) => setFind(event.target.value)}
                  placeholder="Find a template"
                  aria-label="Find a template"
                />
              </label>
              <span className="tpl-count">
                {find.trim() ? `${shown.length} of ${templates.length}` : `${templates.length} saved`}
              </span>
            </div>
          )}

          {loading && (
            <div aria-busy="true" aria-label="Reading the templates">
              {[0, 1, 2].map((index) => (
                <div className="tpl-item tpl-skel" key={index} aria-hidden>
                  <span className="tpl-skel-cover" />
                  <div className="tpl-skel-main">
                    <span className="tpl-skel-bar" />
                    <span className="tpl-skel-bar tpl-skel-body" />
                  </div>
                </div>
              ))}
            </div>
          )}

          {!loading && loadFailed && (
            <p className="hint" data-tone="bad">
              Could not read the templates.{' '}
              <button type="button" className="pill" onClick={() => { setLoading(true); void load() }}>Retry</button>
            </p>
          )}

          {!loading && !loadFailed && templates.length === 0 && (
            <p className="tpl-empty">
              None yet — write the first one on the left; it shows up here and in the plan editor's picker.
            </p>
          )}

          {!loading && !loadFailed && templates.length > 0 && shown.length === 0 && (
            <p className="tpl-empty">
              No template matches “{find.trim()}”.{' '}
              <button type="button" className="pill" onClick={() => setFind('')}>Clear</button>
            </p>
          )}

          {!loading && shown.map((template) => (
            <article className="tpl-item" key={template.id} data-editing={editing === template.id || undefined}>
              <TplCover jobId={template.job_id ?? null} hasThumb={Boolean(template.has_thumb)} />
              <div className="tpl-item-main">
                <div className="tpl-item-top">
                  <span className="tpl-item-label">{template.label}</span>
                  {template.format && (
                    <span className="tpl-tag">{formatLabels.get(template.format) ?? template.format}</span>
                  )}
                  <div className="tpl-item-actions">
                    <button type="button" className="btn btn-small btn-quiet" onClick={() => startEdit(template)}>
                      Edit
                    </button>
                    {armed === template.id ? (
                      <button
                        type="button"
                        className="btn btn-small tpl-armed"
                        onClick={() => void remove(template)}
                        title={`Delete “${template.label}”`}
                      >
                        Confirm delete
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="btn btn-small btn-quiet"
                        onClick={() => armDelete(template)}
                        title={`Delete “${template.label}”`}
                      >
                        Delete
                      </button>
                    )}
                  </div>
                </div>
                {template.body && <p className="tpl-item-body">{template.body}</p>}
              </div>
            </article>
          ))}
        </section>
      </div>
    </div>
  )
}

/** The attached reference video's frame, left of the card (2026-10-18).
 *  A template with no video — or one whose poster frame the store no longer
 *  holds — keeps the same tile as a quiet blank, so the column never breaks. */
function TplCover({ jobId, hasThumb }: { jobId: string | null; hasThumb: boolean }) {
  const [failed, setFailed] = useState(false)
  const src = jobId && hasThumb && !failed ? thumbUrl(jobId) : null
  return (
    <span className="tpl-cover" aria-hidden="true">
      {src && (
        <img
          src={src}
          alt=""
          width={64}
          height={80}
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
        />
      )}
      {src ? (
        <span className="tpl-cover-play">
          <svg width="7" height="8" viewBox="0 0 7 8" fill="currentColor">
            <path d="M7 4 0 8V0l7 4Z" />
          </svg>
        </span>
      ) : (
        <svg
          className="tpl-cover-glyph"
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
        >
          <rect x="2.2" y="2.8" width="11.6" height="10.4" rx="1.8" />
          <path d="M2.2 6.2h11.6" />
        </svg>
      )}
    </span>
  )
}
