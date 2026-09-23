'use client'

import { useCallback, useEffect, useState } from 'react'
import CollisionFlag from './CollisionFlag'
import PlanPreview from './PlanPreview'
import { carryTarget, isPastWeek } from '@/lib/carry'
import { addDays, currentWeekOf, formatDate } from '@/lib/dates'
import { clock, thumbUrl } from '@/lib/format'
import { labelOf } from '@/lib/taxonomy'
import {
  UPLOAD_LABEL, uploadStateOf,
  type HerPost, type PlanHead, type PlanItemRow, type PlanSummary, type Suggestion,
} from './types'

const COPY_RESET_MS = 1600

/** Phase 3. The brief as discrete fields, in the order her card renders them.
 *  `notes` stays the prose direction above these and is not in this list. */
const BRIEF_FIELDS: { key: BriefKey; label: string; placeholder: string }[] = [
  { key: 'wardrobe', label: 'Wardrobe', placeholder: 'What she puts on' },
  { key: 'camera', label: 'Camera', placeholder: 'How the phone is held' },
  { key: 'takes', label: 'Takes', placeholder: 'How many goes' },
  { key: 'sound', label: 'Sound', placeholder: 'Where the audio comes from' },
  { key: 'hook', label: 'Hook', placeholder: 'The opening line, quoted on her card' },
  { key: 'caption', label: 'Caption', placeholder: 'What she posts under it' },
]

type BriefKey = 'wardrobe' | 'camera' | 'takes' | 'sound' | 'hook' | 'caption'

/** One week of one model's plan: what is on it, in what order, with what
 *  direction — and whether every video is actually reachable from her phone. */
