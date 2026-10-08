'use client'

import { useCallback, useEffect, useState } from 'react'
import { upload } from '@vercel/blob/client'
import CollisionFlag from './CollisionFlag'
import PlanPreview from './PlanPreview'
import { carryTarget, isPastWeek, openingWeek } from '@/lib/carry'
import { addDays, currentWeekOf, formatDate } from '@/lib/dates'
import { KIND_TEXT, cardKind } from '@/lib/card'
import { clock, thumbUrl } from '@/lib/format'
import { CARD_SOURCES, SOURCE_TEXT, isSource, sourceOf } from '@/lib/source'
import { PLAN_TEMPLATES, TEMPLATE_TEXT, WINNING_MIN, isTemplate, type PlanTemplate } from '@/lib/template'
import { labelOf, taxonomy } from '@/lib/taxonomy'
import CustomCard from './CustomCard'
import { EditorAssign, EditorsPanel, useEditors } from './Editors'
import {
  UPLOAD_LABEL, uploadStateOf,
  type HerPost, type PlanHead, type PlanItemRow, type PlanSummary, type Suggestion,
} from './types'

const COPY_RESET_MS = 1600
const BOT_CHECK_MS = 15_000
/** How often to look again while a pasted video is still downloading. */
const FETCH_CHECK_MS = 12_000

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
  /** Removed cards, newest last — the Undo button walks this back. The whole
   *  row rides along, because the restore re-inserts it as it was. */
  const [undone, setUndone] = useState<{ label: string; row: Record<string, unknown> }[]>([])
  /** The format chips over the suggestions rail. Empty = everything. */
  const [formatFilter, setFormatFilter] = useState<string[]>([])
  /** The week's own intake: pasted links or dropped files, straight onto
   *  this plan. */
  const [intake, setIntake] = useState('')
  const [intakeBusy, setIntakeBusy] = useState(false)
  const [intakeNote, setIntakeNote] = useState<string | null>(null)
  /** Cards a paste just landed — highlighted and scrolled to, so nobody has
   *  to hunt the week for where the video went. */
  const [justLanded, setJustLanded] = useState<Set<string>>(new Set())
  /** Her winning verticals and the template the ladder suggests. */
  const [winning, setWinning] = useState<{
    winners_count: number
    verticals: { format: string; posts: number; best_multiple: number | null }[]
    suggested: PlanTemplate
    template: PlanTemplate | null
  } | null>(null)

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
  /** Which of the bot's three wordings goes out with "Send on Telegram". */
  const [variant, setVariant] = useState<'weekly' | 'weekend' | 'short'>('weekly')

  const thisWeek = currentWeekOf()

  const loadWeeks = useCallback(async () => {
    const response = await fetch(`/api/models/${modelId}`)
    if (!response.ok) return
    const body = await response.json()
    const list: PlanSummary[] = body.plans ?? []
    setWeeks(list)
    setPlanId((current) => current ?? openingWeek(list, thisWeek)?.id ?? null)
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
    const narrowed = formatFilter.length > 0 ? `?formats=${formatFilter.join(',')}` : ''
    const response = await fetch(`/api/models/${modelId}/suggestions${narrowed}`)
    if (response.ok) setSuggested((await response.json()).items ?? [])
  }, [modelId, formatFilter])

  const loadWinning = useCallback(async () => {
    const response = await fetch(`/api/models/${modelId}/verticals`)
    if (response.ok) setWinning(await response.json())
  }, [modelId])

  const loadPosts = useCallback(async () => {
    const response = await fetch(`/api/models/${modelId}/posts`)
    if (response.ok) setPosts((await response.json()).posts ?? [])
  }, [modelId])

  useEffect(() => { void loadPosts() }, [loadPosts])
  useEffect(() => { void loadWinning() }, [loadWinning])
  useEffect(() => { void loadWeeks() }, [loadWeeks])
  useEffect(() => { void loadPlan() }, [loadPlan])
  useEffect(() => { void loadSuggested() }, [loadSuggested])
  useEffect(() => { setRevision((n) => n + 1) }, [plan, items])

  // While the bot has the week, look again every so often: it polls once a
  // minute, and "waiting for the bot" should turn into posted without a reload.
  const waitingOnBot = plan?.telegram_state === 'queued' || plan?.telegram_state === 'manual'
  useEffect(() => {
    if (!waitingOnBot) return
    const timer = setInterval(() => { void loadPlan() }, BOT_CHECK_MS)
    return () => clearInterval(timer)
  }, [waitingOnBot, loadPlan])

  // While anything is still downloading, keep looking: the card should gain
  // its thumb and player on its own, not after a hand reload.
  const anyFetching = items.some((item) => uploadStateOf(item) === 'fetching')
  useEffect(() => {
    if (!anyFetching) return
    const timer = setInterval(() => { void loadPlan() }, FETCH_CHECK_MS)
    return () => clearInterval(timer)
  }, [anyFetching, loadPlan])

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
      // Sent, but the bot was not asked (no group linked, marketing off).
      if (body.warning) setCarryNote({ planId, text: body.warning })
      void loadWeeks()
    }
  }

  /** Send the week. `post`: the Gosian bot posts it in their MARKETING topic.
   *  `manual`: Geno sent it himself; the bot only records it. */
  async function send(telegram: 'post' | 'manual') {
    setCarryNote(null)
    await patchPlan({ status: 'sent', telegram, variant })
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
      // Recreate lands on the week that is open, not always this one.
      body: JSON.stringify({ action, plan_id: planId }),
    })
    const body = await response.json().catch(() => ({}))
    setPostBusy(null)
    if (!response.ok) {
      setPostNote(body.error ?? 'That did not go through.')
      return
    }
    if (action === 'recreate') {
      const week = formatDate(body.week_of)
      setPostNote(body.added ? `Added to the week of ${week} as a Recreate card — film it again.`
                             : `Already on the week of ${week}.`)
      await loadPlan()
      void loadWeeks()
      return
    }
    if (action === 'repurpose') {
      // Straight to the file: the batcher is the next step and it needs the
      // video, so the tap that marks it is the tap that downloads it.
      if (body.download) window.location.href = body.download
      const week = body.week_of ? formatDate(body.week_of) : null
      setPostNote([
        body.note ?? 'Marked to repost. Downloading the file for the batcher.',
        week ? (body.added ? `On the week of ${week} as a Repurpose card.` : `Already on the week of ${week}.`) : body.week_note,
      ].filter(Boolean).join(' '))
      await loadPlan()
      void loadWeeks()
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
  const { editors, reload: reloadEditors } = useEditors()

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

  /** Lay a copy of a card at the end of the week — press it again for the
   *  next variation. A library-backed card's copy becomes a written card;
   *  the original keeps the video. */
  async function duplicateItem(id: string) {
    if (!planId) return
    const response = await fetch(`/api/plans/${planId}/items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ duplicate: id }),
    })
    if (!response.ok) return
    await loadPlan()
    void loadWeeks()
  }

  async function removeItem(id: string) {
    const gone = items.find((item) => item.id === id)
    setItems((current) => current.filter((item) => item.id !== id))
    const response = await fetch(`/api/plans/${planId}/items?item=${encodeURIComponent(id)}`, { method: 'DELETE' })
    const body = await response.json().catch(() => ({}))
    // The whole row comes back so Undo can put it back exactly as it was —
    // the one thing a misclicked × used to cost was everything on the card.
    if (response.ok && body.removed) {
      const label = gone?.card_no ? `V-${gone.card_no}` : gone?.item_title ?? gone?.title ?? 'Card'
      setUndone((current) => [...current.slice(-19), { label, row: body.removed }])
    }
    void loadWeeks()
  }

  /** Put the last removed card back. The thread did not survive the delete;
   *  everything else on the card did. */
  async function undoRemove() {
    const last = undone[undone.length - 1]
    if (!last || !planId) return
    setUndone((current) => current.slice(0, -1))
    const response = await fetch(`/api/plans/${planId}/items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ restore: last.row }),
    })
    if (!response.ok) {
      const body = await response.json().catch(() => ({}))
      setCarryNote({ planId, text: body.error === 'already back on the week'
        ? `${last.label} is already back on the week.`
        : `${last.label} could not be restored.` })
      return
    }
    await loadPlan()
    void loadWeeks()
  }

  /** Paste links straight onto this week: they join the queue AND land here
   *  as cards in one move, thin until the Mac fetches the videos. */
  async function addLinks() {
    if (!planId || !intake.trim()) return
    setIntakeBusy(true)
    setIntakeNote(null)
    const response = await fetch('/api/links', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: intake, plan_id: planId }),
    })
    const body = await response.json().catch(() => ({}))
    setIntakeBusy(false)
    if (!response.ok) {
      setIntakeNote(body.error ?? 'That did not go in.')
      return
    }
    setIntake('')
    const attached = Number(body.attached ?? 0)
    const cards: { id: string; card_no: number | null }[] = Array.isArray(body.cards) ? body.cards : []
    const names = cards.map((card) => (card.card_no ? `V-${card.card_no}` : 'new card')).join(' · ')
    setIntakeNote(
      attached > 0
        ? `On the week as ${names || `${attached} card${attached === 1 ? '' : 's'}`} — downloading now, the video appears on the card by itself.`
        : 'Nothing landed — already on this week, declined by them, or not theirs to film.',
    )
    await loadPlan()
    void loadWeeks()
    if (cards.length > 0) {
      const ids = new Set(cards.map((card) => card.id))
      setJustLanded(ids)
      // The list just re-rendered; point the screen at where they went.
      setTimeout(() => {
        document.getElementById(`planrow-${cards[0].id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }, 150)
      setTimeout(() => setJustLanded(new Set()), 8000)
    }
  }

  /** Drop the files: browser → Blob, and the completion callback lays each
   *  one on this week. The attach is Blob's callback, so give it a beat. */
  async function takeFiles(files: FileList | null) {
    if (!files || files.length === 0 || !planId) return
    setIntakeBusy(true)
    let done = 0
    for (const file of Array.from(files)) {
      setIntakeNote(`Uploading ${file.name}…`)
      try {
        await upload(file.name, file, {
          access: 'public',
          handleUploadUrl: '/api/uploads',
          clientPayload: JSON.stringify({ plan_id: planId }),
        })
        done += 1
      } catch (error) {
        setIntakeNote(error instanceof Error ? error.message : 'Upload failed.')
      }
    }
    setIntakeBusy(false)
    if (done > 0) {
      setIntakeNote(`${done} uploaded — attaching to the week…`)
      setTimeout(() => {
        void loadPlan()
        void loadWeeks()
        setIntakeNote(`${done} uploaded.`)
      }, 2500)
    }
  }

  /** Set which template drives their autodraft. Lives on the model, so next
   *  Sunday's draft inherits it without anyone re-picking. */
  async function setTemplate(template: PlanTemplate | null) {
    const response = await fetch(`/api/models/${modelId}/template`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ template }),
    })
    if (response.ok) setWinning((current) => (current ? { ...current, template } : current))
  }

  /** One card to another week. It leaves this list; the week it went to
   *  gains it, and a new week shows up in the rail. */
  async function moveToWeek(itemId: string, weekOf: string) {
    if (!planId || !weekOf) return
    const from = planId
    const response = await fetch(`/api/plans/${from}/items/move`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ item: itemId, week_of: weekOf }),
    })
    const body = await response.json().catch(() => ({}))
    if (!response.ok) {
      setCarryNote({ planId: from, text: body.error ?? 'That did not move. Nothing was changed.' })
      return
    }
    setItems((current) => current.filter((item) => item.id !== itemId))
    setCarryNote({ planId: from, text: `Moved to the week of ${formatDate(body.plan?.week_of ?? weekOf)}.` })
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
      'Their replies, accepts and filmed marks move with them, and this empty week is deleted.',
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

  // The same caption under several cards is what made three creators ask
  // whether the plan was broken (2026-09-27). Warned before sending.
  const repeated = (() => {
    const counts = new Map<string, number>()
    for (const item of items) {
      const caption = (item.caption ?? '').trim().toLowerCase()
      if (caption) counts.set(caption, (counts.get(caption) ?? 0) + 1)
    }
    return [...counts].filter(([, n]) => n > 1).sort((a, b) => b[1] - a[1])
  })()
  // "Before it goes" (Geno, 2026-10-07): the things worth adding or
  // answering before the send button, counted where they can be seen.
  const unanswered = items.filter((item) => item.unread > 0).length
  const unassignedEdits = items.filter((item) => item.editing_notes && !item.editor_id).length
  const waiting = items.filter((item) => uploadStateOf(item) === 'waiting').length
  const missing = items.filter((item) => uploadStateOf(item) === 'no-video').length
  const fetching = items.filter((item) => uploadStateOf(item) === 'fetching').length
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
  // Where one card can go: any week from this one on but the open one, plus
  // the next three Mondays even before they have a plan.
  const moveTargets = [...new Set([
    ...weeks.map((week) => week.week_of),
    thisWeek, nextWeek, addDays(thisWeek, 14), addDays(thisWeek, 21),
  ])]
    .filter((week) => week !== plan?.week_of && !isPastWeek(week, thisWeek))
    .sort()

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
            <div className="empty"><p>Open a week, then tag videos to them from the library.</p></div>
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

              {/* The intro box is gone (Geno, 2026-10-06): her page now opens
                  with the counted contents of the plan instead of a written
                  paragraph. plans.intro stays in the database untouched. */}

              {/* How many reels THIS week wants, and the dots filling toward
                  it (Geno, 2026-10-08) — every added video lights one more.
                  Blank falls back to their weekly target. */}
              <div className="form-row">
                <label className="axis-name" htmlFor="plan-target">
                  Videos wanted this week
                </label>
                <div className="plandots-row">
                  <input
                    id="plan-target"
                    className="field field-inline"
                    type="number"
                    min={0}
                    max={200}
                    style={{ width: '7ch' }}
                    key={`target-${plan.target ?? ''}`}
                    defaultValue={plan.target ?? ''}
                    placeholder={String(plan.weekly_target || 21)}
                    onBlur={(event) => patchPlan({ target: event.target.value === '' ? 0 : Number(event.target.value) })}
                  />
                  {(() => {
                    const want = plan.target ?? plan.weekly_target ?? 0
                    const dots = Math.min(Math.max(want, items.length), 60)
                    return (
                      <>
                        <span className="plandots" aria-label={`${items.length} of ${want} videos on the plan`}>
                          {Array.from({ length: dots }).map((_, at) => (
                            <i key={at} data-filled={at < items.length || undefined} />
                          ))}
                        </span>
                        <span className="hint">{items.length} / {want}</span>
                      </>
                    )
                  })()}
                </div>
              </div>

              {/* Which template drives their autodraft (2026-10-08). On the
                  model, not the week — next Sunday inherits it. Auto follows
                  the ladder; the line under the select says where they are. */}
              {winning && (
                <div className="form-row">
                  <label className="axis-name" htmlFor="plan-template">Template</label>
                  <select
                    id="plan-template"
                    className="field"
                    value={winning.template ?? ''}
                    onChange={(event) => void setTemplate(isTemplate(event.target.value) ? event.target.value : null)}
                  >
                    <option value="">Auto — follows their winners ({TEMPLATE_TEXT[winning.suggested].label} now)</option>
                    {PLAN_TEMPLATES.map((template) => (
                      <option key={template} value={template} disabled={template === 'winning' && winning.winners_count < WINNING_MIN}>
                        {TEMPLATE_TEXT[template].label}
                        {template === 'winning' && winning.winners_count < WINNING_MIN
                          ? ` — needs ${WINNING_MIN} winners (they have ${winning.winners_count})` : ''}
                      </option>
                    ))}
                  </select>
                  <span className="hint">
                    {TEMPLATE_TEXT[winning.template ?? winning.suggested].line}
                    {winning.verticals.length > 0 && (
                      <> {' '}Their winning verticals:{' '}
                      {winning.verticals.map((vertical) =>
                        `${labelOf('format', vertical.format)} (${vertical.posts})`).join(' · ')}.</>
                    )}
                  </span>
                </div>
              )}

              {/* The nudge, only when the ladder and the setting disagree. */}
              {winning && winning.winners_count >= WINNING_MIN && winning.template !== 'winning' && winning.template !== 'custom' && (
                <div className="planstate planstate-short">
                  <span>
                    They have {winning.winners_count} winning reels — the Winning Verticals
                    template would build their week around what already works for them.
                  </span>
                  <button className="btn btn-small" onClick={() => void setTemplate('winning')}>
                    Switch
                  </button>
                </div>
              )}

              <div className="planstate" data-ready={waiting === 0 && missing === 0 && fetching === 0}>
                {waiting === 0 && missing === 0 && fetching === 0 ? (
                  <span>Every video is on R2. Safe to send.</span>
                ) : (
                  <span>
                    {fetching > 0 && `${fetching} still downloading — the video lands on its card by itself, nothing to do. `}
                    {waiting > 0 && `${waiting} still uploading — the Mac has to be awake. `}
                    {missing > 0 && `${missing} have no video on disk and will show the Instagram link only.`}
                  </span>
                )}
              </div>

              {/* The queue, on the week (Geno, 2026-10-08): paste Instagram,
                  TikTok or YouTube links, or drop the files, and they land on
                  THIS plan as cards — thin until the Mac fetches the videos. */}
              <div
                className="form-row"
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault()
                  void takeFiles(event.dataTransfer.files)
                }}
              >
                <label className="axis-name" htmlFor="plan-intake">
                  Add videos to this week — paste links (Instagram · TikTok · YouTube) or drop files here
                </label>
                <textarea
                  id="plan-intake"
                  className="field"
                  rows={2}
                  value={intake}
                  placeholder="https://instagram.com/reel/…  https://tiktok.com/@…/video/…"
                  onChange={(event) => { setIntake(event.target.value); setIntakeNote(null) }}
                />
                <div className="copybar" style={{ position: 'static' }}>
                  <button className="btn btn-small" disabled={intakeBusy || !intake.trim()} onClick={() => void addLinks()}>
                    Add to the week
                  </button>
                  <label className="btn btn-small btn-quiet" style={{ display: 'inline-block', cursor: 'pointer' }}>
                    Upload files…
                    <input
                      type="file"
                      hidden
                      multiple
                      accept="video/*,audio/*"
                      disabled={intakeBusy}
                      onChange={(event) => { void takeFiles(event.target.files); event.target.value = '' }}
                    />
                  </label>
                  {intakeNote && <span className="hint" role="status">{intakeNote}</span>}
                </div>
              </div>

              {/* A card of the team's own — label, format, directions, no
                  library video behind it. Templates keep the good ones. */}
              {planId && <CustomCard planId={planId} onAdded={() => void loadPlan()} />}
              <EditorsPanel editors={editors} reload={() => void reloadEditors()} />

              {(unanswered > 0 || unassignedEdits > 0) && (
                <div className="planstate planstate-short">
                  <span>
                    Before it goes:
                    {unanswered > 0 && ` ${unanswered} question${unanswered === 1 ? '' : 's'} from them unanswered (Messages tab).`}
                    {unassignedEdits > 0 && ` ${unassignedEdits} editing note${unassignedEdits === 1 ? '' : 's'} with no editor assigned.`}
                  </span>
                </div>
              )}

              {repeated.length > 0 && (
                <div className="planstate planstate-short">
                  <span>
                    {repeated.map(([caption, n]) => `“${caption}” is on ${n} cards`).join(' · ')}
                    {' — '}each card should have its own caption before this goes out.
                  </span>
                </div>
              )}

              {/* `weekly_target` was stored on the model, editable in her sheet,
                  and read by nothing — not the editor, not the sweep, not the
                  scoreboard. Warned, never blocked: sending a short week on
                  purpose is a normal thing to do and the operator is allowed
                  to do it without arguing with a dialog. */}
              {(plan.target ?? plan.weekly_target) > 0 && items.length < (plan.target ?? plan.weekly_target) && (
                <div className="planstate planstate-short">
                  <span>
                    {items.length} on this week · the target is {plan.target ?? plan.weekly_target}
                    {' — '}{(plan.target ?? plan.weekly_target) - items.length} short.
                    {' '}Send it anyway if that is deliberate.
                  </span>
                </div>
              )}

              <div className="copybar" style={{ position: 'static' }}>
                {plan.status === 'sent' ? (
                  <button className="btn" onClick={() => patchPlan({ status: 'draft' })}>Unsend</button>
                ) : (
                  <>
                    <select
                      className="field field-inline"
                      value={variant}
                      aria-label="Telegram wording"
                      onChange={(event) => setVariant(event.target.value as typeof variant)}
                    >
                      <option value="weekly">Weekly wording</option>
                      <option value="weekend">Weekend wording</option>
                      <option value="short">Short wording</option>
                    </select>
                    <button
                      className="btn"
                      disabled={!plan.telegram_title || Boolean(plan.telegram_skips)}
                      title={!plan.telegram_title ? 'Link their Telegram group in the Week tab first' : undefined}
                      onClick={() => void send('post')}
                    >
                      Send on Telegram
                    </button>
                    <button className="btn btn-quiet" onClick={() => void send('manual')}>
                      Mark sent — I sent it myself
                    </button>
                  </>
                )}
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
                  {copied ? 'Copied' : 'Copy their link'}
                </button>
                <button className="btn btn-quiet" onClick={deletePlan}>Delete week</button>
                {plan.status !== 'sent' && (
                  <span className="hint">
                    A draft is invisible to them until it is sent.
                    {!plan.telegram_title && ' No Telegram group linked — link one in their Week tab to send it there.'}
                  </span>
                )}
              </div>
              <TelegramStatus plan={plan} onRetry={() => void send('post')} />

              {items.length === 0 ? (
                <div className="empty">
                  <p>Nothing on this week. Open a video in the library and tag it to them.</p>
                </div>
              ) : (
                <ol className="planlist">
                  {items.map((item, index) => {
                    const state = uploadStateOf(item)
                    return (
                      <li
                        key={item.id}
                        id={`planrow-${item.id}`}
                        className="planrow"
                        data-state={state}
                        data-new={justLanded.has(item.id) || undefined}
                      >
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
                              <span className="planrow-kind" data-kind={cardKind(item.bucket ?? null, item.source_post ?? null)}>
                                {KIND_TEXT[cardKind(item.bucket ?? null, item.source_post ?? null)].label}
                              </span>{' '}
                              {/* Her thumbs on the reference — what steers her next picks. */}
                              {item.rating === 1 && <span className="planrow-rate" title="They rated this a good reference">👍</span>}
                              {item.rating === -1 && <span className="planrow-rate" title="They rated this a poor reference">👎</span>}
                              {/* They already made their own version — refresh that, not this. */}
                              {item.made_at && (item.made_url
                                ? <a className="planrow-made" href={item.made_url} target="_blank" rel="noreferrer" title="They made this one already — repurpose their post">Their post ↗</a>
                                : <span className="planrow-made" title="They made this one already — find their post and repurpose it">Made already</span>)}
                              {item.bucket === 'repurpose' && (
                                item.repurposed_at
                                  ? <button className="planrow-repurpose" data-done="true" title="Undo — back to needs repurposing"
                                      onClick={() => void patchItem(item.id, { repurposed: false })}>Repurposed ✓</button>
                                  : <button className="planrow-repurpose" title="Tick once the refreshed file has gone back to them"
                                      onClick={() => void patchItem(item.id, { repurposed: true })}>Needs repurposing · mark done</button>
                              )}{' '}
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
                            <select
                              className="chip"
                              value=""
                              aria-label="Move to another week"
                              title="Move this card to another week"
                              onChange={(event) => void moveToWeek(item.id, event.target.value)}
                            >
                              <option value="">Week →</option>
                              {moveTargets.map((week) => (
                                <option key={week} value={week}>
                                  {formatDate(week)}{knownWeeks.has(week) ? '' : ' (new)'}
                                </option>
                              ))}
                            </select>
                            <button
                              className="chip"
                              onClick={() => void duplicateItem(item.id)}
                              aria-label="Duplicate"
                              title="Duplicate this card — press again for each variation"
                            >⧉</button>
                            <button className="chip" onClick={() => removeItem(item.id)} aria-label="Remove">×</button>
                          </span>
                        </div>

                        {/* Where the card came from (2026-10-08) and, for a
                            twist, the one line that changes it. AI drafts and
                            blanks stay off her page until someone resolves
                            them — the select is how they get resolved. */}
                        <div className="form-pair">
                          <div className="form-row">
                            <label className="axis-name" htmlFor={`source-${item.id}`}>
                              Source — what her card calls it
                            </label>
                            <select
                              id={`source-${item.id}`}
                              className="field"
                              value={sourceOf(item.source, item.bucket ?? null)}
                              onChange={(event) => {
                                if (isSource(event.target.value)) void patchItem(item.id, { source: event.target.value })
                              }}
                            >
                              {CARD_SOURCES.map((source) => (
                                <option key={source} value={source}>
                                  {SOURCE_TEXT[source].console}
                                  {SOURCE_TEXT[source].chip ? ` — “${SOURCE_TEXT[source].chip}”` : ' — hidden from them'}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div className="form-row">
                            <label className="axis-name" htmlFor={`twist-${item.id}`}>
                              The twist — what changes from the reference
                            </label>
                            <input
                              id={`twist-${item.id}`}
                              className="field"
                              key={`twist-${item.twist ?? ''}`}
                              defaultValue={item.twist ?? ''}
                              placeholder="Same video — but the third pass is the members'-dinner fit"
                              onBlur={(event) => patchItem(item.id, { twist: event.target.value })}
                            />
                          </div>
                        </div>

                        {item.declined_at && (
                          <div className="planrow-declined">
                            <p className="axis-name">They turned this one down</p>
                            {item.decline_reason && <p>{item.decline_reason}</p>}
                            <p className="hint">
                              Take it off and put something else on from Suggested
                              for them, below — the slot is empty until you do.
                            </p>
                          </div>
                        )}

                        {item.accepted_at && !item.declined_at && (
                          <p className="planrow-accepted">They have taken this one on.</p>
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
                                <b>{message.author === 'model' ? 'Them' : 'You'}</b>
                                {message.body}
                              </p>
                            ))}
                          </div>
                        )}

                        <label className="axis-name" htmlFor={`reply-${item.id}`}>
                          Reply to them — they see this on the card
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
                              Location — groups their plan
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

                        {/* The brief-as-fields grid (Wardrobe/Camera/Takes/
                            Sound/Hook/Caption) is gone (Geno, 2026-10-08:
                            "irrelevant"). The measured shot list carries the
                            filming directions, the caption engine writes the
                            captions, and the columns stay in the database —
                            cards drafted with them render on her page as
                            they always did. */}

                        <label className="axis-name" htmlFor={`editing-${item.id}`}>Editing notes</label>
                        <textarea
                          id={`editing-${item.id}`}
                          className="field"
                          rows={2}
                          defaultValue={item.editing_notes ?? ''}
                          placeholder="Optional"
                          onBlur={(event) => patchItem(item.id, { editing_notes: event.target.value })}
                        />

                        {/* In-house only: her page never shows these notes.
                            Point the card at whoever will cut it. */}
                        <EditorAssign itemId={item.id} editors={editors}
                          value={item.editor_id ?? null} onChanged={reloadEditors} />

                        {/* Phase 5. What she actually posted, bound by hand.
                            Nothing here is inferred — see the note on the
                            posts endpoint for why a guess is worse than a gap. */}
                        {item.post_url ? (
                          <p className="planrow-posted">
                            <span className="axis-name">Posted</span>
                            <a href={item.post_url} target="_blank" rel="noreferrer">
                              {item.posted_at ? formatDate(item.posted_at.slice(0, 10)) : 'their post'}
                            </a>
                            <button className="chip" onClick={() => unlinkPost(item.id)}>
                              Unlink
                            </button>
                          </p>
                        ) : unbound.length > 0 ? (
                          <details className="planrow-link">
                            <summary>Link one of their posts</summary>
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

              {/* A misclicked × costs nothing now: the last removed cards sit
                  here until the editor closes. The thread on a card does not
                  survive, everything else does. */}
              {undone.length > 0 && (
                <div className="planstate planstate-short" role="status">
                  <span>
                    {undone[undone.length - 1].label} removed
                    {undone.length > 1 ? ` · ${undone.length} in the undo pile` : ''}.
                  </span>
                  <button className="btn btn-small" onClick={() => void undoRemove()}>Undo</button>
                </div>
              )}

              {/* Phase 5. Her own posts. The strip is here rather than on each
                  card so the week's delivery can be seen in one look; binding
                  happens per card, under "Link one of her posts". */}
              <div className="section-head">
                <h2 style={{ fontSize: 'var(--sc-text-lg)' }}>Their posts</h2>
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
                          title="Add it to their week as a reskin — shoot it again as it was"
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
                  Paste their recent posts — metadata only, no transcript
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
                    Add their posts
                  </button>
                  {ingesting && <span className="hint">{ingesting}</span>}
                  {!ingesting && posts.length === 0 && (
                    <span className="hint">
                      Nothing of theirs is held yet. Their handle has to match the
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
                <h2 style={{ fontSize: 'var(--sc-text-lg)' }}>Suggested for them</h2>
                <span className="tally" style={{ color: 'var(--sc-ink-300)' }}>
                  {suggested.length > 0 ? `${suggested.length} not on a plan yet` : ''}
                </span>
              </div>

              {/* Narrow the rail to the formats wanted on this week. A format
                  on their won't-do list is shown struck and cannot be picked —
                  the matcher would refuse it anyway; better said than silent. */}
              <div className="weekrail" role="group" aria-label="Formats">
                {taxonomy.format.tags.map((tag) => {
                  const refused = (plan.wont_do ?? []).includes(tag.id)
                  return (
                    <button
                      key={tag.id}
                      className="pill"
                      disabled={refused}
                      data-on={formatFilter.includes(tag.id) || undefined}
                      style={refused ? { textDecoration: 'line-through', opacity: 0.5 } : undefined}
                      title={refused ? `On their won't-do list` : undefined}
                      onClick={() => setFormatFilter((current) =>
                        current.includes(tag.id)
                          ? current.filter((id) => id !== tag.id)
                          : [...current, tag.id])}
                    >
                      {tag.label}
                    </button>
                  )
                })}
                {formatFilter.length > 0 && (
                  <button className="pill" onClick={() => setFormatFilter([])}>Clear</button>
                )}
              </div>

              {suggested.length === 0 ? (
                <p className="hint">
                  {formatFilter.length > 0
                    ? 'Nothing scores on those formats. Clear the chips or tag more references.'
                    : 'Nothing scores yet. Tick the formats they do in their profile — an untagged model matches nothing rather than everything.'}
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
                  <span className="axis-name">What they see</span>
                  {/* Writes the DM and three captions for every card that lacks
                      them, five a request until none are left. On demand only:
                      the model allowance is shared with Whisper. */}
                  <button
                    className="chip"
                    disabled={writing !== null}
                    onClick={() => void writeCopy(planId)}
                  >
                    {writing ?? 'Write captions'}
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
                      Live, and safe to touch — nothing here writes to their week.
                      {plan?.status === 'draft' && ' This week is still a draft, so their link does not show it yet.'}
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

/** What the bot did with this week, in one line. */
function TelegramStatus({ plan, onRetry }: { plan: PlanHead; onRetry: () => void }) {
  if (plan.status !== 'sent' || !plan.telegram_state) return null
  const where = plan.telegram_title ?? 'their group'
  const when = plan.telegram_done_at
    ? new Date(plan.telegram_done_at).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })
    : ''
  const line = {
    queued: `Waiting for the Gosian bot to post it in ${where} — it checks every minute.`,
    manual: 'Waiting for the Gosian bot to note it as sent by you.',
    posted: `Posted on Telegram in ${where} · ${when}.`,
    recorded: `Recorded on the bot as sent by you · ${when}.`,
    failed: `The bot could not post it: ${plan.telegram_error ?? 'no reason given'}`,
  }[plan.telegram_state]
  return (
    <p className="hint" role="status" data-telegram={plan.telegram_state}>
      {line}
      {plan.telegram_state === 'failed' && plan.telegram_title && (
        <> <button className="chip" onClick={onRetry}>Try again</button></>
      )}
    </p>
  )
}
