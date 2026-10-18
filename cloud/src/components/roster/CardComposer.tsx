'use client'

/**
 * Adding cards (Geno, 2026-10-09): "just add a card, then pick from the
 * library, and all the settings and templates are right there" — and several
 * at once, saved as they are built, so a week's drafts are still there the
 * next time that model's week is opened.
 *
 * The composer holds a stack of draft cards. Each one is either:
 *
 *   • based on library videos — ticked or dragged from the wall on the left,
 *     which is only pickable while the draft being edited is that kind; each
 *     video lands as its own card with its brief drafted (appendItems), and
 *     anything set on the draft (label, format, directions) is then laid over
 *     the cards that just arrived; or
 *   • written — no video behind it, the old custom card: label, format from
 *     the taxonomy, directions, N numbered copies.
 *
 * Templates prefill a draft and can be kept from one. Every draft is saved to
 * this device per week as it is typed; adding takes a draft off the stack,
 * and a draft that could not go on (a video already on the week, one she
 * turned down) stays with the reason written on it rather than vanishing.
 */
import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { GERMAN_FORMAT_TAG, GERMAN_TYPES, findGerman, germanBrief } from '@/lib/german'
import { taxonomy } from '@/lib/taxonomy'
import DropSelect from '../dashboard/DropSelect'
import { type Pick, type Selection } from './PickVideos'

type Template = { id: string; label: string; format: string | null; body: string | null }
type Basis = 'library' | 'written'

/** What the items route hands back so the week can paint without a reload. */
export type AddedCard = {
  id: string
  job_id: string | null
  position: number
  notes: string | null
  item_title: string | null
  bucket: string | null
  source: string | null
  card_no: number | null
  has_thumb?: boolean
  /** The content-style lane it landed under (lib/styles.ts, 2026-10-12) —
   *  the Add content composer's cards carry one, the older tiles leave it null. */
  style?: string | null
  /** Temporary live preview from a selected social feed while its queue job
   *  is downloading its permanent poster frame. */
  cover_preview_url?: string | null
  hook?: string | null
  caption?: string | null
  wardrobe?: string | null
  editing_notes?: string | null
  location?: string | null
}

type Draft = {
  id: string
  basis: Basis
  /** The wall's own keys with their picks, so switching drafts re-ticks them. */
  picks: [string, Pick][]
  /** The template it started from, if any. */
  template: string
  label: string
  format: string
  germanNo: string
  body: string
  count: number
  saveAs: boolean
  /** Why the last add did not go through — kept on the draft until edited. */
  error?: string
}

type Stored = { drafts: Draft[]; active: string; at: number }

const FORMATS = taxonomy.format.tags
/** Picks shown by face before the rest become a count. */
const SHOWN_PICKS = 8
const storeKey = (planId: string) => `card-drafts:v2:${planId}`
/** The single-card draft the first version kept; read once and folded in. */
const legacyKey = (planId: string) => `customcard-draft:v1:${planId}`

const newDraftId = () => Math.random().toString(36).slice(2, 10)

function blankDraft(basis: Basis = 'library'): Draft {
  return {
    id: newDraftId(), basis, picks: [], template: '', label: '', format: '',
    germanNo: '', body: '', count: 1, saveAs: true,
  }
}

const hasContent = (draft: Draft) =>
  Boolean(draft.label.trim() || draft.body.trim() || draft.picks.length > 0 || draft.template || draft.format)

function readStore(planId: string): Stored | null {
  if (typeof window === 'undefined') return null
  try {
    const parsed = JSON.parse(window.localStorage.getItem(storeKey(planId)) ?? 'null') as Stored | null
    if (parsed && Array.isArray(parsed.drafts) && parsed.drafts.length > 0) return parsed
    const legacy = JSON.parse(window.localStorage.getItem(legacyKey(planId)) ?? 'null')
    if (legacy && typeof legacy.label === 'string') {
      window.localStorage.removeItem(legacyKey(planId))
      const draft: Draft = {
        ...blankDraft(legacy.basis === 'library' ? 'library' : 'written'),
        label: legacy.label, body: legacy.body ?? '', format: legacy.format ?? '',
        germanNo: legacy.germanNo ?? '', count: legacy.count ?? 1,
        template: legacy.picked ?? '', saveAs: legacy.saveAs ?? true,
      }
      return { drafts: [draft], active: draft.id, at: Number(legacy.at) || Date.now() }
    }
  } catch {
    // Unreadable: start clean.
  }
  return null
}