export default function PlanEditor({
  modelId,
  modelName,
  onClose,
}: {
  modelId: string
  modelName: string
  onClose: () => void
}) {
  const [weeks, setWeeks] = useState<PlanSummary[]>([])
  const [planId, setPlanId] = useState<string | null>(null)
  const [plan, setPlan] = useState<PlanHead | null>(null)
  const [items, setItems] = useState<PlanItemRow[]>([])
  const [suggested, setSuggested] = useState<Suggestion[]>([])
  const [posts, setPosts] = useState<HerPost[]>([])
  const [pasting, setPasting] = useState('')
  /** Which of her posts is mid-action, and what the last one said. */
  const [postBusy, setPostBusy] = useState<string | null>(null)
  const [postNote, setPostNote] = useState<string | null>(null)
  const [ingesting, setIngesting] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  /** Her page, beside the form. On by default: the reason it exists is that
   *  nobody remembers to go and look, and a preview behind a click is a
   *  preview nobody opens. */
  const [showPreview, setShowPreview] = useState(true)
  /** Progress of the caption-and-DM writer, or null when idle. */
  const [writing, setWriting] = useState<string | null>(null)

  async function writeCopy(id: string) {
    setWriting('Writing…')
    for (let round = 0; round < 10; round += 1) {
      const response = await fetch(`/api/plans/${id}/write`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
      })
      if (!response.ok) { setWriting('Writer unavailable'); setTimeout(() => setWriting(null), 2400); return }
      const body = await response.json()
      setRevision((r) => r + 1)
      if (!body.remaining || body.written === 0) break
      setWriting(`Writing… ${body.remaining} left`)
    }
    setWriting(null)
  }
  /** Bumped whenever the stored plan changes, which tells the preview to
   *  refetch. Keyed off `plan` and `items` rather than instrumented into each
   *  of the nine mutations below, because both are replaced by reference
   *  exactly when a save succeeds — so this cannot fall behind by forgetting
   *  to bump it in a tenth. */
  const [revision, setRevision] = useState(0)
  /** Tied to the week it is about, so it does not follow you to another one. */
  const [carryNote, setCarryNote] = useState<{ planId: string; text: string } | null>(null)

  const thisWeek = currentWeekOf()

  const loadWeeks = useCallback(async () => {
    const response = await fetch(`/api/models/${modelId}`)
    if (!response.ok) return
    const body = await response.json()
    const list: PlanSummary[] = body.plans ?? []
    setWeeks(list)
    setPlanId((current) => current ?? list.find((week) => week.week_of === thisWeek)?.id ?? list[0]?.id ?? null)
  }, [modelId, thisWeek])

  const loadPlan = useCallback(async () => {
    if (!planId) { setPlan(null); setItems([]); return }
    const response = await fetch(`/api/plans/${planId}`)
    if (!response.ok) return
    const body = await response.json()
    setPlan(body.plan ?? null)
    setItems(body.items ?? [])
  }, [planId])

  const loadSuggested = useCallback(async () => {
    const response = await fetch(`/api/models/${modelId}/suggestions`)
    if (response.ok) setSuggested((await response.json()).items ?? [])
  }, [modelId])

  const loadPosts = useCallback(async () => {
    const response = await fetch(`/api/models/${modelId}/posts`)
    if (response.ok) setPosts((await response.json()).posts ?? [])
  }, [modelId])

  useEffect(() => { void loadPosts() }, [loadPosts])
  useEffect(() => { void loadWeeks() }, [loadWeeks])
  useEffect(() => { void loadPlan() }, [loadPlan])
  useEffect(() => { void loadSuggested() }, [loadSuggested])
  useEffect(() => { setRevision((n) => n + 1) }, [plan, items])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  /** Create-or-get the plan for a week and switch to it. */
  async function openWeek(weekOf: string) {
    setBusy(true)
    const response = await fetch('/api/plans', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model_id: modelId, week_of: weekOf }),
    })
    const body = await response.json().catch(() => ({}))
    setBusy(false)
    if (body.plan?.id) {
      setPlanId(String(body.plan.id))
      void loadWeeks()
    }
  }

  async function patchPlan(patch: Record<string, unknown>) {
    if (!planId) return
    const response = await fetch(`/api/plans/${planId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    })
    if (response.ok) {
      const body = await response.json()
      setPlan((current) => (current ? { ...current, ...body.plan } : current))
      void loadWeeks()
    }
  }

  async function patchItem(id: string, patch: Record<string, unknown>) {
    if (!planId) return
    const response = await fetch(`/api/plans/${planId}/items`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, ...patch }),
    })
    if (response.ok) {
      const body = await response.json()
      setItems((current) => current.map((item) => (item.id === id ? { ...item, ...body.item } : item)))
    }
  }

  /** Answer her on one card. Posting also marks everything she has said on
   *  that card read — answering something is reading it. */
  async function sendReply(itemId: string, reply: string) {
    if (!planId) return
    const response = await fetch(`/api/plans/${planId}/items`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: itemId, reply }),
    })
    if (!response.ok) return
    await loadPlan()
    void loadWeeks()
  }

  /** Fill whichever brief fields this item does not have yet, from the same
   *  rules that draft them on assignment. Never overwrites one that is set, so
   *  it is safe on an item that has already been edited by hand. */
  async function draftFields(id: string) {
    if (!planId) return
    const response = await fetch(`/api/plans/${planId}/items`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, draft: true }),
    })
    if (!response.ok) return
    const body = await response.json()
    setItems((current) => current.map((item) => (item.id === id ? { ...item, ...body.item } : item)))
  }

  /** Bind one of her posts to a card. This is the only thing that ever marks a
   *  card posted — decided explicitly, because her version of a reference
   *  shares no key with it and a guess would silently claim a delivery that
   *  never happened. */
  async function linkPost(itemId: string, post: HerPost) {
    if (!post.webpage_url) return
    await patchItem(itemId, { post_url: post.webpage_url, posted_on: post.upload_date })
    await loadPosts()
  }

  async function unlinkPost(itemId: string) {
    await patchItem(itemId, { post_url: '' })
    await loadPosts()
  }

  /**
   * The two things one of her winners can become.
   *
   * `recreate` puts it on her week as a control reskin — shoot it again as it
   * was. `repurpose` marks it ours to repost and hands back the file for the
   * batcher. Independent on purpose: a reel can be worth both.
   */
  async function actOnPost(postId: string, action: 'recreate' | 'repurpose' | 'unrepurpose') {
    setPostBusy(postId)
    const response = await fetch(`/api/models/${modelId}/posts/${postId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    })
    const body = await response.json().catch(() => ({}))
    setPostBusy(null)
    if (!response.ok) {
      setPostNote(body.error ?? 'That did not go through.')
      return
    }
    if (action === 'recreate') {
      setPostNote(body.added ? 'Added to her week as a reskin — shoot it again as it was.'
                             : 'Already on her week.')
      await loadPlan()
      return
    }
    if (action === 'repurpose') {
      // Straight to the file: the batcher is the next step and it needs the
      // video, so the tap that marks it is the tap that downloads it.
      if (body.download) window.location.href = body.download
      setPostNote(body.note ?? 'Marked to repost. Downloading the file for the batcher.')
    } else {
      setPostNote('No longer marked to repost.')
    }
    await loadPosts()
  }

  /** Her recent posts, metadata only. `transcribe: false` is the whole point:
   *  these are ingested for a date and a link, and a speech pass over forty of
   *  her own reels costs Mac time to produce nothing anyone reads. */
  async function ingestPosts() {
    const text = pasting.trim()
    if (!text) return
    setIngesting('Adding…')
    const response = await fetch('/api/links', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, transcribe: false }),
    })
    const body = await response.json().catch(() => ({}))
    if (!response.ok) {
      setIngesting(body.error ?? 'That did not go in.')
      return
    }
    setPasting('')
    setIngesting(
      `${body.added} queued${body.skipped ? `, ${body.skipped} already held` : ''}. ` +
      'They appear here once the Mac has fetched them.',
    )
    await loadPosts()
  }

  async function move(index: number, direction: -1 | 1) {
    const next = [...items]
    const target = index + direction
    if (target < 0 || target >= next.length) return
    ;[next[index], next[target]] = [next[target], next[index]]
    setItems(next)
    await fetch(`/api/plans/${planId}/items`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order: next.map((item) => item.id) }),
    })
  }

  /** Put a suggested item on the open week and drop it out of the list. */
  async function addSuggested(jobId: string) {
    if (!planId) return
    await fetch(`/api/plans/${planId}/items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ job_id: jobId }),
    })
    await loadPlan()
    await loadSuggested()
    void loadWeeks()
  }

  async function removeItem(id: string) {
    setItems((current) => current.filter((item) => item.id !== id))
    await fetch(`/api/plans/${planId}/items?item=${encodeURIComponent(id)}`, { method: 'DELETE' })
    void loadWeeks()
  }

  async function deletePlan() {
    if (!planId || !confirm('Delete this whole week?')) return
    await fetch(`/api/plans/${planId}`, { method: 'DELETE' })
    setPlanId(null)
    setPlan(null)
    setItems([])
    void loadWeeks()
  }

  /** Move this past week's videos onto the week her link shows, then follow
   *  them there. The emptied week is deleted by the server, not here. */
  async function carryForward(toWeek: string) {
    if (!planId) return
    const count = items.length
    const ok = confirm(
      `Move ${count} video${count === 1 ? '' : 's'} to the week of ${formatDate(toWeek)}?\n\n` +
      'Her replies, accepts and filmed marks move with them, and this empty week is deleted.',
    )
    if (!ok) return
    setBusy(true)
    setCarryNote(null)
    const response = await fetch(`/api/plans/${planId}/carry`, { method: 'POST' })
    const body = await response.json().catch(() => ({}))
    setBusy(false)
    if (!response.ok || !body.plan?.id) {
      setCarryNote({ planId, text: body.error ?? 'That did not move. Nothing was changed.' })
      void loadWeeks()
      return
    }
    if (body.left > 0) {
      setCarryNote({
        planId: String(body.plan.id),
        text: `${body.left} stayed behind on the week of ${formatDate(plan?.week_of ?? '')} — already on this one.`,
      })
    }
    setPlanId(String(body.plan.id))
    void loadWeeks()
  }

  const waiting = items.filter((item) => uploadStateOf(item) === 'waiting').length
  const missing = items.filter((item) => uploadStateOf(item) === 'no-video').length
  const filmed = items.filter((item) => item.filmed_at).length
  const shareUrl =
    plan && !plan.token_revoked_at && typeof window !== 'undefined'
      ? `${window.location.origin}/p/${plan.access_token}`
      : null

  // Posts not yet claimed by a card. Offering a bound one again would move the
  // delivery from one card to another without saying so.
  const unbound = posts.filter((post) => !post.item_id && post.webpage_url)

  const knownWeeks = new Set(weeks.map((week) => week.week_of))
  // Only offered on a week that has gone by and still has something on it —
  // the one case where videos sit where her link does not show them.
  // In her timezone, which is how the server decides — otherwise the button can
  // appear a day early near midnight on a Sunday and be refused when clicked.
  const herWeek = plan ? currentWeekOf(plan.timezone) : thisWeek
  const carryTo = plan && planId && items.length > 0 && isPastWeek(plan.week_of, herWeek)
    ? carryTarget(weeks, planId, herWeek)
    : null
  const nextWeek = addDays(thisWeek, 7)

  return (
    <>
      <button className="reader-scrim" onClick={onClose} aria-label="Close" />
      <aside
        className={`reader reader-wide${showPreview ? ' reader-preview' : ''}`}
        aria-label={`${modelName}'s plan`}
      >
        <header className="reader-head">
          <button className="reader-close" onClick={onClose} aria-label="Close">Close</button>
          <h3>{modelName}</h3>
          <p className="facts">
            {plan
              ? `Week of ${formatDate(plan.week_of)} · ${items.length} item${items.length === 1 ? '' : 's'} · ${filmed} filmed`
              : 'No week open'}
          </p>
        </header>

        <div className="reader-body">
          <div className="planpane" data-preview={showPreview && planId ? 'true' : undefined}>
            <div className="planpane-main">
          <div className="weekrail" role="group" aria-label="Weeks">
            {!knownWeeks.has(thisWeek) && (
              <button className="pill" disabled={busy} onClick={() => openWeek(thisWeek)}>
                + This week
              </button>
            )}
            {!knownWeeks.has(nextWeek) && (
              <button className="pill" disabled={busy} onClick={() => openWeek(nextWeek)}>
                + Next week
              </button>
            )}
            {weeks.map((week) => (
              <button
                key={week.id}
                className="pill"
                data-on={week.id === planId}
                onClick={() => setPlanId(week.id)}
              >
                {formatDate(week.week_of)}
                <b> {week.filmed}/{week.items}</b>
                {week.status === 'draft' && ' · draft'}
                {week.unread > 0 && <> · <b>{week.unread} new</b></>}
              </button>
            ))}
          </div>

          {!plan ? (
            <div className="empty"><p>Open a week, then tag videos to her from the library.</p></div>
          ) : (
            <>
              {carryTo && (
                <div className="planstate planstate-carry">
                  <span>
                    This week has passed. Move its {items.length} video{items.length === 1 ? '' : 's'} to
                    {' '}the week of {formatDate(carryTo.week_of)}
                    {carryTo.kind === 'new' ? ' (starts it)' : ''} so everything is on one link.
                  </span>
                  <button className="btn btn-small" disabled={busy} onClick={() => carryForward(carryTo.week_of)}>
                    Move to {formatDate(carryTo.week_of)}
                  </button>
                </div>
              )}
              {carryNote?.planId === planId && <p className="hint" role="status">{carryNote.text}</p>}

              <div className="form-pair">
                <div className="form-row">
                  <label className="axis-name" htmlFor="plan-title">Title</label>
                  <input
                    id="plan-title"
                    className="field"
                    defaultValue={plan.title ?? ''}
                    placeholder="Optional"
                    onBlur={(event) => patchPlan({ title: event.target.value })}
                  />
                </div>
                <div className="form-row">
                  <label className="axis-name" htmlFor="plan-due">Due</label>
                  <input
                    id="plan-due"
                    className="field"
                    type="date"
                    defaultValue={plan.due_date ?? ''}
                    onBlur={(event) => patchPlan({ due_date: event.target.value })}
                  />
                </div>
              </div>

              <div className="form-row">
                <label className="axis-name" htmlFor="plan-intro">Intro — the first thing she reads</label>
                <textarea
                  id="plan-intro"
                  className="field"
                  rows={2}
                  defaultValue={plan.intro ?? ''}
                  onBlur={(event) => patchPlan({ intro: event.target.value })}
                />
              </div>

              <div className="planstate" data-ready={waiting === 0 && missing === 0}>
                {waiting === 0 && missing === 0 ? (
                  <span>Every video is on R2. Safe to send.</span>
                ) : (
                  <span>
                    {waiting > 0 && `${waiting} still uploading — the Mac has to be awake. `}
                    {missing > 0 && `${missing} have no video on disk and will show the Instagram link only.`}
                  </span>
                )}
              </div>

              {/* `weekly_target` was stored on the model, editable in her sheet,
                  and read by nothing — not the editor, not the sweep, not the
                  scoreboard. Warned, never blocked: sending a short week on
                  purpose is a normal thing to do and the operator is allowed
                  to do it without arguing with a dialog. */}
              {plan.weekly_target > 0 && items.length < plan.weekly_target && (
                <div className="planstate planstate-short">
                  <span>
                    {items.length} on this week · her target is {plan.weekly_target}
                    {' — '}{plan.weekly_target - items.length} short.
                    {' '}Send it anyway if that is deliberate.
                  </span>
                </div>
              )}

              <div className="copybar" style={{ position: 'static' }}>
                <button
                  className="btn"
                  onClick={() => patchPlan({ status: plan.status === 'sent' ? 'draft' : 'sent' })}
                >
                  {plan.status === 'sent' ? 'Unsend' : 'Mark sent'}
                </button>
                <button
                  className="btn btn-quiet"
                  disabled={!shareUrl}
                  onClick={async () => {
                    if (!shareUrl) return
                    await navigator.clipboard.writeText(shareUrl)
                    setCopied(true)
                    setTimeout(() => setCopied(false), COPY_RESET_MS)
                  }}
                >
                  {copied ? 'Copied' : 'Copy her link'}
                </button>
                <button className="btn btn-quiet" onClick={deletePlan}>Delete week</button>
                {plan.status !== 'sent' && (
                  <span className="hint">A draft is invisible to her until it is marked sent.</span>
                )}
              </div>

              {items.length === 0 ? (
                <div className="empty">
                  <p>Nothing on this week. Open a video in the library and tag it to her.</p>
                </div>
              ) : (
                <ol className="planlist">
                  {items.map((item, index) => {
                    const state = uploadStateOf(item)
                    return (
                      <li key={item.id} className="planrow" data-state={state}>
                        <div className="planrow-top">
                          {/* Its own id, not its position. Reordering the week
                              used to rename every card under the one moved. */}
                          <span className="planrow-no">
                            {item.card_no ? `V-${item.card_no}` : index + 1}
                          </span>
                          {item.has_thumb && (
                            /* eslint-disable-next-line @next/next/no-img-element */
                            <img src={thumbUrl(item.job_id)} alt="" width={56} height={70} loading="lazy" />
                          )}
                          <div className="planrow-id">
                            <p className="planrow-who">
                              {item.item_title && <b className="planrow-title">{item.item_title} · </b>}
                              {item.author ?? item.title ?? item.job_id}
                            </p>
                            <p className="planrow-meta">
                              {[clock(item.duration_sec), UPLOAD_LABEL[state],
                                item.filmed_at ? 'filmed' : null].filter(Boolean).join(' · ')}
                            </p>
                            {item.preview && <p className="planrow-line">{item.preview}</p>}
                            {/* Warned, never blocked. It is only a mistake
                                when nobody knew. */}
                            <CollisionFlag on={item.also_on} />
                          </div>
                          <span className="planrow-tools">
                            <button className="chip" onClick={() => move(index, -1)} aria-label="Move up">↑</button>
                            <button className="chip" onClick={() => move(index, 1)} aria-label="Move down">↓</button>
                            <button className="chip" onClick={() => removeItem(item.id)} aria-label="Remove">×</button>
                          </span>
                        </div>

                        {item.declined_at && (
                          <div className="planrow-declined">
                            <p className="axis-name">She turned this one down</p>
                            {item.decline_reason && <p>{item.decline_reason}</p>}
                            <p className="hint">
                              Take it off and put something else on from Suggested
                              for her, below — the slot is empty until you do.
                            </p>
                          </div>
                        )}

                        {item.accepted_at && !item.declined_at && (
                          <p className="planrow-accepted">She has taken this one on.</p>
                        )}

                        {/* The conversation. Reading it is not enough — this is
                            where an answer goes, which until now had nowhere. */}
                        {(item.messages.length > 0 || item.unread > 0) && (
                          <div className="planrow-said" data-unread={item.unread > 0 || undefined}>
                            <p className="axis-name">
                              Thread{item.unread > 0 && ` · ${item.unread} new`}
                            </p>
                            {item.messages.map((message) => (
                              <p key={message.id} className="planrow-msg" data-from={message.author}>
                                <b>{message.author === 'model' ? 'She' : 'You'}</b>
                                {message.body}
                              </p>
                            ))}
                          </div>
                        )}

                        <label className="axis-name" htmlFor={`reply-${item.id}`}>
                          Reply to her — she sees this on the card
                        </label>
                        <textarea
                          id={`reply-${item.id}`}
                          className="field"
                          rows={2}
                          placeholder="Back camera, same setup as the last one…"
                          onBlur={(event) => {
                            const reply = event.target.value.trim()
                            if (!reply) return
                            event.target.value = ''
                            void sendReply(item.id, reply)
                          }}
                        />

                        <label className="axis-name" htmlFor={`notes-${item.id}`}>
                          Direction — drafted from the reference, edit before sending
                        </label>
                        <textarea
                          id={`notes-${item.id}`}
                          className="field"
                          rows={5}
                          defaultValue={item.notes ?? ''}
                          onBlur={(event) => patchItem(item.id, { notes: event.target.value })}
                        />

                        {/* Phase 4. Where it gets filmed and what the card is
                            called. Location is what groups her plan, so two
                            cards typed the same way group together — the
                            drafted values keep that spelling consistent. */}
                        <div className="form-pair">
                          <div className="form-row">
                            <label className="axis-name" htmlFor={`loc-${item.id}`}>
                              Location — groups her plan
                            </label>
                            <input
                              id={`loc-${item.id}`}
                              className="field"
                              list="plan-locations"
                              key={`loc-${item.location ?? ''}`}
                              defaultValue={item.location ?? ''}
                              placeholder="In the car"
                              onBlur={(event) => patchItem(item.id, { location: event.target.value })}
                            />
                          </div>
                          <div className="form-row">
                            <label className="axis-name" htmlFor={`title-${item.id}`}>
                              Title — what the card is called
                            </label>
                            <input
                              id={`title-${item.id}`}
                              className="field"
                              key={`title-${item.item_title ?? ''}`}
                              defaultValue={item.item_title ?? ''}
                              placeholder="Car GRWM"
                              onBlur={(event) => patchItem(item.id, { item_title: event.target.value })}
                            />
                          </div>
                        </div>

                        {/* Phase 3. The same brief as fields, which is what her
                            card renders as a label/value grid, a quoted hook and
                            a caption with a copy button. Empty ones simply do
                            not render on her side. */}
                        <div className="briefhead">
                          <span className="axis-name">The brief, as fields</span>
                          <button
                            className="chip"
                            onClick={() => draftFields(item.id)}
                            title="Fills only the ones that are empty"
                          >
                            Draft the empty ones
                          </button>
                        </div>
                        <div className="briefgrid">
                          {BRIEF_FIELDS.map((field) => (
                            <div key={field.key} className="form-row">
                              <label className="axis-name" htmlFor={`${field.key}-${item.id}`}>
                                {field.label}
                              </label>
                              <textarea
                                id={`${field.key}-${item.id}`}
                                className="field"
                                // Three, because at two the last words of a
                                // camera note sit below the fold of the box.
                                rows={3}
                                // Keyed on the value so a draft that arrives from
                                // the server lands in a box she is not typing in.
                                key={`${field.key}-${item[field.key] ?? ''}`}
                                defaultValue={item[field.key] ?? ''}
                                placeholder={field.placeholder}
                                onBlur={(event) => patchItem(item.id, { [field.key]: event.target.value })}
                              />
                            </div>
                          ))}
                        </div>

                        <label className="axis-name" htmlFor={`editing-${item.id}`}>Editing notes</label>
                        <textarea
                          id={`editing-${item.id}`}
                          className="field"
                          rows={2}
                          defaultValue={item.editing_notes ?? ''}
                          placeholder="Optional"
                          onBlur={(event) => patchItem(item.id, { editing_notes: event.target.value })}
                        />

                        {/* Phase 5. What she actually posted, bound by hand.
                            Nothing here is inferred — see the note on the
                            posts endpoint for why a guess is worse than a gap. */}
                        {item.post_url ? (
                          <p className="planrow-posted">
                            <span className="axis-name">Posted</span>
                            <a href={item.post_url} target="_blank" rel="noreferrer">
                              {item.posted_at ? formatDate(item.posted_at.slice(0, 10)) : 'her post'}
                            </a>
                            <button className="chip" onClick={() => unlinkPost(item.id)}>
                              Unlink
                            </button>
                          </p>
                        ) : unbound.length > 0 ? (
                          <details className="planrow-link">
                            <summary>Link one of her posts</summary>
                            <ul className="poststrip">
                              {unbound.map((post) => (
                                <li key={post.id}>
                                  <button
                                    className="postcard"
                                    onClick={() => linkPost(item.id, post)}
                                    title={post.webpage_url ?? ''}
                                  >
                                    {post.has_thumb ? (
                                      /* eslint-disable-next-line @next/next/no-img-element */
                                      <img src={thumbUrl(post.id)} alt="" width={54} height={68} loading="lazy" />
                                    ) : (
                                      <span className="postcard-blank" />
                                    )}
                                    <span className="postcard-when">
                                      {post.upload_date ? formatDate(post.upload_date) : '—'}
                                    </span>
                                  </button>
                                </li>
                              ))}
                            </ul>
                          </details>
                        ) : null}

                        {item.webpage_url && (
                          <a className="planrow-src" href={item.webpage_url} target="_blank" rel="noreferrer">
                            The reference on Instagram
                          </a>
                        )}
                      </li>
                    )
                  })}
                </ol>
              )}

              {/* Phase 5. Her own posts. The strip is here rather than on each
                  card so the week's delivery can be seen in one look; binding
                  happens per card, under "Link one of her posts". */}
              <div className="section-head">
                <h2 style={{ fontSize: 'var(--sc-text-lg)' }}>Her posts</h2>
                <span className="tally" style={{ color: 'var(--sc-ink-300)' }}>
                  {posts.length > 0
                    ? `${posts.length} held · ${posts.length - unbound.length} linked`
                    : ''}
                </span>
              </div>

              {posts.length > 0 && (
                <ul className="poststrip">
                  {posts.map((post) => (
                    <li key={post.id}>
                      <a
                        className="postcard"
                        data-bound={post.item_id ? true : undefined}
                        href={post.webpage_url ?? '#'}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {post.has_thumb ? (
                          /* eslint-disable-next-line @next/next/no-img-element */
                          <img src={thumbUrl(post.id)} alt="" width={54} height={68} loading="lazy" />
                        ) : (
                          <span className="postcard-blank" />
                        )}
                        <span className="postcard-when">
                          {post.card_no ? `V-${post.card_no}` : post.upload_date
                            ? formatDate(post.upload_date) : '—'}
                        </span>
                      </a>
                      {/* One reel, two decisions. She shoots it again, or we
                          repost it ourselves through the batcher — and the
                          same reel can be worth both, so neither hides the
                          other. */}
                      <span className="postcard-acts">
                        <button
                          className="btn btn-small btn-quiet"
                          disabled={postBusy === post.id}
                          title="Add it to her week as a reskin — shoot it again as it was"
                          onClick={() => void actOnPost(post.id, 'recreate')}
                        >
                          Recreate
                        </button>
                        <button
                          className="btn btn-small btn-quiet"
                          disabled={postBusy === post.id}
                          data-on={post.repurposed ? true : undefined}
                          title={post.repurposed
                            ? `Marked for ${post.destination ?? 'trial'} — click to unmark`
                            : 'Download the file and mark it ours to repost'}
                          onClick={() => void actOnPost(post.id, post.repurposed ? 'unrepurpose' : 'repurpose')}
                        >
                          {post.repurposed ? 'Reposting ✓' : 'Repurpose'}
                        </button>
                      </span>
                    </li>
                  ))}
                </ul>
              )}

              {postNote && <span className="hint">{postNote}</span>}

              <div className="form-row">
                <label className="axis-name" htmlFor="her-posts">
                  Paste her recent posts — metadata only, no transcript
                </label>
                <textarea
                  id="her-posts"
                  className="field"
                  rows={2}
                  value={pasting}
                  placeholder="https://instagram.com/reel/…"
                  onChange={(event) => { setPasting(event.target.value); setIngesting(null) }}
                />
                <div className="copybar" style={{ position: 'static' }}>
                  <button className="btn btn-small" disabled={!pasting.trim()} onClick={ingestPosts}>
                    Add her posts
                  </button>
                  {ingesting && <span className="hint">{ingesting}</span>}
                  {!ingesting && posts.length === 0 && (
                    <span className="hint">
                      Nothing of hers is held yet. Her handle has to match the
                      author on the post for it to land in this strip.
                    </span>
                  )}
                </div>
              </div>

              {/* Every location already on this week. Grouping is by exact
                  string, so offering what is in use is what stops "In the car"
                  and "in the car" becoming two separate trips. */}
              <datalist id="plan-locations">
                {[...new Set(items.map((item) => item.location).filter(Boolean))].map((where) => (
                  <option key={where as string} value={where as string} />
                ))}
              </datalist>

              <div className="section-head">
                <h2 style={{ fontSize: 'var(--sc-text-lg)' }}>Suggested for her</h2>
                <span className="tally" style={{ color: 'var(--sc-ink-300)' }}>
                  {suggested.length > 0 ? `${suggested.length} not on a plan yet` : ''}
                </span>
              </div>

              {suggested.length === 0 ? (
                <p className="hint">
                  Nothing scores yet. Tick the formats she does in her profile — an
                  untagged model matches nothing rather than everything.
                </p>
              ) : (
                <ul className="suggestlist">
                  {suggested.map((item) => (
                    <li key={item.id} className="suggestrow">
                      {item.has_thumb && (
                        /* eslint-disable-next-line @next/next/no-img-element */
                        <img src={thumbUrl(item.id)} alt="" width={44} height={55} loading="lazy" />
                      )}
                      <div className="suggestrow-id">
                        <p className="planrow-who">
                          {item.author ?? item.id}
                          {item.is_hot && <span className="flame"> 🔥</span>}
                        </p>
                        <p className="planrow-meta">
                          {[clock(item.duration_sec),
                            item.outperformance ? `${item.outperformance}×` : null,
                            `fit ${Math.round(item.fit)}`].filter(Boolean).join(' · ')}
                        </p>
                        <p className="suggestrow-why">
                          {item.matched.map((tag) => (
                            <span key={tag}>{labelOf('format', tag)}</span>
                          ))}
                        </p>
                        <CollisionFlag on={item.also_on} />
                      </div>
                      <button className="btn btn-small" onClick={() => addSuggested(item.id)}>
                        Add
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
            </div>

            {/* Not a mock-up of her page — her page. See PlanPreview. */}
            {planId && (
              <div className="planpane-side">
                <div className="planpane-head">
                  <span className="axis-name">What she sees</span>
                  {/* Writes the DM and three captions for every card that lacks
                      them, five a request until none are left. On demand only:
                      the model allowance is shared with Whisper. */}
                  <button
                    className="chip"
                    disabled={writing !== null}
                    onClick={() => void writeCopy(planId)}
                  >
                    {writing ?? 'Write captions & DMs'}
                  </button>
                  <button
                    className="chip"
                    aria-pressed={showPreview}
                    onClick={() => setShowPreview((on) => !on)}
                  >
                    {showPreview ? 'Hide' : 'Show'}
                  </button>
                </div>
                {showPreview && (
                  <>
                    <PlanPreview planId={planId} revision={revision} />
                    <p className="planpane-note">
                      Live, and safe to touch — nothing here writes to her week.
                      {plan?.status === 'draft' && ' This week is still a draft, so her link does not show it yet.'}
                    </p>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </aside>
    </>
  )
}
