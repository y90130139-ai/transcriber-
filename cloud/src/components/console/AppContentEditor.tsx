'use client'

/**
 * App Content (Geno, 2026-10-14): every word the client app shows — the
 * welcome, the onboarding checklist, the FAQ, the Client SOP, the
 * expectations page and the management agreement.
 *
 * Read first, edit on demand (Geno's redesign, 2026-10-14): a page opens as
 * the document itself — the way she will read it, no forms, no field labels,
 * no chrome — with a single Edit button. Edit switches the same page into
 * the writing surface: the head fields, the Notion-style BlockNote editor
 * (the same one the SOPs use on ai-invoice), and the two small structured
 * panels the app needs (the welcome's chips, the onboarding's doors).
 * Publishing returns to the read view.
 *
 * Instant by construction (2026-10-14): the documents are read on the server
 * (the layout above), so this shell starts with the data in hand — no
 * fetch, no "reading…" state. The read view is plain HTML from
 * `lib/markdown.ts`, so it paints with the page; the BlockNote chunk is
 * warmed in the background and only mounted when Edit is pressed.
 *
 * One document per page — /app-content/welcome, /onboarding, /faq, /sop,
 * /expectations, /agreement — listed as sub-tabs in the sidebar. Publish
 * writes one document to `transcriber.app_content`; the app pulls those rows
 * on focus and on a slow timer, so what is published here is what she reads
 * — no app release, no waiting.
 *
 * The layout keeps this component mounted across the document pages, so a
 * draft survives switching tabs and lives only in this browser until
 * Publish; "Reset to default" puts the built-in copy back.
 */
import dynamic from 'next/dynamic'
import { usePathname } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  APP_CONTENT_INFO,
  APP_CONTENT_KEYS,
  type AppContentKey,
  type AppContentSnapshot,
  type AppDoc,
  type ContentMeta,
  type RichDoc,
  type StepKey,
} from '@/lib/app-content'
import { markdownToHtml } from '@/lib/markdown'
import DropSelect from '../dashboard/DropSelect'

/** BlockNote must not render on the server — hydrate it in the browser, and
 *  only when Edit is pressed (warmed in the background below). */
const RichBody = dynamic(() => import('./AppContentRichBody'), {
  ssr: false,
  loading: () => <p className="hint ac-rich-loading">Opening the editor…</p>,
})

type Snapshot = AppContentSnapshot

const STEP_TARGETS = [
  { value: 'agreement', label: 'Agreement form' },
  { value: 'contact', label: 'Contact form' },
  { value: 'intake', label: 'Intake form' },
]

const ACTION_TARGETS = [
  { value: 'inbox', label: 'Messages' },
  { value: 'plan', label: 'This week’s plan' },
]

const STEP_KEYS = ['agreement', 'contact', 'intake'] as const

/** The first form no row is on yet — a fresh step never lands on a target a
 *  sibling already owns. */
function firstFreeStepKey(items: { key: StepKey }[]): StepKey {
  const used = new Set(items.map((item) => item.key))
  return STEP_KEYS.find((key) => !used.has(key)) ?? 'agreement'
}

function move<T>(items: T[], index: number, delta: number): T[] {
  const next = index + delta
  if (next < 0 || next >= items.length) return items
  const copy = items.slice()
  const [item] = copy.splice(index, 1)
  copy.splice(next, 0, item)
  return copy
}

/** Which document a /app-content page is (2026-10-14): every document is its
 *  own page — /app-content/welcome, /faq, /sop and so on — listed as
 *  sub-tabs under App Content in the sidebar. Unknown paths land on the
 *  welcome. */
export function docKeyFromPath(pathname: string): AppContentKey {
  const id = pathname.split('/')[2] ?? ''
  return (APP_CONTENT_KEYS as readonly string[]).includes(id) ? (id as AppContentKey) : 'welcome'
}

// ------------------------------------------------------------- the editors

