'use client'

import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import { upload } from '@vercel/blob/client'
import CollisionFlag from './CollisionFlag'
import PlanPreview from './PlanPreview'
import { carryTarget, isPastWeek, openingWeek } from '@/lib/carry'
import { addDays, currentWeekOf, formatDate } from '@/lib/dates'
import { KIND_TEXT, cardKind } from '@/lib/card'
import { clock, playbookLabel, thumbUrl } from '@/lib/format'
import { CARD_SOURCES, SOURCE_TEXT, isSource, sourceOf } from '@/lib/source'
import { PLAN_TEMPLATES, TEMPLATE_TEXT, WINNING_MIN, isTemplate, type PlanTemplate } from '@/lib/template'
import { labelOf, taxonomy } from '@/lib/taxonomy'
import { STYLE_LABEL, conceptStem, isContentStyle, versionOf } from '@/lib/styles'
import type { AddedCard } from './CardComposer'
import ContentStyles from './ContentStyles'
import AutoField from './AutoField'
import CardVersions from './CardVersions'
import CoverThumb from './CoverThumb'
import DueDateField from './DueDateField'
import VolumeStepper from './VolumeStepper'
import { clearDrafts, draftValue, dropDraft, putDraft, readDrafts } from '@/lib/plan-drafts'
import DropSelect from '../dashboard/DropSelect'
import { EditorAssign, EditorsPanel, useEditors } from './Editors'
import PickVideos, { PICK_MIME, addPicksToWeek, readDraggedPicks, type Selection } from './PickVideos'
import {
  UPLOAD_LABEL, uploadStateOf,
  type HerPost, type PlanHead, type PlanItemRow, type PlanSummary, type Suggestion,
} from './types'

const COPY_RESET_MS = 1600
const BOT_CHECK_MS = 15_000
/** How often to look again while a pasted video is still downloading. */
const FETCH_CHECK_MS = 12_000

/* ------------------------------------------------------------ the warm read
   The dialog's first read is kept between opens (Geno, 2026-10-09): the
   roster warms it when the pointer rests on a card (`prefetchPlan`), so
   pressing Plan paints the weeks immediately and the fetch underneath only
   refreshes. Fresh reads always go to the network — only the first paint
   ever comes from here. */
const MODEL_TTL_MS = 60_000

type ModelPayload = {
  plans?: PlanSummary[]
  model?: { drive_url?: string | null }
}

type PlanPayload = { plan?: PlanHead | null; items?: PlanItemRow[] }

const modelCache = new Map<string, { at: number; body: ModelPayload }>()
const modelFlight = new Map<string, Promise<ModelPayload>>()
const planCache = new Map<string, { at: number; body: PlanPayload }>()
const planFlight = new Map<string, Promise<PlanPayload>>()

function fetchModel(modelId: string, fresh = false): Promise<ModelPayload> {
  const held = modelCache.get(modelId)
  if (!fresh && held && Date.now() - held.at <= MODEL_TTL_MS) return Promise.resolve(held.body)
  const flight = modelFlight.get(modelId)
  if (flight) return flight
  const request = fetch(`/api/models/${modelId}`)
    .then((response) => (response.ok ? response.json() : Promise.reject(new Error(String(response.status)))))
    .then((body: ModelPayload) => {
      modelCache.set(modelId, { at: Date.now(), body })
      return body
    })
    .finally(() => { modelFlight.delete(modelId) })
  modelFlight.set(modelId, request)
  return request
}

function fetchPlan(planId: string, fresh = false): Promise<PlanPayload> {
  const held = planCache.get(planId)
  if (!fresh && held && Date.now() - held.at <= MODEL_TTL_MS) return Promise.resolve(held.body)
  const flight = planFlight.get(planId)
  if (flight) return flight
  const request = fetch(`/api/plans/${planId}`)
    .then((response) => (response.ok ? response.json() : Promise.reject(new Error(String(response.status)))))
    .then((body: PlanPayload) => {
      planCache.set(planId, { at: Date.now(), body })
      return body
    })
    .finally(() => { planFlight.delete(planId) })
  planFlight.set(planId, request)
  return request
}

/** After a model's row lands, warm the plan the dialog will open on. */
function warmOpeningPlan(body: ModelPayload): void {
  const week = openingWeek(body.plans ?? [], currentWeekOf())
  if (week) void fetchPlan(week.id).catch(() => null)
}

/** Warm a model's weeks — and its opening week's cards — before the dialog
 *  opens. The roster hovers call this; clicking Plan then paints instantly. */
export function prefetchPlan(modelId: string): void {
  const held = modelCache.get(modelId)
  if (held && Date.now() - held.at <= MODEL_TTL_MS) {
    warmOpeningPlan(held.body)
    return
  }
  void fetchModel(modelId)
    .then((body) => warmOpeningPlan(body))
    .catch(() => null)
}