function writeStore(planId: string, stored: Stored | null) {
  try {
    if (!stored) window.localStorage.removeItem(storeKey(planId))
    else window.localStorage.setItem(storeKey(planId), JSON.stringify(stored))
  } catch {
    // Storage full or blocked: the composer still works, it just will not survive a close.
  }
}

/** For the tile: how many unfinished cards this week has waiting. */
export function draftCount(planId: string): number {
  return (readStore(planId)?.drafts ?? []).filter(hasContent).length
}

const timeOf = (at: number) => new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })

export default function CardComposer({
  planId,
  selection,
  setSelection,
  weekJobIds,
  onPickingChange,
  onAdded,
  onClose,
}: {
  planId: string
  /** What is ticked on the wall on the left — mirrored into the draft being edited. */
  selection: Selection
  setSelection: Dispatch<SetStateAction<Selection>>
  /** Library videos already on this week: one card per video per week, so
   *  these are flagged before anyone presses Add. */
  weekJobIds: Set<string>
  /** The wall is only pickable while a library draft is being edited. */
  onPickingChange: (on: boolean) => void
  /** Fresh cards from the add — paint them now; a quiet reload can follow. */
  onAdded: (fresh?: AddedCard[]) => void
  onClose: () => void
}) {
  const [initial] = useState(() => readStore(planId))
  /** One card at a time: the one being written. An older save that held a
   *  stack keeps the card that was open. */
  const [drafts, setDrafts] = useState<Draft[]>(() => {
    const held = initial?.drafts.find((draft) => draft.id === initial.active) ?? initial?.drafts[0]
    return [held ? { ...held, basis: held.picks.length > 0 ? 'library' : 'written' } : blankDraft('written')]
  })
  const activeId = drafts[0].id
  const [savedAt, setSavedAt] = useState<number | null>(() => initial?.at ?? null)
  const [templates, setTemplates] = useState<Template[]>([])
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<{ text: string; bad?: boolean } | null>(null)

  const active = drafts.find((draft) => draft.id === activeId) ?? drafts[0]
  const activeRef = useRef(active)
  activeRef.current = active

  useEffect(() => {
    fetch('/api/templates')
      .then((response) => (response.ok ? response.json() : { templates: [] }))
      .then((data) => setTemplates(data.templates ?? []))
      .catch(() => setTemplates([]))
  }, [])

  // Open, the wall is pickable; the card's saved ticks come back on it.
  useEffect(() => {
    onPickingChange(true)
    return () => onPickingChange(false)
  }, [onPickingChange])

  const hydrated = useRef(false)
  useEffect(() => {
    setSelection(new Map(active.picks))
    // Once, on open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Ticks on the wall flow into the card. Videos ticked make it video cards;
  // none ticked, it is a written card.
  useEffect(() => {
    if (!hydrated.current) { hydrated.current = true; return }
    const current = activeRef.current
    const next = [...selection.entries()]
    const same = next.length === current.picks.length &&
      next.every(([key], at) => current.picks[at]?.[0] === key)
    if (same) return
    const basis: Basis = next.length > 0 ? 'library' : 'written'
    setDrafts((list) => list.map((draft) => draft.id === current.id ? { ...draft, picks: next, basis, error: undefined } : draft))
  }, [selection])

  // Saved as it is built — per week, on this device. The first pass is the
  // open itself: nothing changed, so the time saved stays the real one.
  const opened = useRef(false)
  useEffect(() => {
    if (!opened.current) { opened.current = true; return }
    if (!drafts.some(hasContent)) {
      writeStore(planId, null)
      setSavedAt(null)
      return
    }
    const at = Date.now()
    writeStore(planId, { drafts, active: activeId, at })
    setSavedAt(at)
  }, [planId, drafts, activeId])

  function update(patch: Partial<Draft>) {
    setDrafts((list) => list.map((draft) => draft.id === active.id ? { ...draft, ...patch, error: undefined } : draft))
  }

  function applyTemplate(id: string) {
    const template = templates.find((entry) => entry.id === id)
    if (!template) return update({ template: '' })
    update({ template: id, label: template.label, format: template.format ?? '', body: template.body ?? '' })
  }

  /** The template outlives the card. Editing an existing pick updates it in
   *  place; a fresh set of fields becomes a new one. */
  async function keepTemplate(draft: Draft) {
    if (!draft.saveAs || !draft.label.trim()) return
    await fetch('/api/templates', {
      method: draft.template ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: draft.template || undefined, label: draft.label, format: draft.format || undefined, body: draft.body }),
    }).catch(() => null)
  }

  const blockedPicks = (draft: Draft) =>
    draft.picks.filter(([, pick]) => pick.kind === 'library' && weekJobIds.has(pick.jobId))
  const readyCount = (draft: Draft) =>
    draft.basis === 'library' ? draft.picks.length - blockedPicks(draft).length : draft.label.trim() ? draft.count : 0
  const isReady = (draft: Draft) => readyCount(draft) > 0

  /** Every add is a written card. Library ticks only supply the cover frame
   *  (job_id) and a default label — solo / declined rules never block them.
   *  One round-trip for the whole pile; template save does not block. */
  async function addDraft(draft: Draft): Promise<{ ok: boolean; landed: number; text: string; items: AddedCard[] }> {
    const picks = draft.picks.map(([, pick]) => pick)
    if (picks.length === 0) {
      if (!draft.label.trim()) {
        return { ok: false, landed: 0, text: 'Give the card a label first — it is what the card is called.', items: [] }
      }
      const response = await fetch(`/api/plans/${planId}/items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          custom: { label: draft.label, format: draft.format || undefined, body: draft.body, count: draft.count },
        }),
      }).catch(() => null)
      const body = await response?.json().catch(() => ({}))
      if (!response?.ok) {
        return { ok: false, landed: 0, text: body?.error ?? 'The card did not land — try again.', items: [] }
      }
      void keepTemplate(draft)
      const items = Array.isArray(body?.items) ? body.items as AddedCard[] : []
      return { ok: true, landed: Number(body?.added ?? draft.count), text: '', items }
    }

    const fresh = picks.filter((pick) => pick.kind !== 'library' || !weekJobIds.has(pick.jobId))
    if (fresh.length === 0) {
      return {
        ok: false,
        landed: 0,
        text: 'Already on this week — use ⧉ Duplicate on that card for another copy.',
        items: [],
      }
    }

    const cards = fresh.map((pick) => {
      const name = pick.name ?? (pick.kind === 'library' ? 'Library video' : 'Feed video')
      return {
        label: draft.label.trim() || name,
        job_id: pick.kind === 'library' ? pick.jobId : undefined,
        body: pick.kind === 'feed' && pick.url
          ? (draft.body.trim() || pick.url)
          : (draft.body.trim() || undefined),
      }
    })
    const response = await fetch(`/api/plans/${planId}/items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        custom: {
          format: draft.format || undefined,
          body: draft.body.trim() || undefined,
          cards,
        },
      }),
    }).catch(() => null)
    const body = await response?.json().catch(() => ({}))
    if (!response?.ok) {
      return { ok: false, landed: 0, text: body?.error ?? 'The cards did not land — try again.', items: [] }
    }
    void keepTemplate(draft)
    const items = Array.isArray(body?.items) ? body.items as AddedCard[] : []
    const skipped = Array.isArray(body?.skipped) ? body.skipped.length : 0
    return {
      ok: true,
      landed: Number(body?.added ?? items.length),
      text: skipped > 0 ? `${skipped} already on the week` : '',
      items,
    }
  }

  async function run(targets: Draft[]) {
    if (busy || targets.length === 0) return
    setBusy(true)
    setStatus(null)
    const done: string[] = []
    const failed = new Map<string, string>()
    const landedItems: AddedCard[] = []
    let landed = 0
    for (const draft of targets) {
      const result = await addDraft(draft)
      if (result.ok) {
        done.push(draft.id)
        landed += result.landed
        landedItems.push(...result.items)
      } else {
        failed.set(draft.id, result.text)
      }
    }
    const rest = drafts
      .filter((draft) => !done.includes(draft.id))
      .map((draft) => (failed.has(draft.id) ? { ...draft, error: failed.get(draft.id) } : draft))
    const next = rest.length > 0 ? rest : [blankDraft('written')]
    setDrafts(next)
    setSelection(new Map(next[0].picks))
    if (landed > 0) {
      onAdded(landedItems)
      // Clear the composer so the week feels instant.
      if (failed.size === 0) onClose()
    }
    setStatus(failed.size === 0 ? null : {
      text: failed.size === 1 ? [...failed.values()][0] : `${failed.size} could not go on.`,
      bad: true,
    })
    setBusy(false)
  }

  const blocked = blockedPicks(active)
  const activeReady = readyCount(active)
  const addOneText = busy
    ? 'Adding…'
    : active.basis === 'library'
      ? active.picks.length === 0
        ? 'Pick a video first'
        : activeReady === 0 ? 'Already on the week' : `Add ${activeReady} card${activeReady === 1 ? '' : 's'}`
      : active.label.trim() ? (active.count > 1 ? `Add ${active.count} cards` : 'Add the card') : 'Pick a video or write a label'

  return (
    <div className="customcard composer" role="group" aria-label="Add a card">
      <div className="customcard-head">
        <div>
          <p className="customcard-title">New card</p>
          <p className="customcard-sub">Tick videos on the left — or just write a label for a card with no video.</p>
        </div>
        <span className="composer-saved" data-on={savedAt ? 'true' : undefined} role="status" aria-live="polite">
          {savedAt ? `Draft saved ${timeOf(savedAt)}` : 'Saves as you type'}
        </span>
        <button type="button" className="customcard-x" aria-label="Close — drafts stay saved" title="Close — drafts stay saved" onClick={onClose}>×</button>
      </div>

      {status?.bad && (
        <p className="composer-status" data-tone="bad" role="status">{status.text}</p>
      )}

      {active.basis === 'library' && active.picks.length > 0 && (
      <div className="composer-step">
            <div className="composer-picks">
              <ul>
                {active.picks.slice(0, SHOWN_PICKS).map(([key, entry]) => {
                  const onWeek = entry.kind === 'library' && weekJobIds.has(entry.jobId)
                  return (
                    <li key={key} title={entry.name} data-blocked={onWeek || undefined}>
                      {entry.thumb
                        /* eslint-disable-next-line @next/next/no-img-element */
                        ? <img src={entry.thumb} alt="" width={36} height={45} loading="lazy" />
                        : <span className="composer-pick-blank" aria-hidden="true" />}
                      <span>{entry.name ?? (entry.kind === 'library' ? 'Library video' : 'Feed video')}</span>
                      {onWeek && <em>on the week</em>}
                      <button
                        type="button"
                        className="composer-pick-x"
                        aria-label="Untick"
                        onClick={() => setSelection((current) => {
                          const next = new Map(current)
                          next.delete(key)
                          return next
                        })}
                      >×</button>
                    </li>
                  )
                })}
                {active.picks.length > SHOWN_PICKS && <li className="composer-picks-more">+{active.picks.length - SHOWN_PICKS}</li>}
              </ul>
              <button type="button" className="btn btn-small btn-quiet" onClick={() => setSelection(new Map())}>Clear</button>
            </div>
        {blocked.length > 0 && (
          <p className="composer-warn">
            {blocked.length === 1 ? 'That video is' : `${blocked.length} of these are`} already on this week — a video can
            only be on a week once, so {blocked.length === 1 ? 'it' : 'they'} will be skipped. For another card from the
            same video, use <b>⧉ Duplicate</b> on its card.
          </p>
        )}
      </div>
      )}

      <div className="composer-step">
        <p className="customcard-step">Template &amp; format <em>optional</em></p>
        <div className="customcard-row">
          <DropSelect
            label="Start from a template"
            value={active.template}
            onChange={applyTemplate}
            options={[
              { value: '', label: 'No template' },
              ...templates.map((template) => ({ value: template.id, label: template.label })),
            ]}
          />
          <DropSelect
            label="Format"
            value={active.format}
            // Leaving the German tag clears the numbered pick with it — the
            // label and body it wrote stay, but a later return starts fresh.
            onChange={(next) => update({ format: next, germanNo: '' })}
            options={[
              { value: '', label: 'Any format' },
              ...FORMATS.map((tag) => ({ value: tag.id, label: tag.label })),
            ]}
          />
        </div>

        {/* The German playbook (2026-10-08): one format tag, 57 numbered
            variations. Picking one writes the doc's own row — direction,
            versions, caption — into the card, and the label if it is empty. */}
        {active.format === GERMAN_FORMAT_TAG && (
          <DropSelect
            label="What kind of German format?"
            placeholder="What kind of German format?"
            value={active.germanNo}
            onChange={(no) => {
              const german = findGerman(no)
              if (!german) return update({ germanNo: no })
              update({
                germanNo: no,
                label: active.label.trim() ? active.label : `German #${german.no} · ${german.name}`,
                body: active.body.trim() ? `${active.body.trim()}\n\n${germanBrief(german)}` : germanBrief(german),
              })
            }}
            options={GERMAN_TYPES.flatMap((type) =>
              type.formats.map((entry) => ({
                value: entry.no,
                label: `#${entry.no} · ${entry.name} — ${type.label}`,
              })),
            )}
          />
        )}
      </div>

      <div className="composer-step">
        <p className="customcard-step">
          What it is {active.basis === 'library' && <em>optional — keeps the drafted title if empty</em>}
        </p>
        <input
          type="text"
          aria-label="Label"
          value={active.label}
          onChange={(event) => update({ label: event.target.value })}
          placeholder="Label — what this card is (e.g. Weekly car Q&A)"
          maxLength={120}
        />
      </div>

      <div className="composer-step">
        <p className="customcard-step">
          Directions {active.basis === 'library' && <em>optional — replaces the drafted direction</em>}
        </p>
        <textarea
          aria-label="Directions"
          value={active.body}
          onChange={(event) => update({ body: event.target.value })}
          placeholder="Directions — what to film, what to say, anything she needs"
          rows={3}
        />
        {/* The mixed-source rule (2026-10-08): directions make it a card of
            ours; none make it a blank, parked off their page until written. */}
        {active.basis === 'written' && !active.body.trim() && (
          <p className="customcard-note">
            No directions yet, so this lands as a <b>blank</b> — on the week for the
            team, hidden from them until someone writes it (the Source select on the card).
          </p>
        )}
      </div>

      {active.error && <p className="composer-error" role="alert">{active.error}</p>}

      <div className="composer-foot">
        <div className="composer-foot-opts">
          <label className="customcard-save">
            <input type="checkbox" checked={active.saveAs} onChange={(event) => update({ saveAs: event.target.checked })} />
            {active.template ? 'Update template' : 'Save as template'}
          </label>
          {active.basis === 'written' && (
            <div className="volstep composer-count" role="group" aria-label="How many cards">
              <button
                type="button"
                className="volstep-btn"
                aria-label="One fewer"
                disabled={active.count <= 1}
                onClick={() => update({ count: Math.max(1, active.count - 1) })}
              >−</button>
              <input
                className="volstep-input field"
                type="number"
                min={1}
                max={30}
                value={active.count}
                aria-label="How many"
                onChange={(event) => update({ count: Math.max(1, Math.min(30, Number(event.target.value) || 1)) })}
              />
              <button
                type="button"
                className="volstep-btn"
                aria-label="One more"
                disabled={active.count >= 30}
                onClick={() => update({ count: Math.min(30, active.count + 1) })}
              >+</button>
            </div>
          )}
        </div>
        <button
          type="button"
          className="btn customcard-add composer-add"
          disabled={busy || !isReady(active)}
          onClick={() => void run([active])}
        >
          {addOneText}
        </button>
      </div>
    </div>
  )
}