function ActionsEditor({ actions, onChange }: { actions: RichDoc['actions']; onChange: (next: RichDoc['actions']) => void }) {
  if (!actions) return null
  return (
    <div className="ac-fields">
      <label className="ac-field-note">
        <span>Card title</span>
        <input className="field" value={actions.label} onChange={(event) => onChange({ ...actions, label: event.target.value })} />
      </label>
      {actions.items.map((item, index) => (
        <div className="ac-kv-row" key={index}>
          <input className="field" value={item.label} placeholder="Chip label" onChange={(event) =>
            onChange({ ...actions, items: actions.items.map((old, at) => (at === index ? { ...old, label: event.target.value } : old)) })} />
          <DropSelect
            label="Where the chip goes"
            value={item.go}
            options={ACTION_TARGETS}
            onChange={(go) => onChange({ ...actions, items: actions.items.map((old, at) => (at === index ? { ...old, go: go as 'inbox' | 'plan' } : old)) })}
          />
          <div className="ac-line-tools">
            <button type="button" className="ac-icon" disabled={index === 0} title="Move up"
              onClick={() => onChange({ ...actions, items: move(actions.items, index, -1) })}>↑</button>
            <button type="button" className="ac-icon" disabled={index === actions.items.length - 1} title="Move down"
              onClick={() => onChange({ ...actions, items: move(actions.items, index, 1) })}>↓</button>
            <button type="button" className="ac-icon ac-icon-bad" title="Remove"
              onClick={() => onChange({ ...actions, items: actions.items.filter((_, at) => at !== index) })}>×</button>
          </div>
        </div>
      ))}
      {actions.items.length < 4 && (
        <button type="button" className="btn btn-small btn-quiet"
          onClick={() => onChange({ ...actions, items: [...actions.items, { label: '', go: 'inbox' }] })}>
          Add chip
        </button>
      )}
    </div>
  )
}

function StepsEditor({ steps, onChange }: { steps: RichDoc['steps']; onChange: (next: RichDoc['steps']) => void }) {
  if (!steps) return null
  return (
    <div className="ac-fields">
      {steps.map((item, index) => (
        <div className="ac-step" key={index}>
          <DropSelect
            label="Which form"
            value={item.key}
            options={STEP_TARGETS.map((option) => ({
              ...option,
              // One row per form — two rows on the same target would tick
              // together, which is never what anyone means.
              disabled: steps.some((other, at) => at !== index && other.key === option.value),
            }))}
            onChange={(key) => onChange(steps.map((old, at) => (at === index ? { ...old, key: key as StepKey } : old)))}
          />
          <div className="ac-step-text">
            <input className="field" value={item.title} placeholder="Step title" onChange={(event) =>
              onChange(steps.map((old, at) => (at === index ? { ...old, title: event.target.value } : old)))} />
            <input className="field" value={item.hint} placeholder="One-line hint" onChange={(event) =>
              onChange(steps.map((old, at) => (at === index ? { ...old, hint: event.target.value } : old)))} />
          </div>
          <div className="ac-line-tools">
            <button type="button" className="ac-icon" disabled={index === 0} title="Move up"
              onClick={() => onChange(move(steps, index, -1))}>↑</button>
            <button type="button" className="ac-icon" disabled={index === steps.length - 1} title="Move down"
              onClick={() => onChange(move(steps, index, 1))}>↓</button>
            <button type="button" className="ac-icon ac-icon-bad" title="Remove"
              onClick={() => onChange(steps.filter((_, at) => at !== index))}>×</button>
          </div>
        </div>
      ))}
      {steps.length < 6 && (
        <button type="button" className="btn btn-small btn-quiet"
          onClick={() => onChange([...steps, { key: firstFreeStepKey(steps), title: '', hint: '' }])}>
          Add step
        </button>
      )}
    </div>
  )
}

// ------------------------------------------------------------ the previews

/** The welcome chips as she meets them — labels, and the screen each opens. */
function PreviewActions({ actions }: { actions: NonNullable<RichDoc['actions']> }) {
  return (
    <div className="ac-preview">
      {actions.label ? <p className="ac-paper-label">{actions.label}</p> : null}
      <div className="ac-pill-row">
        {actions.items.map((item, index) => (
          <span className="ac-pill" key={index}>
            {item.label || '(empty)'}
            <em>{item.go === 'plan' ? 'This week’s plan' : 'Messages'}</em>
          </span>
        ))}
      </div>
    </div>
  )
}