/** Thin row from a fast custom add — enough to paint until loadPlan lands. */
function stubCard(card: AddedCard): PlanItemRow {
  return {
    id: card.id,
    job_id: card.job_id,
    position: card.position,
    card_no: card.card_no,
    item_title: card.item_title,
    location: card.location ?? null,
    notes: card.notes,
    editing_notes: card.editing_notes ?? null,
    wardrobe: card.wardrobe ?? null,
    camera: null,
    takes: null,
    sound: null,
    hook: card.hook ?? null,
    caption: card.caption ?? null,
    filmed_at: null,
    posted_at: null,
    post_url: null,
    model_note: null,
    model_note_at: null,
    seen_at: null,
    accepted_at: null,
    declined_at: null,
    decline_reason: null,
    decline_code: null,
    messages: [],
    unread: 0,
    also_on: [],
    r2_key: null,
    r2_bytes: null,
    uploaded_at: null,
    r2_purged_at: null,
    take_key: null,
    take_bytes: null,
    take_duration_sec: null,
    take_uploaded_at: null,
    author: null,
    title: null,
    webpage_url: null,
    duration_sec: null,
    folder: null,
    has_thumb: Boolean(card.has_thumb ?? card.job_id),
    preview: null,
    bucket: 'custom',
    style: card.style ?? null,
    source: card.source,
    source_post: null,
  }
}

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
  /** Which week the loaded `plan` belongs to — `planId` moved ahead of it
   *  means the pane is mid-switch and shows a skeleton, not stale cards. */
  const [planFor, setPlanFor] = useState<string | null>(null)
  const [items, setItems] = useState<PlanItemRow[]>([])
  const [suggested, setSuggested] = useState<Suggestion[]>([])
  const [posts, setPosts] = useState<HerPost[]>([])
  const [pasting, setPasting] = useState('')
  /** The Add content step's link box — a reel found on Instagram, landed on
   *  the week as a thin card the Mac then fetches (Geno, 2026-10-13). */
  const [linkPaste, setLinkPaste] = useState('')
  const [linkBusy, setLinkBusy] = useState(false)
  const [linkNote, setLinkNote] = useState<string | null>(null)
  /** Which of her posts is mid-action, and what the last one said. */
  const [postBusy, setPostBusy] = useState<string | null>(null)
  const [postNote, setPostNote] = useState<string | null>(null)
  const [ingesting, setIngesting] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  /** Her page, beside the form. On by default: the reason it exists is that
   *  nobody remembers to go and look, and a preview behind a click is a
   *  preview nobody opens. */
  const [showPreview, setShowPreview] = useState(false)
  /** Once opened, keep the phone mounted so hide can slide out with content. */
  const [previewReady, setPreviewReady] = useState(false)
  /** Progress of the caption-and-DM writer, or null when idle. */
  const [writing, setWriting] = useState<string | null>(null)
  /** Removed cards, newest last — the Undo button walks this back. The whole
   *  row rides along, because the restore re-inserts it as it was. */
  const [undone, setUndone] = useState<{ label: string; row: Record<string, unknown> }[]>([])
  /** The format chips over the suggestions rail. Empty = everything. */
  const [formatFilter, setFormatFilter] = useState<string[]>([])
  /** The week's own intake: files dropped on the pane, and what the last
   *  one said. */
  const [intakeBusy, setIntakeBusy] = useState(false)
  const [intakeNote, setIntakeNote] = useState<string | null>(null)
  /** Saves in flight, the last one that landed, and whether the last failed. */
  const [saving, setSaving] = useState(0)
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [saveFailed, setSaveFailed] = useState(false)
  /** Edits kept on this device that never reached the server, offered back. */
  const [restorable, setRestorable] = useState<{ planId: string; entries: { field: string; value: string; at: number }[] } | null>(null)
  /** The left wall is browse-only until the Add card panel asks for library
   *  videos; what is ticked there is held here so the panel can use it. */
  const [picking, setPicking] = useState(false)
  const [selection, setSelection] = useState<Selection>(() => new Map())
  const weekJobIds = useMemo(
    () => new Set(items.map((item) => item.job_id).filter((id): id is string => Boolean(id))),
    [items],
  )
  /** Everything ticked on the wall, minus what the week already holds — the
   *  Add content panel wears them as references, one per card (or version). */
  const styleReferences = useMemo(() => {
    const out: { jobId: string; name: string | null; thumb: string | null }[] = []
    for (const [, pick] of selection) {
      if (pick.kind === 'library' && pick.jobId && !weekJobIds.has(pick.jobId)) {
        out.push({ jobId: pick.jobId, name: pick.name ?? null, thumb: pick.thumb ?? null })
      }
    }
    return out
  }, [selection, weekJobIds])
  /** The card list, with neighbouring versions of one concept folded under a
   *  single heading (Geno, 2026-10-13): "German #14 · Viral Clip Format" once,
   *  then Version 1, Version 2 under it — so a run of versions reads as one
   *  idea instead of unrelated cards. Only runs of two or more group; a lone
   *  version stays the card it is. */
  const cardRuns = useMemo(() => {
    type Run = { key: string; stem: string; grouped: boolean; rows: { item: PlanItemRow; index: number }[] }
    const runs: Run[] = []
    items.forEach((item, index) => {
      const version = versionOf(item.item_title)
      const stem = conceptStem(item.item_title)
      const last = runs[runs.length - 1]
      if (version !== null && last && last.grouped && last.stem === stem) {
        last.rows.push({ item, index })
        return
      }
      runs.push({ key: item.id, stem, grouped: version !== null, rows: [{ item, index }] })
    })
    for (const run of runs) if (run.rows.length < 2) run.grouped = false
    return runs
  }, [items])

  /** A wall card is being dragged over the week. Counted, because every
   *  child the pointer crosses fires its own enter/leave pair. */
  const [dropOver, setDropOver] = useState(false)
  const dropDepth = useRef(0)
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
  /** Her delivery folder, edited here and stored on the model — it is what
   *  her page shows under "Where to send it". */
  const [delivery, setDelivery] = useState('')
  /** The card whose editor is open. Null shows the compact list — the week
   *  is a scan, not a wall of twenty open forms (Geno, 2026-10-09). */
  const [openCard, setOpenCard] = useState<string | null>(null)
  /** The Add content panel — "+ Add card" on the step's heading opens it. */
  const [addOpen, setAddOpen] = useState(false)
  /** Copying the week onto another creator's week — the dialog's own state. */
  const [copyOpen, setCopyOpen] = useState(false)
  const [copyModels, setCopyModels] = useState<{ id: string; name: string }[]>([])
  const [copyTarget, setCopyTarget] = useState('')
  const [copyWeeks, setCopyWeeks] = useState<string[]>([])
  const [copyWeek, setCopyWeek] = useState('')
  const [copyBusy, setCopyBusy] = useState(false)
  const [copyNote, setCopyNote] = useState<string | null>(null)

  const thisWeek = currentWeekOf()
  /** The nothing-to-open case creates this week's plan exactly once per
   *  mount, from the fresh read only — see `applyModel` in loadWeeks. */
  const autoOpen = useRef(false)
  /** True until the dialog's one opening read lands — the pane shows a
   *  skeleton for it, never "No week open". */
  const [opening, setOpening] = useState(true)
  const [openError, setOpenError] = useState<string | null>(null)
  /** The folds below the cards (posts, suggestions, verticals) wait for the
   *  week to paint, so they do not queue ahead of it. */
  const [primed, setPrimed] = useState(false)
  const planIdRef = useRef<string | null>(null)
  useEffect(() => { planIdRef.current = planId }, [planId])
  /** The opening read already carried this plan's cards: loadPlan paints them
   *  from the cache once without asking the network again. */
  const seeded = useRef<string | null>(null)
  /** `planId` moved ahead of the loaded card data: mid-switch. */
  const planStale = Boolean(planId) && planFor !== planId

  const loadWeeks = useCallback(async () => {
    /** Paint one read of her row: the weeks, the delivery folder, and — when
     *  there is nothing at all to open — this week, created the same way the
     *  rail's "+ This week" button creates it. */
    function applyModel(payload: ModelPayload, fresh: boolean) {
      const list: PlanSummary[] = payload.plans ?? []
      setWeeks(list)
      // Same response carries her row — the delivery folder rides along
      // rather than costing the editor a second fetch.
      setDelivery(payload.model?.drive_url ?? '')
      const open = openingWeek(list, thisWeek)
      if (open) {
        setPlanId((current) => current ?? open.id)
        return
      }
      // A model with no weeks at all used to dead-end on "Open a week". Land
      // on the current week instead (Geno, 2026-10-09). Decided once per
      // mount, and only off the fresh read, so a stale cache can never spawn
      // a duplicate — and the fetch underneath replaces this the moment the
      // server answers either way.
      if (!fresh || autoOpen.current) return
      autoOpen.current = true
      void openWeek(thisWeek)
    }

    // Whatever the roster warmed paints first; the fresh copy replaces it
    // underneath, so the dialog opens on the week and never on a spinner.
    const held = modelCache.get(modelId)
    if (held) applyModel(held.body, false)
    const body = await fetchModel(modelId, true).catch(() => null)
    if (body) applyModel(body, true)
  }, [modelId, thisWeek])

  const loadPlan = useCallback(async () => {
    if (!planId) { setPlan(null); setItems([]); setPlanFor(null); return }
    // Whatever the roster hover warmed paints first; the fresh read replaces
    // it underneath. Selecting a week shows a skeleton, never a dead pane.
    const held = planCache.get(planId)
    if (held) {
      setPlan(held.body.plan ?? null)
      setItems(held.body.items ?? [])
      setPlanFor(planId)
      if (seeded.current === planId) {
        seeded.current = null
        return
      }
    } else {
      setPlan(null)
      setItems([])
    }
    const body = await fetchPlan(planId, true).catch(() => null)
    if (!body) return
    setPlan(body.plan ?? null)
    setItems(body.items ?? [])
    setPlanFor(planId)
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

  // The opening read: weeks, delivery folder and the opening week's cards in
  // one request (POST /api/models/:id/open), which also creates this week
  // when she has none. Whatever the roster hover warmed paints underneath it
  // first. Falls back to the old model-then-plan walk if it fails.
  useEffect(() => {
    let gone = false
    const held = modelCache.get(modelId)
    if (held) {
      const list = held.body.plans ?? []
      setWeeks(list)
      setDelivery(held.body.model?.drive_url ?? '')
      const open = openingWeek(list, thisWeek)
      if (open) setPlanId((current) => current ?? open.id)
    }
    fetch(`/api/models/${modelId}/open`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ week_of: thisWeek }),
    })
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error(String(response.status)))))
      .then((body: ModelPayload & PlanPayload) => {
        if (gone) return
        autoOpen.current = true
        const at = Date.now()
        modelCache.set(modelId, { at, body: { plans: body.plans, model: body.model } })
        setWeeks(body.plans ?? [])
        setDelivery(body.model?.drive_url ?? '')
        if (!body.plan?.id) return
        const opened = String(body.plan.id)
        planCache.set(opened, { at, body: { plan: body.plan, items: body.items } })
        const current = planIdRef.current
        if (current === opened) {
          setPlan(body.plan)
          setItems(body.items ?? [])
          setPlanFor(opened)
        } else if (!current) {
          seeded.current = opened
          setPlanId(opened)
        }
      })
      .catch(() => { if (!gone) void loadWeeks() })
      .finally(() => {
        if (gone) return
        setOpening(false)
        setPrimed(true)
      })
    return () => { gone = true }
    // Once per dialog: later refreshes go through loadWeeks/loadPlan.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelId])

  useEffect(() => { if (primed) void loadPosts() }, [primed, loadPosts])
  useEffect(() => { if (primed) void loadWinning() }, [primed, loadWinning])
  useEffect(() => { void loadPlan() }, [loadPlan])
  useEffect(() => { if (primed) void loadSuggested() }, [primed, loadSuggested])
  useEffect(() => { setRevision((n) => n + 1) }, [plan, items])

  // A card that left the week (or moved off it) cannot stay open; fall back
  // to the list rather than an editor pointing at nothing.
  useEffect(() => {
    if (openCard && !items.some((item) => item.id === openCard)) setOpenCard(null)
  }, [items, openCard])

  // Opening a card (or stepping ‹ ›) pins its top into view so you are not
  // stuck mid-list staring at the foot of the previous row.
  useEffect(() => {
    if (!openCard) return
    const node = document.getElementById(`planrow-${openCard}`)
    if (!node) return
    const run = () => node.scrollIntoView({ behavior: 'smooth', block: 'start' })
    const frame = requestAnimationFrame(run)
    // One more beat after the open layout expands (cover + folds).
    const timer = window.setTimeout(run, 80)
    return () => {
      cancelAnimationFrame(frame)
      window.clearTimeout(timer)
    }
  }, [openCard])

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
    setOpenError(null)
    const response = await fetch('/api/plans', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model_id: modelId, week_of: weekOf }),
    }).catch(() => null)
    const body = await response?.json().catch(() => ({})) ?? {}
    setBusy(false)
    if (body.plan?.id) {
      setPlanId(String(body.plan.id))
      void loadWeeks()
    } else {
      setOpenError(body.error ? `That week did not open: ${body.error}.` : 'That week did not open — check the connection and try again.')
    }
  }

  /** Every save in the pane reports here, so the header can say whether the
   *  week is safe: saving, saved at a time, or kept on this device. */
  async function tracked(run: () => Promise<Response | null>): Promise<Response | null> {
    setSaving((count) => count + 1)
    const response = await run().catch(() => null)
    setSaving((count) => count - 1)
    if (response?.ok) {
      setSavedAt(Date.now())
      setSaveFailed(false)
    } else {
      setSaveFailed(true)
    }
    return response
  }

  async function patchPlan(patch: Record<string, unknown>): Promise<boolean> {
    if (!planId) return false
    const response = await tracked(() => fetch(`/api/plans/${planId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    }))
    if (!response?.ok) return false
    const body = await response.json().catch(() => ({}))
    setPlan((current) => (current ? { ...current, ...body.plan } : current))
    // Sent, but the bot was not asked (no group linked, marketing off).
    if (body.warning) setCarryNote({ planId, text: body.warning })
    void loadWeeks()
    return true
  }

  /** Send the week. `post`: the Gosian bot posts it in their MARKETING topic.
   *  `manual`: Geno sent it himself; the bot only records it. */
  async function send(telegram: 'post' | 'manual') {
    setCarryNote(null)
    await patchPlan({ status: 'sent', telegram, variant })
  }

  /* ---------------------------------------------------------------- copy */
  /** The Copy plan dialog (Geno, 2026-10-12): pick a creator, pick their
   *  week, and every card of this week lands on theirs as a fresh draft. */
  async function openCopy() {
    setCopyOpen(true)
    setCopyNote(null)
    setCopyTarget('')
    setCopyWeeks([])
    setCopyWeek('')
    if (copyModels.length > 0) return
    const response = await fetch('/api/models').catch(() => null)
    const body = await response?.json().catch(() => ({})) ?? {}
    const models = Array.isArray(body.models)
      ? (body.models as { id?: unknown; name?: unknown }[])
        .map((model) => ({ id: String(model.id ?? ''), name: String(model.name ?? '') }))
        .filter((model) => Boolean(model.id))
      : []
    setCopyModels(models)
  }

  async function pickCopyTarget(modelId: string) {
    setCopyTarget(modelId)
    setCopyWeeks([])
    setCopyWeek('')
    if (!modelId) return
    // Their weeks, so an existing one can be chosen; this week is always
    // offered too — the copy creates it when it does not exist yet.
    const body = await fetchModel(modelId).catch(() => null)
    const weeks = [...new Set((body?.plans ?? []).map((week) => week.week_of))]
    setCopyWeeks(weeks)
    setCopyWeek(weeks.includes(thisWeek) ? thisWeek : weeks[0] ?? thisWeek)
  }

  async function copyPlanTo() {
    if (!planId || !copyTarget || !copyWeek || copyBusy) return
    setCopyBusy(true)
    setCopyNote(null)
    const response = await fetch(`/api/plans/${planId}/copy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model_id: copyTarget, week_of: copyWeek }),
    }).catch(() => null)
    const body = await response?.json().catch(() => ({})) ?? {}
    setCopyBusy(false)
    if (!response?.ok) {
      setCopyNote(body.error ?? 'That did not copy — try again.')
      return
    }
    const name = copyModels.find((model) => model.id === copyTarget)?.name ?? 'their week'
    const added = Number(body.added ?? 0)
    const skipped = Number(body.skipped ?? 0)
    setCopyNote(
      `Copied ${added} card${added === 1 ? '' : 's'} into ${name} — week of ${formatDate(copyWeek)}`
      + (skipped > 0 ? ` · ${skipped} already on that week` : '') + '.',
    )
    // Warm the week they just received, so opening it there paints instantly.
    if (body.plan?.id) void fetchPlan(String(body.plan.id)).catch(() => null)
    void loadWeeks()
  }

  async function patchItem(id: string, patch: Record<string, unknown>): Promise<boolean> {
    if (!planId) return false
    const response = await tracked(() => fetch(`/api/plans/${planId}/items`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, ...patch }),
    }))
    if (!response?.ok) return false
    const body = await response.json().catch(() => ({}))
    setItems((current) => current.map((item) => (item.id === id ? { ...item, ...body.item } : item)))
    return true
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

  /** A reel found on Instagram or TikTok, straight onto the open week
   *  (Geno, 2026-10-13). The composer's rewrite had folded this box away;
   *  it is the queue's own door — paste, land, the Mac fetches it next. */
  async function addLink() {
    const text = linkPaste.trim()
    if (!text || !planId || linkBusy) return
    setLinkBusy(true)
    setLinkNote(null)
    const response = await fetch('/api/links', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, plan_id: planId }),
    }).catch(() => null)
    const body = await response?.json().catch(() => ({})) ?? {}
    setLinkBusy(false)
    if (!response?.ok) {
      setLinkNote(body.error ?? 'That link did not go in — try again.')
      return
    }
    const cards: { id?: unknown; card_no?: unknown }[] = Array.isArray(body.cards) ? body.cards : []
    if (cards.length > 0) {
      setJustLanded(new Set(cards.map((card) => String(card.id))))
      window.setTimeout(() => setJustLanded(new Set()), 8000)
    }
    const landed = cards.map((card) => (card.card_no ? `V-${card.card_no}` : 'a card')).join(' · ')
    setLinkNote(cards.length > 0
      ? `On the week as ${landed} — the Mac fetches it next, nothing to do.`
      : 'Nothing landed — it is already on this week, or they have turned it down.')
    setLinkPaste('')
    await loadPlan()
    void loadWeeks()
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

  /** One concept in N outfits: the card becomes Version 1 and gets numbered
   *  siblings — V-6..V-9 of the same idea, each its own card to film. */
  async function makeVersions(id: string, total: number) {
    if (!planId || total < 2) return
    await fetch(`/api/plans/${planId}/items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ duplicate: id, count: total - 1, versions: true }),
    })
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

  /** A card dragged off the wall and let go on the week. Only the wall's own
   *  drags carry PICK_MIME; files are takeFiles' business. */
  const isPickDrag = (event: DragEvent) => event.dataTransfer.types.includes(PICK_MIME)

  async function dropPicks(event: DragEvent) {
    if (!isPickDrag(event)) return
    event.preventDefault()
    dropDepth.current = 0
    setDropOver(false)
    const picks = readDraggedPicks(event.dataTransfer)
    if (!planId || picks.length === 0) return
    setIntakeBusy(true)
    setIntakeNote(`Adding ${picks.length} to the week…`)
    const result = await addPicksToWeek(planId, picks)
    setIntakeNote(result.text)
    setIntakeBusy(false)
    if (result.landed > 0) {
      void loadPlan()
      void loadWeeks()
    }
  }

  /* ------------------------------------------------ the safety net
     Field names, as AutoField keeps them: `plan:<column>`, `model:drive`,
     `item:<id>:<column>`, and `intake` for the paste box. */
  const ITEM_FIELD_TEXT: Record<string, string> = {
    twist: 'twist', item_title: 'title', location: 'location',
    caption: 'caption', notes: 'direction', editing_notes: 'editing notes',
  }

  function serverValue(field: string): string | null {
    if (!plan) return null
    if (field === 'plan:title') return plan.title ?? ''
    if (field === 'plan:due_date') return plan.due_date ?? ''
    if (field === 'plan:target') return plan.target == null ? '' : String(plan.target)
    if (field === 'model:drive') return delivery
    const [kind, id, column] = field.split(':')
    if (kind !== 'item' || !column || !(column in ITEM_FIELD_TEXT)) return null
    const item = items.find((entry) => entry.id === id)
    if (!item) return null
    return String((item as unknown as Record<string, unknown>)[column] ?? '')
  }

  function draftLabel(field: string): string {
    if (field === 'plan:title') return 'Week title'
    if (field === 'plan:due_date') return 'Due date'
    if (field === 'plan:target') return 'Videos wanted'
    if (field === 'model:drive') return 'Delivery folder'
    const [, id, column] = field.split(':')
    const at = items.findIndex((entry) => entry.id === id)
    return `Card ${at + 1} · ${ITEM_FIELD_TEXT[column] ?? column}`
  }

  const draftsChecked = useRef<string | null>(null)
  useEffect(() => {
    if (!planId || !plan || plan.id !== planId || draftsChecked.current === planId) return
    draftsChecked.current = planId
    const held = readDrafts(planId)
    const entries = Object.entries(held)
      .filter(([field, entry]) => {
        const current = serverValue(field)
        return current !== null && entry.value !== current
      })
      .map(([field, entry]) => ({ field, value: entry.value, at: entry.at }))
    // Anything that already matches the server, or whose card is gone, is
    // not worth a banner — clear it so it is not offered forever.
    clearDrafts(planId, Object.keys(held).filter((field) =>
      !field.startsWith('reply:') && !entries.some((entry) => entry.field === field)))
    setRestorable(entries.length > 0 ? { planId, entries } : null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planId, plan, items])

  async function restoreDrafts() {
    if (!restorable || restorable.planId !== planId) return
    const { entries } = restorable
    setRestorable(null)
    for (const { field, value } of entries) {
      let ok = true
      if (field === 'plan:target') {
        ok = await patchPlan({ target: value === '' ? 0 : Number(value) })
      } else if (field.startsWith('plan:')) {
        ok = await patchPlan({ [field.slice(5)]: value })
      } else if (field === 'model:drive') {
        ok = await saveDelivery(value.trim())
      } else if (field.startsWith('item:')) {
        const [, id, column] = field.split(':')
        ok = await patchItem(id, { [column]: value })
      }
      if (ok) dropDraft(restorable.planId, field, value)
    }
  }

  function discardDrafts() {
    if (!restorable) return
    clearDrafts(restorable.planId, restorable.entries.map((entry) => entry.field))
    setRestorable(null)
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

  /** Where she sends the footage. Stored on the model; her page shows it, so
   *  the preview is told to look again the moment it saves. */
  async function saveDelivery(value: string): Promise<boolean> {
    if (value === delivery) return true
    const response = await tracked(() => fetch(`/api/models/${modelId}/delivery`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ drive_url: value }),
    }))
    const body = await response?.json().catch(() => ({})) ?? {}
    if (!response?.ok) {
      if (planId) setCarryNote({ planId, text: body.error ?? 'That folder did not save.' })
      return false
    }
    setDelivery(body.drive_url ?? '')
    setRevision((n) => n + 1)
    return true
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

  const target = plan ? (plan.target ?? plan.weekly_target ?? 0) : 0
  const short = target > 0 && items.length < target ? target - items.length : 0
  const videosReady = waiting === 0 && missing === 0 && fetching === 0
  const issues = (videosReady ? 0 : 1) + (short > 0 ? 1 : 0) + (unanswered > 0 ? 1 : 0)
    + (unassignedEdits > 0 ? 1 : 0) + (repeated.length > 0 ? 1 : 0)
  const meter = target > 0 ? Math.min(100, Math.round((items.length / target) * 100)) : items.length > 0 ? 100 : 0
  return (
    <>
      <button className="reader-scrim" onClick={onClose} aria-label="Close" />
      <div className="planmodal" role="dialog" aria-modal="true" aria-label={`${modelName}'s plan`}>
        <header className="planmodal-head">
          <div>
            <h3>{modelName}</h3>
            <p className="facts">
              {planStale
                ? 'Loading the week…'
                : plan
                  ? `Week of ${formatDate(plan.week_of)} · ${items.length} item${items.length === 1 ? '' : 's'} · ${filmed} filmed`
                  : 'No week open'}
            </p>
          </div>
          <span className="planmodal-head-actions">
            <button
              type="button"
              className="planmodal-preview"
              disabled={!planId}
              aria-pressed={showPreview}
              aria-controls="plan-what-they-see"
              onClick={() => {
                setShowPreview((on) => {
                  if (!on) setPreviewReady(true)
                  return !on
                })
              }}
            >
              {showPreview ? 'Hide preview' : 'What they see'}
            </button>
            <button className="planmodal-close" onClick={onClose} aria-label="Close">Close</button>
          </span>
        </header>

        <div className="planmodal-body">
          {/* The selector, always on the left (Geno, 2026-10-09): the videos
              are picked from a scrolling wall — the library and the three
              OFMPro feeds — while the week itself is edited beside them. */}
          <PickVideos
            planId={planId}
            enabled={picking}
            selection={selection}
            setSelection={setSelection}
            onAdded={() => { void loadPlan(); void loadWeeks() }}
          />
          <div className="planpane" data-preview={showPreview && planId ? 'true' : undefined}>
            {planId && showPreview && (
              <button
                type="button"
                className="planpreview-scrim"
                aria-label="Hide what they see"
                onClick={() => setShowPreview(false)}
              />
            )}
            <div className="planpane-main">
          <div className="weekbar">
          <div className="weekbar-head">
            <span className="weekbar-title">Weeks</span>
            <span className="weekbar-count">
              {opening && weeks.length === 0 ? 'Loading…' : `${weeks.length} week${weeks.length === 1 ? '' : 's'}`}
            </span>
          </div>
          <nav className="weektabs" aria-label="Weeks">
            {weeks.map((week) => (
              <button
                key={week.id}
                type="button"
                className="weektab"
                data-on={week.id === planId || undefined}
                aria-current={week.id === planId ? 'true' : undefined}
                onClick={() => setPlanId(week.id)}
              >
                <span className="weektab-date">{formatDate(week.week_of)}</span>
                <span className="weektab-meta">
                  <i className="weektab-dot" data-status={week.status} aria-hidden="true" />
                  {week.filmed}/{week.items} · {week.status === 'draft' ? 'draft' : 'sent'}
                </span>
                {week.unread > 0 && <span className="weektab-new">{week.unread} new</span>}
              </button>
            ))}
            {opening && weeks.length === 0 ? (
              <>
                <span className="weektab weektab-skel" aria-hidden="true" />
                <span className="weektab weektab-skel" aria-hidden="true" />
              </>
            ) : (
              <>
                {!knownWeeks.has(thisWeek) && (
                  <button type="button" className="weektab weektab-add" disabled={busy} onClick={() => openWeek(thisWeek)}>
                    + This week
                  </button>
                )}
                {!knownWeeks.has(nextWeek) && (
                  <button type="button" className="weektab weektab-add" disabled={busy} onClick={() => openWeek(nextWeek)}>
                    + Next week
                  </button>
                )}
              </>
            )}
          </nav>
          </div>

          {!plan && (opening || planStale || busy) ? (
            <div className="planskel" aria-busy="true" aria-label="Loading the week">
              <span className="planskel-line" data-w="title" />
              <span className="planskel-block" data-h="stats" />
              <span className="planskel-block" data-h="check" />
              <span className="planskel-block" data-h="row" />
              <span className="planskel-block" data-h="row" />
              <span className="planskel-block" data-h="row" />
            </div>
          ) : !plan ? (
            <div className="planempty planempty-start">
              <span className="planempty-mark" aria-hidden="true">
                <i /><i /><i /><i /><i /><i /><i />
              </span>
              <p className="planempty-title">No week open</p>
              <p className="hint">Open a week, then tag videos to them from the library.</p>
              <div className="planempty-actions">
                <button type="button" className="btn btn-small plansend-primary" disabled={busy} onClick={() => openWeek(thisWeek)}>
                  {knownWeeks.has(thisWeek) ? 'Open this week' : 'Start this week'}
                </button>
                <button type="button" className="btn btn-small btn-quiet" disabled={busy} onClick={() => openWeek(nextWeek)}>
                  {knownWeeks.has(nextWeek) ? 'Open next week' : 'Start next week'}
                </button>
              </div>
              {openError && <p className="hint" data-tone="bad" role="alert">{openError}</p>}
            </div>
          ) : (
            <>
              <div
                className="weekscroll"
                data-drop={dropOver || undefined}
                onDragEnter={(event) => {
                  if (!isPickDrag(event)) return
                  dropDepth.current += 1
                  setDropOver(true)
                }}
                onDragOver={(event) => {
                  if (!isPickDrag(event)) return
                  event.preventDefault()
                  event.dataTransfer.dropEffect = 'copy'
                }}
                onDragLeave={(event) => {
                  if (!isPickDrag(event)) return
                  dropDepth.current = Math.max(0, dropDepth.current - 1)
                  if (dropDepth.current === 0) setDropOver(false)
                }}
                onDrop={(event) => void dropPicks(event)}
              >
              {dropOver && (
                <div className="weekdrop" aria-hidden="true">
                  <span>Drop to add to the week of {formatDate(plan.week_of)}</span>
                </div>
              )}
              <section className="weekhead" aria-label="This week">
                <div className="weekhead-top">
                  <div className="weekhead-id">
                    <h4 className="weekhead-title">Week of {formatDate(plan.week_of)}</h4>
                    {plan.title && <p className="weekhead-sub">{plan.title}</p>}
                  </div>
                  <div className="weekhead-aside">
                    <button
                      type="button"
                      className="btn btn-small btn-quiet"
                      onClick={() => void openCopy()}
                    >Copy plan</button>
                    <span
                      className="weekhead-save"
                      data-state={saving > 0 ? 'saving' : saveFailed ? 'failed' : savedAt ? 'saved' : 'idle'}
                      role="status"
                      aria-live="polite"
                    >
                      {saving > 0
                        ? 'Saving…'
                        : saveFailed
                          ? 'Not saved — kept on this device'
                          : savedAt
                            ? `Saved ${new Date(savedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
                            : 'Changes save as you type'}
                    </span>
                    <span className="weekhead-status" data-status={plan.status}>
                      {plan.status === 'sent' ? 'Sent' : 'Draft'}
                    </span>
                  </div>
                </div>
                <dl className="weekhead-stats">
                  <div className="weekstat">
                    <dt>Cards</dt>
                    <dd>{items.length}<small> / {target}</small></dd>
                  </div>
                  <div className="weekstat">
                    <dt>Filmed</dt>
                    <dd>{filmed}<small> / {items.length}</small></dd>
                  </div>
                  <div className="weekstat">
                    <dt>Due</dt>
                    <dd>{plan.due_date ? formatDate(plan.due_date) : '—'}</dd>
                  </div>
                </dl>
                <div
                  className="weekhead-meter"
                  data-full={target > 0 && items.length >= target || undefined}
                  role="progressbar"
                  aria-label="Cards on the week against the target"
                  aria-valuemin={0}
                  aria-valuemax={target}
                  aria-valuenow={items.length}
                >
                  <i style={{ width: `${meter}%` }} />
                </div>
              </section>

              {restorable?.planId === planId && (
                <div className="planrestore" role="alert">
                  <div className="planrestore-text">
                    <p className="planrestore-title">
                      {restorable.entries.length} unsaved change{restorable.entries.length === 1 ? '' : 's'} from{' '}
                      {new Date(Math.max(...restorable.entries.map((entry) => entry.at)))
                        .toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })}
                    </p>
                    <p className="planrestore-list">
                      {restorable.entries.map((entry) => draftLabel(entry.field)).join(' · ')}
                      {' — '}typed here but never reached the server.
                    </p>
                  </div>
                  <div className="planrestore-actions">
                    <button type="button" className="btn btn-small btn-quiet" onClick={discardDrafts}>Discard</button>
                    <button type="button" className="btn btn-small plansend-primary" onClick={() => void restoreDrafts()}>Restore</button>
                  </div>
                </div>
              )}

              {carryTo && (
                <div className="planstate planstate-carry planstate-action">
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

              {/* Step 1 — the week itself (Geno, 2026-10-09). The pane reads
                  in the order a week is worked: set it up, add content, go
                  through the cards, check, send. Setup is always open — every
                  field already has a sensible default, so "keep it as it is"
                  is a fine answer. Every box saves as it is typed. */}
              <section className="planstep planstep-setup" data-open aria-label="Set up the week">
                <header className="planstep-head">
                  <span className="planstep-no" aria-hidden="true">1</span>
                  <span className="planstep-id">
                    <span className="planstep-title" role="heading" aria-level={4}>Set up the week</span>
                    <span className="planstep-sub">Optional — every field has a default. Edit what you need, leave the rest.</span>
                  </span>
                </header>
                <div className="planstep-body setupgroups" id="plan-setup-body">

                <div className="setupgroup" role="group" aria-label="Basics">
                  <p className="setupgroup-title" aria-hidden="true">Basics</p>
                  <div className="setupgroup-grid">
                    <div className="form-row">
                      <label className="axis-name" htmlFor="plan-title">Title</label>
                      <AutoField
                        id="plan-title"
                        className="field"
                        planId={planId}
                        field="plan:title"
                        value={plan.title}
                        placeholder="Optional — e.g. CW42"
                        onCommit={(value) => patchPlan({ title: value })}
                      />
                    </div>
                    <div className="form-row">
                      <label className="axis-name" htmlFor="plan-due">Due</label>
                      <DueDateField
                        planId={planId}
                        value={plan.due_date}
                        onCommit={(value) => patchPlan({ due_date: value })}
                      />
                    </div>
                  </div>
                </div>

              {/* How many reels THIS week wants, and the dots filling toward
                  it (Geno, 2026-10-08) — every added video lights one more.
                  Blank falls back to their weekly target. */}
                <div className="setupgroup" role="group" aria-label="Volume">
                  <p className="setupgroup-title" aria-hidden="true">Volume</p>
                  <div className="form-row">
                    <label className="axis-name" htmlFor="plan-target">Videos wanted this week</label>
                    <div className="plandots-row">
                      <VolumeStepper
                        planId={planId}
                        value={plan.target}
                        usual={plan.weekly_target || 21}
                        onCommit={(n) => patchPlan({ target: n })}
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
                    <span className="hint">Leave it empty to use their usual {plan.weekly_target || 21}.</span>
                  </div>
                </div>

              {/* Where she uploads (Geno, 2026-10-09): the same folder the
                  Week tab sets, editable from the plan being built — it is
                  what her page shows under "Where to send it". Stored on the
                  model, not the week. */}
                <div className="setupgroup" role="group" aria-label="Delivery">
                  <p className="setupgroup-title" aria-hidden="true">Delivery</p>
                  <div className="form-row">
                    <label className="axis-name" htmlFor="plan-drive">Folder — where they send the footage</label>
                    <AutoField
                      id="plan-drive"
                      className="field"
                      type="url"
                      planId={planId}
                      field="model:drive"
                      value={delivery}
                      placeholder="https://drive.google.com/drive/folders/…"
                      onCommit={(value) => saveDelivery(value.trim())}
                    />
                    <span className="hint">
                      Their page shows it as “Where to send it”. Leave it empty and she sees no folder.
                    </span>
                  </div>
                </div>

              {/* The intro box is gone (Geno, 2026-10-06): her page now opens
                  with the counted contents of the plan instead of a written
                  paragraph. plans.intro stays in the database untouched. */}

                <div className="setupgroup" role="group" aria-label="Template">
                  <p className="setupgroup-title" aria-hidden="true">Template</p>

              {/* Which template drives their autodraft (2026-10-08). On the
                  model, not the week — next Sunday inherits it. Auto follows
                  the ladder; the line under the select says where they are. */}
              {winning ? (
                <div className="form-row">
                  <label className="axis-name" htmlFor="plan-template">Which template drives their autodraft</label>
                  <DropSelect
                    id="plan-template"
                    label="Which template drives their autodraft"
                    value={winning.template ?? ''}
                    onChange={(next) => void setTemplate(isTemplate(next) ? next : null)}
                    options={[
                      { value: '', label: `Auto — follows their winners (${TEMPLATE_TEXT[winning.suggested].label} now)` },
                      ...PLAN_TEMPLATES.map((template) => {
                        const locked = template === 'winning' && winning.winners_count < WINNING_MIN
                        return {
                          value: template,
                          label: locked
                            ? `${TEMPLATE_TEXT[template].label} — needs ${WINNING_MIN} winners (they have ${winning.winners_count})`
                            : TEMPLATE_TEXT[template].label,
                          disabled: locked,
                        }
                      }),
                    ]}
                  />
                  <span className="hint">
                    {TEMPLATE_TEXT[winning.template ?? winning.suggested].line}
                    {winning.verticals.length > 0 && (
                      <> {' '}Their winning verticals:{' '}
                      {winning.verticals.map((vertical) =>
                        `${labelOf('format', vertical.format)} (${vertical.posts})`).join(' · ')}.</>
                    )}
                  </span>
                </div>
              ) : (
                <p className="hint">Reading their template…</p>
              )}

              {/* The nudge, only when the ladder and the setting disagree. */}
              {winning && winning.winners_count >= WINNING_MIN && winning.template !== 'winning' && winning.template !== 'custom' && (
                <div className="planstate planstate-short planstate-action">
                  <span>
                    They have {winning.winners_count} winning reels — the Winning Verticals
                    template would build their week around what already works for them.
                  </span>
                  <button className="btn btn-small" onClick={() => void setTemplate('winning')}>
                    Switch
                  </button>
                </div>
              )}
                </div>

                <div className="setupgroups-foot">
                  <span className="hint">Every change saves as you type.</span>
                </div>
                </div>
              </section>

              {/* The queue, on the week: paste links or drop files, and they
                  land on THIS plan as cards — thin until the Mac fetches the
                  videos. Folded behind its own button since 2026-10-09: an
                  always-open textarea earned its space about once a day. */}
              <section
                className="planstep planadd"
                aria-label="Add content"
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault()
                  void takeFiles(event.dataTransfer.files)
                }}
              >
                <header className="planstep-head">
                  <span className="planstep-no" aria-hidden="true">2</span>
                  <span className="planstep-id">
                    <span className="planstep-title" role="heading" aria-level={4}>Add content</span>
                    <span className="planstep-sub">Paste a link straight from Instagram — or add by style.</span>
                  </span>
                  <span className="planstep-aside">
                    <button
                      type="button"
                      className="btn btn-small"
                      aria-expanded={addOpen}
                      onClick={() => setAddOpen((open) => !open)}
                    >{addOpen ? 'Close' : '+ Add card'}</button>
                  </span>
                </header>

                {/* Found it on Instagram? One box, one card (Geno, 2026-10-13).
                    The same door a paste takes in the queue: a thin card until
                    the Mac fetches, then the video is on it by itself. */}
                <div className="planadd-link" role="group" aria-label="Add a reel by link">
                  <input
                    className="field"
                    type="url"
                    value={linkPaste}
                    placeholder="Paste an Instagram or TikTok link — it lands on the week and the Mac fetches it"
                    aria-label="Paste a reel link"
                    onChange={(event) => { setLinkPaste(event.target.value); setLinkNote(null) }}
                    onKeyDown={(event) => { if (event.key === 'Enter') void addLink() }}
                  />
                  <button
                    type="button"
                    className="btn btn-small"
                    disabled={linkBusy || !linkPaste.trim() || !planId}
                    onClick={() => void addLink()}
                  >
                    {linkBusy ? 'Adding…' : 'Add link'}
                  </button>
                </div>
                {linkNote && <p className="hint planadd-note" role="status">{linkNote}</p>}

                {/* The CD brief's flow (Geno, 2026-10-12): ask what style it
                    is, open that style's form, and land the card on the week
                    with its style as a tag — the older tiles stay below. */}
                {addOpen && planId && (
                  <ContentStyles
                    planId={planId}
                    items={items}
                    taken={weekJobIds}
                    references={styleReferences}
                    onPickingChange={setPicking}
                    onClearReference={() => setSelection(new Map())}
                    onCardsAdded={(fresh) => {
                      const rows = fresh.map(stubCard)
                      setItems((current) => [...current, ...rows])
                      setJustLanded(new Set(rows.map((row) => row.id)))
                      window.setTimeout(() => setJustLanded(new Set()), 8000)
                      // The ticked video was consumed by the card that just
                      // landed — the next card starts from a clean wall.
                      setSelection(new Map())
                      // Quiet reconcile — the cards already painted.
                      void loadPlan()
                      void loadWeeks()
                    }}
                    onClose={() => setAddOpen(false)}
                  />
                )}

                {intakeNote && <p className="hint planadd-note" role="status">{intakeNote}</p>}
              </section>


              <section className="planstep plancards" aria-label="Cards on this week">
                <header className="planstep-head">
                  <span className="planstep-no" aria-hidden="true">3</span>
                  <span className="planstep-id">
                    <span className="planstep-title" role="heading" aria-level={4}>Go through the cards</span>
                    <span className="planstep-sub">Open a card to edit what they see — everything saves as you type.</span>
                  </span>
                  <span className="planstep-aside">
                    {items.length} card{items.length === 1 ? '' : 's'}{items.length > 0 ? ` · ${filmed} filmed` : ''}
                  </span>
                </header>

              {items.length === 0 ? (
                <div className="planempty">
                  <p className="planempty-title">No cards yet</p>
                  <p className="hint">Add content in step 2 — they show up here as cards to go through.</p>
                </div>
              ) : (
                <ol className="planlist">
                  {cardRuns.map((run) => (
                    <Fragment key={run.key}>
                      {run.grouped && (
                        <li className="plangroup">
                          <span className="plangroup-stem">{run.stem}</span>
                          <span className="plangroup-count">{run.rows.length} versions</span>
                        </li>
                      )}
                      {run.rows.map(({ item, index }) => {
                    const state = uploadStateOf(item)
                    // Inside a group the heading already says the concept, so
                    // the row is just its version number.
                    const version = run.grouped ? versionOf(item.item_title) : null
                    return (
                      <li
                        key={item.id}
                        id={`planrow-${item.id}`}
                        className="planrow"
                        data-state={state}
                        data-compact={openCard === item.id ? undefined : true}
                        data-new={justLanded.has(item.id) || undefined}
                        data-grouped={run.grouped || undefined}
                      >
                        {openCard === item.id ? (
                          <>
                            {/* One card's whole editor, opened on demand —
                                instead of every card's form stacked open at
                                once (Geno, 2026-10-09). */}
                            <div className="planrow-detail-head">
                              <button type="button" className="cardtool cardtool-wide" onClick={() => setOpenCard(null)}>← All cards</button>
                              <span className="planrow-detail-count">Card {index + 1} of {items.length}</span>
                              <span className="planrow-tools">
                                <button
                                  type="button"
                                  className="cardtool"
                                  disabled={index === 0}
                                  onClick={() => setOpenCard(items[index - 1].id)}
                                  aria-label="Previous card"
                                >‹</button>
                                <button
                                  type="button"
                                  className="cardtool"
                                  disabled={index === items.length - 1}
                                  onClick={() => setOpenCard(items[index + 1].id)}
                                  aria-label="Next card"
                                >›</button>
                              </span>
                            </div>

                        <div className="cardhero">
                          <CoverThumb
                            jobId={item.job_id}
                            className="cardhero-thumb"
                            blankClassName="cardhero-thumb cardhero-thumb-blank"
                            blank={item.job_id ? 'No frame' : 'No cover'}
                            width={120}
                            height={150}
                          />
                          <div className="cardhero-id">
                            <div className="cardhero-tags">
                              <span className="planrow-no">
                                {item.card_no ? `V-${item.card_no}` : `Card ${index + 1}`}
                              </span>
                              <span className="planrow-kind" data-kind={cardKind(item.bucket ?? null, item.source_post ?? null)}>
                                {KIND_TEXT[cardKind(item.bucket ?? null, item.source_post ?? null)].label}
                              </span>
                              {item.style && isContentStyle(item.style) && (
                                <span className="chip planrow-style">{STYLE_LABEL[item.style]}</span>
                              )}
                              <span className="planrow-state" data-state={state}>{UPLOAD_LABEL[state]}</span>
                              {item.filmed_at && <span className="planrow-state" data-state="filmed">Filmed</span>}
                              {item.take_uploaded_at && (
                                <a
                                  className="planrow-made"
                                  href={`/api/items/${item.id}/take`}
                                  target="_blank"
                                  rel="noreferrer"
                                  title="The take she filmed on her phone, uploaded to Cloudflare"
                                >
                                  Take ↗
                                </a>
                              )}
                              {item.duration_sec ? <span className="cardhero-dur">{clock(item.duration_sec)}</span> : null}
                              {item.rating === 1 && <span className="planrow-rate" title="They rated this a good reference">👍</span>}
                              {item.rating === -1 && <span className="planrow-rate" title="They rated this a poor reference">👎</span>}
                              {item.made_at && (item.made_url
                                ? <a className="planrow-made" href={item.made_url} target="_blank" rel="noreferrer" title="They made this one already — repurpose their post">Their post ↗</a>
                                : <span className="planrow-made" title="They made this one already — find their post and repurpose it">Made already</span>)}
                              {item.bucket === 'repurpose' && (
                                item.repurposed_at
                                  ? <button type="button" className="planrow-repurpose" data-done="true" title="Undo — back to needs repurposing"
                                      onClick={() => void patchItem(item.id, { repurposed: false })}>Repurposed ✓</button>
                                  : <button type="button" className="planrow-repurpose" title="Tick once the refreshed file has gone back to them"
                                      onClick={() => void patchItem(item.id, { repurposed: true })}>Needs repurposing · mark done</button>
                              )}
                            </div>
                            <p className="cardhero-title">
                              {version !== null
                                ? `Version ${version}`
                                : item.item_title || item.author || item.title || item.job_id || 'Untitled card'}
                            </p>
                            <p className="cardhero-sub">
                              {[
                                item.author,
                                item.location,
                                item.item_title && item.title && item.title !== item.item_title ? item.title : null,
                              ].filter(Boolean).join(' · ') || (item.job_id ? 'Library cover attached' : 'Written card — add by ticking a video to keep its cover')}
                            </p>
                            {item.preview && <p className="cardhero-line">{item.preview}</p>}
                            {item.webpage_url && (
                              <a className="cardhero-link" href={item.webpage_url} target="_blank" rel="noreferrer">
                                Open reference ↗
                              </a>
                            )}
                            <CollisionFlag on={item.also_on} />
                          </div>
                        </div>

                        <div className="cardtools" role="toolbar" aria-label="Card tools">
                          <span className="cardtools-group" title="Order on the week">
                            <button type="button" className="cardtool" onClick={() => move(index, -1)} disabled={index === 0} aria-label="Move up">↑</button>
                            <button type="button" className="cardtool" onClick={() => move(index, 1)} disabled={index === items.length - 1} aria-label="Move down">↓</button>
                          </span>
                          <span className="cardtools-group">
                            <DropSelect
                              label="Move to another week"
                              placeholder="Move to week…"
                              value=""
                              onChange={(next) => void moveToWeek(item.id, next)}
                              options={moveTargets.map((week) => ({
                                value: week,
                                label: `${formatDate(week)}${knownWeeks.has(week) ? '' : ' (new)'}`,
                              }))}
                            />
                            <DropSelect
                              label="Make versions of this card"
                              placeholder="Versions…"
                              value=""
                              onChange={(next) => {
                                const total = Number(next)
                                if (total >= 2) void makeVersions(item.id, total)
                              }}
                              options={[2, 3, 4, 5, 6, 7, 8].map((total) => ({
                                value: String(total),
                                label: `${total} versions`,
                              }))}
                            />
                            <button
                              type="button"
                              className="cardtool cardtool-wide"
                              onClick={() => void duplicateItem(item.id)}
                              title="Duplicate this card — press again for each variation"
                            >⧉ Duplicate</button>
                          </span>
                          <button type="button" className="cardtool cardtool-wide cardtool-danger" onClick={() => removeItem(item.id)}>× Remove</button>
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

                        <details className="cardsec" open aria-label="On their card">
                          <summary className="cardsec-title">On their card <em>what they read</em></summary>
                        <div className="cardsec-body">
                        <div className="form-pair">
                          <div className="form-row">
                            <label className="axis-name" htmlFor={`source-${item.id}`}>
                              Source — what her card calls it
                            </label>
                            <DropSelect
                              id={`source-${item.id}`}
                              label="Source — what her card calls it"
                              value={sourceOf(item.source, item.bucket ?? null)}
                              onChange={(next) => {
                                if (isSource(next)) void patchItem(item.id, { source: next })
                              }}
                              options={CARD_SOURCES.map((source) => ({
                                value: source,
                                label: `${SOURCE_TEXT[source].console}${SOURCE_TEXT[source].chip ? ` — “${SOURCE_TEXT[source].chip}”` : ' — hidden from them'}`,
                              }))}
                            />
                          </div>
                          <div className="form-row">
                            <label className="axis-name" htmlFor={`twist-${item.id}`}>
                              The twist — what changes from the reference
                            </label>
                            <AutoField
                              id={`twist-${item.id}`}
                              className="field"
                              planId={planId}
                              field={`item:${item.id}:twist`}
                              value={item.twist}
                              placeholder="Same video — but the third pass is the members'-dinner fit"
                              onCommit={(value) => patchItem(item.id, { twist: value })}
                            />
                          </div>
                        </div>

                        {/* Phase 4. Where it gets filmed and what the card is
                            called. Location is what groups her plan, so two
                            cards typed the same way group together — the
                            drafted values keep that spelling consistent. */}
                        <div className="form-pair">
                          <div className="form-row">
                            <label className="axis-name" htmlFor={`title-${item.id}`}>
                              Title — what the card is called
                            </label>
                            <AutoField
                              id={`title-${item.id}`}
                              className="field"
                              planId={planId}
                              field={`item:${item.id}:item_title`}
                              value={item.item_title}
                              placeholder="Car GRWM"
                              onCommit={(value) => patchItem(item.id, { item_title: value })}
                            />
                          </div>
                          <div className="form-row">
                            <label className="axis-name" htmlFor={`loc-${item.id}`}>
                              Location — groups their plan
                            </label>
                            <AutoField
                              id={`loc-${item.id}`}
                              className="field"
                              list="plan-locations"
                              planId={planId}
                              field={`item:${item.id}:location`}
                              value={item.location}
                              placeholder="In the car"
                              onCommit={(value) => patchItem(item.id, { location: value })}
                            />
                          </div>
                        </div>

                        {/* The per-card switches (2026-10-08): the filming
                            directions and the automated captions, each off-able
                            before the week goes out — a written card may be all
                            direction already, and without a video there is
                            nothing honest to auto-caption. Off opens the
                            hand-written fallback. */}
                        <div className="cardsec-toggles">
                          <button
                            className="chip"
                            data-on={!item.hide_film || undefined}
                            aria-pressed={!item.hide_film}
                            title={item.hide_film
                              ? 'Her card skips Before you film / Film it / What to say — the Direction box below is what she reads'
                              : 'Her card shows the filming directions'}
                            onClick={() => void patchItem(item.id, { hide_film: !item.hide_film })}
                          >
                            Film it: {item.hide_film ? 'off' : 'on'}
                          </button>
                          <button
                            className="chip"
                            data-on={!item.hide_captions || undefined}
                            aria-pressed={!item.hide_captions}
                            title={item.hide_captions
                              ? 'The automated captions stay off this card'
                              : 'Her card shows the automated captions'}
                            onClick={() => void patchItem(item.id, { hide_captions: !item.hide_captions })}
                          >
                            Captions: {item.hide_captions ? 'off' : 'on'}
                          </button>
                          {item.hide_captions && (
                            <AutoField
                              className="field cardsec-caption"
                              aria-label="Caption"
                              planId={planId}
                              field={`item:${item.id}:caption`}
                              value={item.caption}
                              placeholder="+ Add a caption yourself — the one line her card shows"
                              onCommit={(value) => patchItem(item.id, { caption: value })}
                            />
                          )}
                        </div>

                        <div className="form-row">
                          <label className="axis-name" htmlFor={`notes-${item.id}`}>
                            Direction — drafted from the reference, edit before sending
                          </label>
                          <AutoField
                            multiline
                            id={`notes-${item.id}`}
                            className="field"
                            rows={5}
                            planId={planId}
                            field={`item:${item.id}:notes`}
                            value={item.notes}
                            onCommit={(value) => patchItem(item.id, { notes: value })}
                          />
                        </div>

                        {/* Free words for the card itself (Geno, 2026-10-13):
                            whatever the team wants them to read — typed here,
                            shown on the content plan as its own Notes block. */}
                        <div className="form-row">
                          <label className="axis-name" htmlFor={`card-notes-${item.id}`}>
                            Notes — shown on their card
                          </label>
                          <AutoField
                            multiline
                            id={`card-notes-${item.id}`}
                            className="field"
                            rows={3}
                            planId={planId}
                            field={`item:${item.id}:notes_to_model`}
                            value={item.notes_to_model}
                            placeholder="Anything they should read on this one — this one is quick, use the window light…"
                            onCommit={(value) => patchItem(item.id, { notes_to_model: value })}
                          />
                        </div>

                        {/* The format's versions as fields (Geno, 2026-10-13):
                            what changes each time — V1's outfit and caption
                            live on the card, these are the rest. Her page
                            shows the same list under the directions. */}
                        {item.versions && item.versions.length > 0 && (
                          <div className="form-row">
                            <span className="axis-name">Versions — what changes each time</span>
                            <CardVersions
                              versions={item.versions}
                              onSave={(next) => patchItem(item.id, { versions: next })}
                            />
                          </div>
                        )}
                        </div>
                        </details>

                        <details className="cardsec" aria-label="Conversation">
                          <summary className="cardsec-title">
                            Conversation
                            {item.unread > 0 && <span className="cardsec-new">{item.unread} new</span>}
                            <em>reply on their card</em>
                          </summary>
                        <div className="cardsec-body">
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

                        <div className="form-row">
                          <label className="axis-name" htmlFor={`reply-${item.id}`}>
                            Reply to them — they see this on the card
                          </label>
                          <textarea
                            id={`reply-${item.id}`}
                            className="field"
                            rows={2}
                            placeholder="Back camera, same setup as the last one…"
                            defaultValue={planId ? draftValue(planId, `reply:${item.id}`) ?? '' : ''}
                            onChange={(event) => {
                              if (planId) putDraft(planId, `reply:${item.id}`, event.target.value)
                            }}
                            onBlur={(event) => {
                              const reply = event.target.value.trim()
                              if (!reply) return
                              event.target.value = ''
                              if (planId) dropDraft(planId, `reply:${item.id}`)
                              void sendReply(item.id, reply)
                            }}
                          />
                        </div>
                        </div>
                        </details>

                        <section className="cardsec cardsec-inhouse" aria-label="In-House for the Editor [EDITING NOTES SHOWN TO THE MODEL]">
                          <h4 className="cardsec-title cardsec-title-static">
                            In-House for the Editor <em>[EDITING NOTES SHOWN TO THE MODEL]</em>
                          </h4>
                        <div className="cardsec-body">
                        <div className="form-row">
                          <label className="axis-name" htmlFor={`editing-${item.id}`}>Editing notes</label>
                          <AutoField
                            multiline
                            id={`editing-${item.id}`}
                            className="field"
                            rows={2}
                            planId={planId}
                            field={`item:${item.id}:editing_notes`}
                            value={item.editing_notes}
                            placeholder="Optional"
                            onCommit={(value) => patchItem(item.id, { editing_notes: value })}
                          />
                        </div>
                        <EditorAssign itemId={item.id} editors={editors}
                          value={item.editor_id ?? null} onChanged={reloadEditors} />
                        </div>
                        </section>

                        {(item.post_url || unbound.length > 0 || item.webpage_url) && (
                        <details className="cardsec" aria-label="Delivery">
                          <summary className="cardsec-title">Delivery <em>posted / reference</em></summary>
                        <div className="cardsec-body">
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
                            The reference on Instagram ↗
                          </a>
                        )}
                        </div>
                        </details>
                        )}
                          </>
                        ) : (
                          /* The week as a scan: one line per card — number,
                             frame, kind, who, state, a line of what it says.
                             Tapping it opens the editor above; the tools stay
                             for the three-second fixes. */
                          <div className="planrow-compact">
                            <button
                              type="button"
                              className="planrow-open"
                              onClick={() => setOpenCard(item.id)}
                              title="Open this card to edit it"
                            >
                              <span className="planrow-no">
                                {item.card_no ? `V-${item.card_no}` : index + 1}
                              </span>
                              <CoverThumb
                                jobId={item.job_id}
                                className="planrow-cover"
                                blankClassName="planrow-thumb-blank"
                                width={48}
                                height={60}
                              />
                              <span className="planrow-id">
                                <span className="planrow-who">
                                  {version !== null
                                    ? `Version ${version}`
                                    : item.item_title ?? item.author ?? item.title ?? item.job_id}
                                </span>
                                <span className="planrow-badges">
                                  <span className="planrow-kind" data-kind={cardKind(item.bucket ?? null, item.source_post ?? null)}>
                                    {KIND_TEXT[cardKind(item.bucket ?? null, item.source_post ?? null)].label}
                                  </span>
                                  {item.style && isContentStyle(item.style) && (
                                    <span className="chip planrow-style">{STYLE_LABEL[item.style]}</span>
                                  )}
                                  {/* The versions, on the row (Geno, 2026-10-13):
                                      "V1 · V2 · V3", each with its outfit and
                                      caption on hover — open the card for the
                                      fields. */}
                                  {item.versions && item.versions.length > 1 && (
                                    <span
                                      className="chip planrow-vers"
                                      title={item.versions
                                        .map((v, at) => `Version ${at + 1} — ${[v.outfit, v.caption].filter(Boolean).join(' · ')}`)
                                        .join('\n')}
                                    >
                                      {item.versions.map((_, at) => `V${at + 1}`).join(' · ')}
                                    </span>
                                  )}
                                  <span className="planrow-state" data-state={state}>{UPLOAD_LABEL[state]}</span>
                                  {item.filmed_at && <span className="planrow-state" data-state="filmed">Filmed</span>}
                                  {item.take_uploaded_at && (
                                    <a
                                      className="planrow-made"
                                      href={`/api/items/${item.id}/take`}
                                      target="_blank"
                                      rel="noreferrer"
                                      title="The take she filmed on her phone, uploaded to Cloudflare"
                                      onClick={(event) => event.stopPropagation()}
                                    >
                                      Take ↗
                                    </a>
                                  )}
                                  {item.unread > 0 && <span className="planrow-state" data-state="unread">{item.unread} new</span>}
                                  {item.duration_sec ? <span className="planrow-meta">{clock(item.duration_sec)}</span> : null}
                                </span>
                                {item.preview && <span className="planrow-line">{item.preview}</span>}
                                <CollisionFlag on={item.also_on} />
                              </span>
                            </button>
                            <span className="planrow-tools">
                              <button className="cardtool" onClick={() => move(index, -1)} disabled={index === 0} aria-label="Move up" title="Move up">↑</button>
                              <button className="cardtool" onClick={() => move(index, 1)} disabled={index === items.length - 1} aria-label="Move down" title="Move down">↓</button>
                              <button
                                className="cardtool"
                                onClick={() => void duplicateItem(item.id)}
                                aria-label="Duplicate"
                                title="Duplicate this card — press again for each variation"
                              >⧉</button>
                              <button className="cardtool cardtool-danger" onClick={() => removeItem(item.id)} aria-label="Remove" title="Remove">×</button>
                              <span className="planrow-chev" aria-hidden="true">›</span>
                            </span>
                          </div>
                        )}
                      </li>
                    )
                      })}
                    </Fragment>
                  ))}
                </ol>
              )}

              {/* A misclicked × costs nothing now: the last removed cards sit
                  here until the editor closes. The thread on a card does not
                  survive, everything else does. */}
              {undone.length > 0 && (
                <div className="planstate planstate-short planstate-action" role="status">
                  <span>
                    {undone[undone.length - 1].label} removed
                    {undone.length > 1 ? ` · ${undone.length} in the undo pile` : ''}.
                  </span>
                  <span className="planstate-actions">
                    <button type="button" className="btn btn-small" onClick={() => void undoRemove()}>Undo</button>
                    <button
                      type="button"
                      className="planstate-dismiss"
                      onClick={() => setUndone([])}
                      aria-label="Dismiss"
                      title="Dismiss"
                    >
                      ×
                    </button>
                  </span>
                </div>
              )}
              </section>

              {/* Everything worth knowing before the send button, in one list
                  instead of a callout per question scattered down the pane. */}
              <section className="planstep plancheck" data-clear={issues === 0 || undefined} aria-label="Before it goes">
                <header className="planstep-head">
                  <span className="planstep-no" aria-hidden="true">4</span>
                  <span className="planstep-id">
                    <span className="planstep-title" role="heading" aria-level={4}>Check &amp; send</span>
                    <span className="planstep-sub">What to look at before it goes out — the send bar is right below.</span>
                  </span>
                  <span className="planstep-aside plancheck-count">{issues === 0 ? 'All clear' : `${issues} to look at`}</span>
                </header>
                <ul className="plancheck-list">
                  <li className="plancheck-item" data-tone={videosReady ? 'ok' : 'warn'}>
                    {videosReady ? (
                      <span>Every video is on R2. Safe to send.</span>
                    ) : (
                      <span>
                        {fetching > 0 && `${fetching} still downloading — the video lands on its card by itself, nothing to do. `}
                        {waiting > 0 && `${waiting} still uploading — the Mac has to be awake. `}
                        {missing > 0 && `${missing} have no video on disk and will show the Instagram link only.`}
                      </span>
                    )}
                  </li>
                  {/* `weekly_target` was stored on the model, editable in her sheet,
                      and read by nothing — not the editor, not the sweep, not the
                      scoreboard. Warned, never blocked: sending a short week on
                      purpose is a normal thing to do and the operator is allowed
                      to do it without arguing with a dialog. */}
                  {short > 0 && (
                    <li className="plancheck-item" data-tone="warn">
                      <span>
                        {items.length} on this week · the target is {target}
                        {' — '}{short} short. Send it anyway if that is deliberate.
                      </span>
                    </li>
                  )}
                  {unanswered > 0 && (
                    <li className="plancheck-item" data-tone="warn">
                      <span>{unanswered} question{unanswered === 1 ? '' : 's'} from them unanswered (Messages tab).</span>
                    </li>
                  )}
                  {unassignedEdits > 0 && (
                    <li className="plancheck-item" data-tone="warn">
                      <span>{unassignedEdits} editing note{unassignedEdits === 1 ? '' : 's'} with no editor assigned.</span>
                    </li>
                  )}
                  {repeated.length > 0 && (
                    <li className="plancheck-item" data-tone="warn">
                      <span>
                        {repeated.map(([caption, n]) => `“${caption}” is on ${n} cards`).join(' · ')}
                        {' — '}each card should have its own caption before this goes out.
                      </span>
                    </li>
                  )}
                </ul>
              </section>

              <section className="planstep planmore" data-extra aria-label="Team, posts and suggestions">
              <header className="planstep-head">
                <span className="planstep-no" aria-hidden="true">+</span>
                <span className="planstep-id">
                  <span className="planstep-title" role="heading" aria-level={4}>Team, posts &amp; suggestions</span>
                  <span className="planstep-sub">Who edits, what they already posted, and more videos that fit them.</span>
                </span>
              </header>
              <div className="planfolds">
              <EditorsPanel editors={editors} reload={() => void reloadEditors()} />

              {/* Phase 5. Her own posts, folded (2026-10-09): the strip is
                  here rather than on each card so the week's delivery can be
                  seen in one look; binding happens per card, under "Link one
                  of her posts". */}
              <details className="queue-fold planfold">
                <summary>
                  <span className="queue-fold-title">Their posts</span>
                  <span className="queue-fold-count">
                    {posts.length} held · {posts.length - unbound.length} linked
                  </span>
                </summary>
                <div className="planfold-body">

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
                </div>
              </details>

              {/* Every location already on this week. Grouping is by exact
                  string, so offering what is in use is what stops "In the car"
                  and "in the car" becoming two separate trips. */}
              <datalist id="plan-locations">
                {[...new Set(items.map((item) => item.location).filter(Boolean))].map((where) => (
                  <option key={where as string} value={where as string} />
                ))}
              </datalist>

              <details className="queue-fold planfold">
                <summary>
                  <span className="queue-fold-title">Suggested for them</span>
                  <span className="queue-fold-count">
                    {suggested.length > 0 ? `${suggested.length} not on a plan yet` : 'nothing scored yet'}
                  </span>
                </summary>
                <div className="planfold-body">

              {/* Narrow the rail to the formats wanted on this week. A format
                  on their won't-do list is shown struck and cannot be picked —
                  the matcher would refuse it anyway; better said than silent. */}
              <div className="formatrail" role="group" aria-label="Formats">
                {taxonomy.format.tags.map((tag) => {
                  const refused = (plan.wont_do ?? []).includes(tag.id)
                  return (
                    <button
                      key={tag.id}
                      type="button"
                      className="formatchip"
                      disabled={refused}
                      data-on={formatFilter.includes(tag.id) || undefined}
                      data-refused={refused || undefined}
                      aria-pressed={formatFilter.includes(tag.id)}
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
              </div>
              <div className="formatrail-foot">
                <span className="hint">
                  {formatFilter.length > 0
                    ? `${formatFilter.length} format${formatFilter.length === 1 ? '' : 's'} picked`
                    : 'All formats — tap to narrow'}
                </span>
                {formatFilter.length > 0 && (
                  <button type="button" className="formatchip formatchip-clear" onClick={() => setFormatFilter([])}>Clear</button>
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
                      {item.has_thumb ? (
                        /* eslint-disable-next-line @next/next/no-img-element */
                        <img className="suggestrow-thumb" src={thumbUrl(item.id)} alt="" width={40} height={50} loading="lazy" />
                      ) : (
                        <span className="suggestrow-thumb suggestrow-thumb-blank" aria-hidden="true" />
                      )}
                      <div className="suggestrow-id">
                        <p className="suggestrow-who">
                          {playbookLabel(item.label) ?? item.author ?? item.id}
                          {item.is_hot && <span className="flame"> 🔥</span>}
                        </p>
                        <p className="suggestrow-meta">
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
                      <button type="button" className="suggestrow-add" onClick={() => addSuggested(item.id)}>
                        + Add
                      </button>
                    </li>
                  ))}
                </ul>
              )}
                </div>
              </details>
              </div>
              </section>
              </div>

              {/* The send bar, pinned (Geno, 2026-10-09): sending, copying
                  their link, unsending — always a thumb away instead of at the
                  top of a long scroll. */}
              <footer className="plansend" data-status={plan.status}>
                <div className="plansend-top">
                  <div className="plansend-status">
                    {plan.status !== 'sent' && (
                      <span className="hint">
                        A draft is invisible to them until it is sent — Telegram is its own button.
                      </span>
                    )}
                    <TelegramStatus plan={plan} onRetry={() => void send('post')} />
                  </div>
                  <div className="plansend-quiet">
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
                    <button className="btn btn-quiet plansend-danger" onClick={deletePlan}>Delete week</button>
                  </div>
                </div>
                <div className="plansend-actions">
                  <div className="plansend-main">
                    {plan.status === 'sent' ? (
                      <button className="btn" onClick={() => patchPlan({ status: 'draft' })}>Unsend</button>
                    ) : (
                      <span className="plansend-start">
                        <button
                          className="btn btn-quiet"
                          title="Mark sent — I sent it myself. The bot only records it in the day report; nothing is posted."
                          onClick={() => void send('manual')}
                        >
                          Mark as sent
                        </button>
                        <button
                          className="btn plansend-primary"
                          disabled={busy}
                          title="Make the week live for her. Nothing goes to Telegram — that is its own button."
                          onClick={() => void patchPlan({ status: 'sent' })}
                        >
                          Send the week
                        </button>
                      </span>
                    )}
                    {/* Telegram is never part of sending the week (Geno,
                        2026-10-12): it only goes to the group from this
                        button, on purpose, whoever and whenever. */}
                    <span className="plansend-go">
                      <DropSelect
                        label="Telegram wording"
                        value={variant}
                        onChange={(next) => setVariant(next as typeof variant)}
                        options={[
                          { value: 'weekly', label: 'Weekly wording' },
                          { value: 'weekend', label: 'Weekend wording' },
                          { value: 'short', label: 'Short wording' },
                        ]}
                      />
                      <button
                        className="btn"
                        disabled={busy || !plan.telegram_title || Boolean(plan.telegram_skips) || plan.telegram_state === 'queued'}
                        title={!plan.telegram_title
                          ? 'Link their Telegram group in the Week tab first'
                          : 'Post this week in their Telegram group — sends the week too if it is still a draft'}
                        onClick={() => void send('post')}
                      >
                        {plan.telegram_state === 'queued' ? 'Queued for Telegram' : 'Send on Telegram'}
                      </button>
                    </span>
                  </div>
                </div>
              </footer>
            </>
          )}
            </div>

            {/* Not a mock-up of her page — her page. See PlanPreview.
                Hidden by default; opens from the header and slides in. */}
            {planId && (
              <aside
                id="plan-what-they-see"
                className="planpane-side"
                data-open={showPreview || undefined}
                aria-label="What they see"
                aria-hidden={!showPreview}
              >
                <div className="planpane-side-inner">
                <div className="planpane-head">
                  <div className="planpane-head-id">
                    <span className="planpane-head-title">What they see</span>
                    <span className="planpane-live" data-status={plan?.status ?? 'draft'}>
                      {plan?.status === 'sent' ? 'Live on their link' : 'Draft — hidden from them'}
                    </span>
                  </div>
                  <div className="planpane-head-tools">
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
                      type="button"
                      className="chip"
                      onClick={() => setShowPreview(false)}
                    >
                      Hide
                    </button>
                  </div>
                </div>
                {(previewReady || showPreview) && (
                  <>
                    <div className="planphone-stage">
                      <PlanPreview planId={planId} revision={revision} />
                    </div>
                    <p className="planpane-note">
                      Live, and safe to touch — nothing here writes to their week.
                      {plan?.status === 'draft' && ' This week is still a draft, so their link does not show it yet.'}
                    </p>
                  </>
                )}
                </div>
              </aside>
            )}
          </div>
        </div>
      </div>

      {/* Copy the week onto another creator's week — a dialog on top of the
          pane, week options read from their own plans. */}
      {plan && copyOpen && (
        <div className="plancopy-overlay" role="dialog" aria-modal="true" aria-label="Copy this plan">
          <div className="plancopy">
            <div className="plancopy-head">
              <span className="plancopy-title">Copy this plan</span>
              <span className="hint">
                {items.length} card{items.length === 1 ? '' : 's'} from the week of {formatDate(plan.week_of)}
              </span>
              <button type="button" className="cardtool" aria-label="Close" onClick={() => setCopyOpen(false)}>×</button>
            </div>
            <div className="plancopy-body">
              <div className="form-row">
                <label className="axis-name" htmlFor="plancopy-model">Creator</label>
                <DropSelect
                  id="plancopy-model"
                  label="Creator"
                  value={copyTarget}
                  onChange={(next) => void pickCopyTarget(next)}
                  options={[
                    { value: '', label: copyModels.length > 0 ? 'Pick a creator' : 'Loading the roster…' },
                    ...copyModels.map((model) => ({ value: model.id, label: model.name })),
                  ]}
                />
              </div>
              {copyTarget && (
                <div className="form-row">
                  <label className="axis-name" htmlFor="plancopy-week">Week</label>
                  <DropSelect
                    id="plancopy-week"
                    label="Week"
                    value={copyWeek}
                    onChange={setCopyWeek}
                    options={(() => {
                      const weeks = new Set(copyWeeks)
                      weeks.add(thisWeek)
                      return [...weeks]
                        .sort((a, b) => (a < b ? 1 : a > b ? -1 : 0))
                        .map((week) => ({
                          value: week,
                          label: copyWeeks.includes(week) ? formatDate(week) : `${formatDate(week)} — new week`,
                        }))
                    })()}
                  />
                </div>
              )}
              {copyNote && <p className="hint" role="status">{copyNote}</p>}
            </div>
            <div className="plancopy-foot">
              <button type="button" className="btn btn-small btn-quiet" onClick={() => setCopyOpen(false)}>Close</button>
              <button
                type="button"
                className="btn btn-small"
                disabled={!copyTarget || !copyWeek || copyBusy || items.length === 0}
                onClick={() => void copyPlanTo()}
              >
                {copyBusy ? 'Copying…' : `Copy ${items.length} card${items.length === 1 ? '' : 's'}`}
              </button>
            </div>
          </div>
        </div>
      )}
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