/** The onboarding doors as she meets them. */
function PreviewSteps({ steps }: { steps: NonNullable<RichDoc['steps']> }) {
  return (
    <div className="ac-preview">
      <p className="ac-paper-label">Checklist doors</p>
      <div className="ac-step-list">
        {steps.map((step) => (
          <div className="ac-step-row" key={step.key}>
            <span className="ac-step-title">{step.title || '(untitled step)'}</span>
            {step.hint ? <span className="ac-step-hint">{step.hint}</span> : null}
            <span className="ac-step-key">{STEP_TARGETS.find((target) => target.value === step.key)?.label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ------------------------------------------------------------- the page

/** The client shell the server layout hands the snapshot to (2026-10-14).
 *  It stays mounted across the document pages, so drafts survive switching
 *  sub-tabs; the read view it draws is plain HTML, and the editor's chunk is
 *  warmed in the background so Edit opens without a wait. */
export default function AppContentShell({ initial, children }: {
  initial: Snapshot | null
  /** The route pages themselves (they render nothing) — kept so the
   *  addresses under the shell stay real. */
  children?: React.ReactNode
}) {
  const pathname = usePathname()
  const active = docKeyFromPath(pathname)
  const [snapshot, setSnapshot] = useState<Snapshot | null>(initial)
  const [drafts, setDrafts] = useState<Partial<Record<AppContentKey, AppDoc>>>({})
  const [mode, setMode] = useState<'read' | 'edit'>('read')
  // With the snapshot from the server there is nothing to wait for; only the
  // fallback path (server could not reach the store) ever shows a loader.
  const [loading, setLoading] = useState(initial === null)
  const [failed, setFailed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<{ text: string; bad?: boolean } | null>(null)
  const [armed, setArmed] = useState(false)
  const armTimer = useRef<number | null>(null)

  const load = useCallback(async () => {
    setFailed(false)
    const response = await fetch('/api/app-content').catch(() => null)
    if (!response?.ok) {
      setLoading(false)
      setFailed(true)
      return
    }
    const data = (await response.json().catch(() => ({}))) as Partial<Snapshot>
    if (data.docs && data.meta) setSnapshot(data as Snapshot)
    setLoading(false)
  }, [])

  useEffect(() => {
    if (initial === null) void load()
  }, [initial, load])
  useEffect(() => () => { if (armTimer.current) window.clearTimeout(armTimer.current) }, [])

  // Warm the editor's chunk while the page sits idle, so the first Edit
  // press opens the writing surface without fetching anything.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const warm = () => { void import('./AppContentRichBody') }
    if (typeof window.requestIdleCallback === 'function') {
      const id = window.requestIdleCallback(warm)
      return () => window.cancelIdleCallback(id)
    }
    const timer = window.setTimeout(warm, 1200)
    return () => window.clearTimeout(timer)
  }, [])

  const draft = snapshot ? drafts[active] ?? snapshot.docs[active] : null
  const saved = snapshot?.docs[active] ?? null
  const dirty = Boolean(draft && saved && JSON.stringify(draft) !== JSON.stringify(saved))
  const meta = snapshot?.meta[active] ?? null
  const info = APP_CONTENT_INFO[active]

  const edit = useCallback(
    (next: AppDoc) => setDrafts((current) => ({ ...current, [active]: next })),
    [active],
  )

  // A page change starts clean: read mode, no note, no armed reset.
  useEffect(() => {
    setMode('read')
    setNote(null)
    setArmed(false)
  }, [active])

  function discard() {
    setDrafts((current) => {
      const next = { ...current }
      delete next[active]
      return next
    })
    setNote(null)
    setArmed(false)
    setMode('read')
  }

  async function publish() {
    if (!draft || busy) return
    setBusy(true)
    setNote(null)
    const response = await fetch('/api/app-content', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: active, doc: draft }),
    }).catch(() => null)
    const data = await response?.json().catch(() => ({})) ?? {}
    setBusy(false)
    if (!response?.ok) {
      setNote({ text: (data as { error?: string }).error ?? 'That did not publish — try again.', bad: true })
      return
    }
    setSnapshot((current) => (current ? {
      ...current,
      docs: { ...current.docs, [active]: (data as { doc: AppDoc }).doc },
      meta: { ...current.meta, [active]: (data as { meta: ContentMeta }).meta },
    } : current))
    setDrafts((current) => {
      const next = { ...current }
      delete next[active]
      return next
    })
    setMode('read')
    setNote({ text: 'Published — her app picks it up the next time the screen opens, or within a minute.' })
  }

  function armReset() {
    if (armTimer.current) window.clearTimeout(armTimer.current)
    setArmed(true)
    armTimer.current = window.setTimeout(() => setArmed(false), 4000)
  }

  async function reset() {
    if (busy) return
    if (armTimer.current) window.clearTimeout(armTimer.current)
    setArmed(false)
    setBusy(true)
    setNote(null)
    const response = await fetch(`/api/app-content?key=${encodeURIComponent(active)}`, { method: 'DELETE' }).catch(() => null)
    const data = await response?.json().catch(() => ({})) ?? {}
    setBusy(false)
    if (!response?.ok) {
      setNote({ text: (data as { error?: string }).error ?? 'That did not reset — try again.', bad: true })
      return
    }
    setSnapshot((current) => (current ? {
      ...current,
      docs: { ...current.docs, [active]: (data as { doc: AppDoc }).doc },
      meta: { ...current.meta, [active]: (data as { meta: ContentMeta }).meta },
    } : current))
    setDrafts((current) => {
      const next = { ...current }
      delete next[active]
      return next
    })
    setMode('read')
    setNote({ text: 'Back to the built-in copy — the app sees it the same way.' })
  }

  const editedCount = APP_CONTENT_KEYS.filter((key) => snapshot?.meta[key]?.edited).length
  const metaText = [
    meta?.edited
      ? `Published ${meta.updatedAt ? new Date(meta.updatedAt).toLocaleString() : ''}${meta.updatedBy ? ` by ${meta.updatedBy}` : ''}`
      : snapshot?.migrated
        ? 'Built-in copy'
        : 'Built-in copy — migration pending',
    `${editedCount} of ${APP_CONTENT_KEYS.length} documents edited`,
  ].join(' · ')

  const editing = mode === 'edit'
  const canWrite = Boolean(snapshot?.migrated)
  // The read view's HTML — computed synchronously from the stored markdown,
  // so the document paints with the first render (and rides the server's
  // HTML on a fresh load). No editor runtime is involved in reading.
  const bodyHtml = useMemo(() => markdownToHtml(draft?.body ?? ''), [draft?.body])
  const said = note && <p className="hint" data-tone={note.bad ? 'bad' : undefined} role="status">{note.text}</p>

  return (
    <div className="dash ac-doc">
      <header className="ac-top">
        <div className="ac-top-title">
          <h2>{info.label}</h2>
          <p className="ac-top-meta">{metaText}</p>
        </div>
        <div className="ac-top-tools">
          {dirty && <span className="ac-tag">Unpublished changes</span>}
          {editing ? (
            <>
              {dirty && (
                <button type="button" className="btn btn-small btn-quiet" onClick={discard}>
                  Discard
                </button>
              )}
              {canWrite && (armed ? (
                <button type="button" className="btn btn-small ac-armed" disabled={busy} onClick={() => void reset()}>
                  Confirm reset
                </button>
              ) : (
                <button type="button" className="btn btn-small btn-quiet" disabled={busy} onClick={armReset}
                  title="Put the built-in copy back — the app sees it immediately">
                  Reset to default
                </button>
              ))}
              <button type="button" className="btn btn-small" disabled={!dirty || busy || !canWrite} onClick={() => void publish()}>
                {busy ? 'Publishing…' : 'Publish'}
              </button>
              <button type="button" className="btn btn-small btn-quiet" onClick={() => setMode('read')}>
                Done
              </button>
            </>
          ) : (
            <>
              {dirty && (
                <>
                  <button type="button" className="btn btn-small btn-quiet" onClick={discard}>
                    Discard
                  </button>
                  <button type="button" className="btn btn-small" disabled={busy || !canWrite} onClick={() => void publish()}>
                    {busy ? 'Publishing…' : 'Publish'}
                  </button>
                </>
              )}
              <button type="button" className="btn btn-small btn-quiet" onClick={() => setMode('edit')}>
                Edit
              </button>
            </>
          )}
        </div>
      </header>

      {said}

      {loading && (
        <p className="hint">Reading the documents…</p>
      )}

      {!loading && failed && (
        <p className="hint" data-tone="bad">
          Could not read the documents.{' '}
          <button type="button" className="pill" onClick={() => { setLoading(true); void load() }}>Retry</button>
        </p>
      )}

      {!loading && !failed && snapshot && !snapshot.migrated && (
        <p className="hint ac-warn" role="alert">
          <strong>The app_content table is missing.</strong>{' '}
          Run <code>npm run migrate</code> in <code>cloud/</code>, then reload this page — until then these
          pages show the built-in copy and publishing stays off.
        </p>
      )}

      {!loading && !failed && draft && (
        editing ? (
          <section className="dash-panel ac-edit" aria-label={`${info.label} editor`}>
            {info.note ? <p className="hint ac-edit-hint">{info.note}</p> : null}

            <div className="ac-head">
              <label className="ac-field-note">
                <span>Screen title (top bar)</span>
                <input className="field" value={draft.title} onChange={(event) => edit({ ...draft, title: event.target.value })} />
              </label>
              <label className="ac-field-note">
                <span>Kicker</span>
                <input className="field" value={draft.kicker} onChange={(event) => edit({ ...draft, kicker: event.target.value })} />
              </label>
              <label className="ac-field-note ac-span-2">
                <span>Headline</span>
                <input className="field" value={draft.headline} onChange={(event) => edit({ ...draft, headline: event.target.value })} />
              </label>
              <label className="ac-field-note ac-span-2">
                <span>Intro paragraph</span>
                <input className="field" value={draft.lede} onChange={(event) => edit({ ...draft, lede: event.target.value })} />
              </label>
            </div>

            <div className="ac-field-note">
              <span>Document</span>
              <RichBody value={draft.body} onChange={(body) => edit({ ...draft, body })} />
            </div>

            {draft.actions ? (
              <div className="ac-panel">
                <p className="ac-panel-title">Action chips</p>
                <p className="ac-panel-note">The card at the top of her welcome. Each chip opens a real screen.</p>
                <ActionsEditor actions={draft.actions} onChange={(actions) => edit({ ...draft, actions })} />
              </div>
            ) : null}

            {draft.steps ? (
              <div className="ac-panel">
                <p className="ac-panel-title">Checklist doors</p>
                <p className="ac-panel-note">The onboarding steps. Each door opens its own form and keeps its own tick.</p>
                <StepsEditor steps={draft.steps} onChange={(steps) => edit({ ...draft, steps })} />
              </div>
            ) : null}
          </section>
        ) : (
          <article className="ac-paper" aria-label={`${info.label} — as she reads it`}>
            {draft.kicker ? <p className="ac-paper-kicker">{draft.kicker}</p> : null}
            {draft.headline ? <h3 className="ac-paper-headline">{draft.headline}</h3> : null}
            {draft.lede ? <p className="ac-paper-lede">{draft.lede}</p> : null}
            <div className="ac-paper-rule" />
            <div
              className="ac-doc-body"
              // Plain HTML out of lib/markdown.ts — every string escaped
              // there, and the only tags are the ones the renderer writes.
              dangerouslySetInnerHTML={{ __html: bodyHtml }}
            />
            {draft.actions ? <PreviewActions actions={draft.actions} /> : null}
            {draft.steps ? <PreviewSteps steps={draft.steps} /> : null}
          </article>
        )
      )}

      {children}
    </div>
  )
}
