'use client'

/**
 * Add a card — the CD brief's flow (Geno, 2026-10-12).
 *
 * "+ Add card" on the step's heading asks what style it is; picking one opens
 * that style's form, with the doc's own instruction line above it. A Format
 * reel lands as ONE card carrying its versions as bullets (type a playbook
 * number and its directions, versions and editor notes come in — the versions
 * field is the point of this lane), a Talking reel is a reference or a
 * HOOK + BODY, the
 * Omegle session is one card with its games and questions, picture posts land
 * per count. The card wears its style as a tag and joins the week like any
 * other card — it shows up in "Go through the cards" with everything else.
 *
 * Every field is optional, and nothing joins the week until "+ Add to the
 * week" — the panel is a holding form. Cards carry `style` plus the fields
 * cards already had (notes, hook, wardrobe, caption, editing_notes, location),
 * so step 3, her page and the send read them like any other card.
 */
import { useEffect, useRef, useState } from 'react'
import { FORMAT_REELS, findFormatReel } from '@/lib/formats'
import { GERMAN_FORMAT_TAG, GERMAN_FORMATS, GERMAN_TYPES, findGerman, germanBrief, germanVersionRows } from '@/lib/german'
import { normalizeUrl } from '@/lib/links'
import { CONTENT_STYLES, conceptStem, type ContentStyle } from '@/lib/styles'
import { taxonomy } from '@/lib/taxonomy'
import DropSelect from '../dashboard/DropSelect'
import type { AddedCard } from './CardComposer'
import type { Pick } from './PickVideos'
import type { PlanItemRow } from './types'

/** One saved card template, as /api/templates hands it back. A German one
 *  also carries the playbook entry it is and the reference video that rides
 *  Version 1 (2026-10-16). */
type Template = {
  id: string
  label: string
  format: string | null
  body: string | null
  variant?: string | null
  job_id?: string | null
}

/** One team-made German playbook entry, as /api/formats hands its kinds back
 *  (2026-10-16): saved from the queue with its instructions and versions, so
 *  picking it here prefills the brief like the doc's own 57. */
type CustomPlaybook = {
  id: string
  format?: string | null
  label: string
  body?: string | null
  versions?: { outfit?: string; caption?: string }[] | null
}

/** One card to land — the fields the route's `custom.cards` understands. */
type CardAsk = {
  label: string
  body?: string
  hook?: string
  caption?: string
  wardrobe?: string
  editing_notes?: string
  location?: string
  job_id?: string
  /** A format card's versions as fields — shown on the row and on her card
   *  (lib/styles.ts). Only sent when the reel really has more than one. */
  versions?: { outfit: string; caption: string }[]
}

const STYLE_ICONS: Record<ContentStyle, React.ReactNode> = {
  format: <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M10 9.2l5 2.8-5 2.8z" /></svg>,
  talking: <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v7a2.5 2.5 0 0 1-2.5 2.5H9l-5 4z" /></svg>,
  omegle: <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="5" width="8" height="14" rx="2" /><rect x="13" y="5" width="8" height="14" rx="2" /></svg>,
  posts: <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="9" cy="10" r="1.6" /><path d="M4 18l5-5 4 4 3-3 4 4" /></svg>,
}

const blankDraft = {
  format: '', dir: '', notes: '',
  hook: '', body: '',
  games: '', questions: '', training: '',
  what: '', title: '', location: '', wardrobe: '', caption: '', editing: '',
  template: '', formatTag: '',
  /** A reel found on Instagram or TikTok, pasted here to ride the card. */
  link: '',
}

export default function ContentStyles({ planId, items, taken, references, onPickingChange, onClearReference, onCardsAdded, onClose }: {
  planId: string
  items: PlanItemRow[]
  /** Library jobs already on this week — a reference video that is already
   *  there must not be attached again (one card per video per week). */
  taken: Set<string>
  /** Everything ticked on the wall, in the order it was ticked. Library picks
   *  already have jobs; social-feed picks are queued from their post URLs when
   *  this style is added. */
  references: Pick[]
  /** The wall is pickable while the panel is open. */
  onPickingChange: (on: boolean) => void
  /** Untick everything on the wall — "Remove" on the selected videos. */
  onClearReference: () => void
  onCardsAdded: (fresh: AddedCard[]) => void
  onClose: () => void
}) {
  const [style, setStyle] = useState<ContentStyle | null>(null)
  /** The tiles fold away once a style is picked — "Change style" brings them
   *  back, so the form does not carry four cards it no longer needs. */
  const [changingStyle, setChangingStyle] = useState(false)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [templates, setTemplates] = useState<Template[]>([])
  const [draft, setDraft] = useState(blankDraft)
  /** One version by default (Geno, 2026-10-12): a blank reel starts as V1,
   *  and more rows are added only when the reel really has them. */
  const [versions, setVersions] = useState<{ outfit: string; caption: string }[]>([
    { outfit: '', caption: '' },
  ])
  const [posts, setPosts] = useState(3)
  /** Which German playbook entry was picked — its own select beside the
   *  Playbook field, so all 57 formats are visible instead of a datalist.
   *  `germanNo` is the doc's own number only; `germanPick` is the select's
   *  value, which may also be `k:<id>` for a team-made entry (2026-10-16). */
  const [germanNo, setGermanNo] = useState('')
  const [germanPick, setGermanPick] = useState('')
  /** The team's own German playbook entries, saved in the queue with their
   *  instructions and version rows. */
  const [customPlaybook, setCustomPlaybook] = useState<CustomPlaybook[]>([])
  /** The doc's own reference video for the picked German format, found in the
   *  library by its label. It rides Version 1, so picking a format brings its
   *  video with it (Geno, 2026-10-13). */
  const [germanRef, setGermanRef] = useState<{ jobId: string; label: string } | null>(null)
  /** Mid-lookup, so the hint can say "finding" rather than "none". */
  const [germanLooking, setGermanLooking] = useState(false)
  /** The German lane's "save as a template" (Geno, 2026-10-16): a name, and
   *  the save that carries the playbook entry and its reference video. */
  const [keepName, setKeepName] = useState('')
  const [keepBusy, setKeepBusy] = useState(false)
  const [keepNote, setKeepNote] = useState<string | null>(null)
  /** The latest German pick, so a slow lookup for #4 can never overwrite the
   *  answer for #41. */
  const germanWanted = useRef('')
  /** What the last add's route refusal said in words, if anything — read by
   *  the failure line so "already on this week" is never replaced by the
   *  generic "did not land". */
  const lastError = useRef<string | null>(null)

  const set = (patch: Partial<typeof blankDraft>) => setDraft((current) => ({ ...current, ...patch }))

  // Open, the library wall is pickable so a reel can wear its reference.
  useEffect(() => {
    onPickingChange(true)
    return () => onPickingChange(false)
  }, [onPickingChange])

  // The saved card templates, for the Template select.
  useEffect(() => {
    fetch('/api/templates')
      .then((response) => (response.ok ? response.json() : { templates: [] }))
      .then((data) => setTemplates(data.templates ?? []))
      .catch(() => setTemplates([]))
  }, [])

  // The team's own German playbook entries, for the playbook select — saved
  // in the queue, they prefill like the doc's own (2026-10-16).
  useEffect(() => {
    fetch('/api/formats')
      .then((response) => (response.ok ? response.json() : { kinds: [] }))
      .then((data) => setCustomPlaybook(
        (Array.isArray(data.kinds) ? data.kinds : [])
          .filter((row: { format?: unknown }) => row?.format === GERMAN_FORMAT_TAG),
      ))
      .catch(() => setCustomPlaybook([]))
  }, [])

  /** Land cards through the existing custom-card door — one round-trip. */
  async function postCards(
    wanted: ContentStyle,
    cards: CardAsk[],
    feedPreviewByJob: Map<string, string>,
  ): Promise<number | null> {
    const response = await fetch(`/api/plans/${planId}/items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ custom: { style: wanted, format: draft.formatTag || undefined, cards } }),
    }).catch(() => null)
    const body = await response?.json().catch(() => ({})) ?? {}
    if (!response?.ok || !Array.isArray(body.items)) {
      // The route says why in words when it refuses ("that video is already
      // on this week") — carried out so the panel shows that instead of the
      // generic line.
      lastError.current = typeof body.error === 'string' && body.error ? body.error : null
      return null
    }
    lastError.current = null
    onCardsAdded((body.items as AddedCard[]).map((item) => ({
      ...item,
      cover_preview_url: item.job_id ? feedPreviewByJob.get(item.job_id) ?? null : null,
    })))
    return Number(body.added ?? body.items.length)
  }

  /** A template prefills the card's words: its label, its format tag, and its
   *  body — into the style's own text field (directions for a format reel,
   *  the body for a talking reel). A German template is more (Geno,
   *  2026-10-16): it restores the playbook entry — versions, caption and
   *  directions with it — and the reference video it was saved with rides
   *  Version 1. Every field stays editable. */
  function applyTemplate(id: string) {
    if (!id) { set({ template: '' }); return }
    const template = templates.find((entry) => entry.id === id)
    if (!template) return
    const german = template.variant ? findGerman(template.variant) : undefined
    if (german) {
      applyGerman(german)
      // The template's own video wins over the label lookup applyGerman just
      // started: cancel it, so the two can never fight over Version 1.
      germanWanted.current = ''
      setGermanRef(template.job_id ? { jobId: template.job_id, label: template.label } : null)
      setGermanLooking(false)
      setKeepName(template.label)
      setKeepNote(null)
      set({
        template: id,
        title: template.label,
        formatTag: GERMAN_FORMAT_TAG,
        ...(template.body ? { dir: template.body } : {}),
      })
      return
    }
    germanWanted.current = ''
    setGermanPick('')
    setGermanNo('')
    setGermanRef(null)
    setGermanLooking(false)
    set({
      template: id,
      title: template.label,
      formatTag: template.format || draft.formatTag,
      ...(style === 'format' ? { dir: template.body ?? '' } : { body: template.body ?? '' }),
    })
  }

  /** Typing a number (or name) that is in the playbook is the "template": its
   *  directions, versions and editor notes come in, and every field stays
   *  yours to edit. The German doc's 57 entries ride the same box when picked
   *  from its datalist (Geno, 2026-10-13) — but only on the full label, so
   *  typing "41" never flashes #4 on the way. */
  function onFormatInput(raw: string) {
    set({ format: raw })
    const reel = findFormatReel(raw)
    if (reel) {
      germanWanted.current = ''
      setGermanPick('')
      setGermanNo('')
      setGermanRef(null)
      setGermanLooking(false)
      set({ dir: reel.dir, notes: reel.editorNotes || '' })
      setVersions(reel.versions.slice(0, 8).map((v) => ({ outfit: v.outfit || '', caption: v.caption || '' })))
      return
    }
    const needle = raw.trim().toLowerCase()
    const german = GERMAN_FORMATS.find((entry) =>
      `german #${entry.no} · ${entry.name}`.toLowerCase() === needle
      || `#${entry.no} · ${entry.name}`.toLowerCase() === needle)
    if (german) applyGerman(german)
  }

  /** A picked German format is the whole brief (2026-10-13): the doc's own
   *  instructions land in Instructions, its versions become the version rows,
   *  and its caption rides as the shared one. Editor notes and anything
   *  already typed stay where they are — the doc has no editor notes. */
  function applyGerman(format: (typeof GERMAN_FORMATS)[number]) {
    const label = `German #${format.no} · ${format.name}`
    setGermanNo(format.no)
    setGermanPick(format.no)
    // The keep-as-template name starts as the playbook's own label; edited
    // before saving, never after (2026-10-16).
    setKeepName(label)
    setKeepNote(null)
    set({
      format: label,
      template: '',
      formatTag: draft.formatTag || GERMAN_FORMAT_TAG,
      title: draft.title.trim() ? draft.title : label,
      dir: format.direction,
      caption: draft.caption.trim()
        ? draft.caption
        : format.caption === 'No captions' ? '' : format.caption,
    })
    setVersions(germanVersionRows(format.versions))

    // The doc's own reference video, found by its label — the reels were
    // ingested from the doc's Drive links, so the library already holds one
    // per format. It rides Version 1 (Geno, 2026-10-13). A lookup that lands
    // after the pick moved on is dropped.
    germanWanted.current = format.no
    setGermanRef(null)
    setGermanLooking(true)
    void findGermanRef(format.no).then((ref) => {
      if (germanWanted.current !== format.no) return
      setGermanRef(ref)
      setGermanLooking(false)
    })
  }

  /** A team-made playbook entry prefills like the doc's own (Geno,
   *  2026-10-16): the queue asked for its instructions and version rows when
   *  it was saved, and both come back here. No reference-video lookup — the
   *  entry has no doc number to match by; a link can still ride the card. */
  function applyCustomPlaybook(entry: CustomPlaybook) {
    const label = entry.label
    germanWanted.current = ''
    setGermanPick(`k:${entry.id}`)
    setGermanNo('')
    setGermanRef(null)
    setGermanLooking(false)
    setKeepName(label)
    setKeepNote(null)
    set({
      format: label,
      template: '',
      formatTag: draft.formatTag || GERMAN_FORMAT_TAG,
      title: draft.title.trim() ? draft.title : label,
      dir: entry.body ?? '',
    })
    const rows = (entry.versions ?? [])
      .map((row) => ({ outfit: row.outfit ?? '', caption: row.caption ?? '' }))
      .filter((row) => row.outfit || row.caption)
    setVersions(rows.length > 0 ? rows : [{ outfit: '', caption: '' }])
  }

  /** The doc's reference video for one German number, found in the library by
   *  its label. The query carries the "·" so it matches one label exactly —
   *  "German #5" alone also matches #50–#59, and with five results the real
   *  #5 was pushed off the page (found 2026-10-13). Null when nothing matches
   *  or the read fails — a card without its video still beats no card at all. */
  async function findGermanRef(no: string): Promise<{ jobId: string; label: string } | null> {
    try {
      const response = await fetch(`/api/library?q=${encodeURIComponent(`German #${no} ·`)}&limit=5`)
      if (!response.ok) return null
      const body = await response.json()
      const wanted = `German #${no} ·`
      const hit = (Array.isArray(body.items) ? body.items : [])
        .find((item: { label?: unknown }) =>
          typeof item.label === 'string' && item.label.startsWith(wanted))
      return hit ? { jobId: String(hit.id), label: String(hit.label) } : null
    } catch {
      return null
    }
  }

  /** Save the German setup as a reusable template (Geno, 2026-10-16): the
   *  playbook entry it is, the directions on screen, and the reference video
   *  riding Version 1 — so picking it later brings all three. Only rendered
   *  for a picked German format in the Format reel lane. */
  async function keepGermanTemplate() {
    const german = germanNo ? findGerman(germanNo) : undefined
    const label = keepName.trim()
    if (!german || !label || keepBusy) return
    setKeepBusy(true)
    setKeepNote(null)
    // Resolve the video now when the pick's lookup has not landed yet — the
    // template must genuinely carry it.
    const held = germanRef ?? await findGermanRef(german.no)
    const response = await fetch('/api/templates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        label,
        format: GERMAN_FORMAT_TAG,
        body: draft.dir || germanBrief(german),
        variant: german.no,
        job_id: held?.jobId,
      }),
    }).catch(() => null)
    const answer = await response?.json().catch(() => ({})) ?? {}
    setKeepBusy(false)
    if (!response?.ok || !answer.template) {
      setKeepNote(answer.error ?? 'Could not save the template — try again.')
      return
    }
    const saved = answer.template as Template
    // Shown in this picker the moment it exists, before any reload.
    setTemplates((current) => current.some((entry) => entry.id === saved.id)
      ? current.map((entry) => (entry.id === saved.id ? saved : entry))
      : [...current, saved].sort((a, b) => a.label.localeCompare(b.label)))
    set({ template: saved.id })
    setKeepNote(held
      ? `Saved — ${held.label} rides Version 1 when this template is picked.`
      : 'Saved — no reference video found for it yet; it attaches when one lands.')
  }

  async function add() {
    if (busy || !style) return
    setBusy(true)
    setNote(null)

    // Every ticked video lands (Geno, 2026-10-12). Library picks already have
    // jobs; feed picks become jobs from their post URLs in the same queue call
    // as a pasted link, so either kind can ride the styled card.
    const libraryRefs = references.filter((entry): entry is Extract<Pick, { kind: 'library' }> =>
      entry.kind === 'library' && !taken.has(entry.jobId))
    let landed: number | null = null

    // A video selected from Instagram/TikTok/X is queued from its post URL.
    // Keep selected feed links first: the video the user just ticked rides the
    // style card; extra links still land as their own cards below.
    const linkEntries: { url: string; jobId: string }[] = []
    const queuedLinks = [
      ...references.filter((entry): entry is Extract<Pick, { kind: 'feed' }> => entry.kind === 'feed')
        .map((entry) => entry.url),
      draft.link.trim(),
    ].filter(Boolean)
    if (queuedLinks.length > 0) {
      const response = await fetch('/api/links', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: queuedLinks.join('\n'),
          format: draft.formatTag || (germanNo ? GERMAN_FORMAT_TAG : undefined),
          variant: germanNo || undefined,
          name: draft.title || draft.format || undefined,
        }),
      }).catch(() => null)
      const body = await response?.json().catch(() => ({})) ?? {}
      if (!response?.ok) {
        setBusy(false)
        setNote(body.error ?? 'That video did not go in — nothing was added.')
        return
      }
      for (const entry of Array.isArray(body.links) ? body.links : []) {
        if (typeof entry?.job_id === 'string' && typeof entry?.url === 'string') {
          // Always sent, held or not — the route frees a reel the machine is
          // sitting on and answers with a reason when a written card owns it.
          linkEntries.push({ url: entry.url, jobId: entry.job_id })
        }
      }
    }
    const previewByUrl = new Map(
      references
        .filter((entry): entry is Extract<Pick, { kind: 'feed' }> => entry.kind === 'feed' && Boolean(entry.video))
        .map((entry) => [normalizeUrl(entry.url), entry.video as string]),
    )
    const feedPreviewByJob = new Map<string, string>()
    for (const entry of linkEntries) {
      const preview = previewByUrl.get(normalizeUrl(entry.url))
      if (preview) feedPreviewByJob.set(entry.jobId, preview)
    }
    /** The first queued link rides the card; additional ones become their own cards. */
    const refs = [
      ...linkEntries.map((entry) => ({ jobId: entry.jobId })),
      ...libraryRefs.map((entry) => ({ jobId: entry.jobId })),
    ].filter((entry, index, list) => list.findIndex((candidate) => candidate.jobId === entry.jobId) === index)
    const linkAt = (at: number) => linkEntries[at]?.jobId
    // The picked German format's own reference video rides Version 1 — never
    // if the week already carries it, because the route drops a whole card
    // rather than land a second copy of one reel (Geno, 2026-10-13). Resolved
    // here as well as on pick, so pressing Add before the pick's lookup
    // landed cannot lose the video.
    let germanJob: string | null = null
    if (germanNo) {
      const held = germanRef ?? await findGermanRef(germanNo)
      germanJob = held && !taken.has(held.jobId) ? held.jobId : null
    }
    let consumedLinks = 0

    if (style === 'format') {
      const reel = draft.format.trim() ? findFormatReel(draft.format) : null
      const label = reel ? `${reel.no} · ${reel.name}` : (draft.title || draft.format || 'Format reel')
      if (items.some((item) => conceptStem(item.item_title) === label)) {
        setBusy(false)
        setNote(`${label} is already on the week — duplicate it from step 3 for a variation.`)
        return
      }
      const dir = draft.dir || reel?.dir || ''
      const notes = draft.notes || reel?.editorNotes || ''
      const rows = versions.filter((v) => v.outfit.trim() || v.caption.trim())
      const kept = rows.length ? rows : [{ outfit: draft.wardrobe, caption: draft.caption }]
      // One card, not one per version (Geno, 2026-10-13), and the versions
      // are FIELDS on it — shown as chips on the row, editable in the card,
      // rendered on her page — not prose buried in the directions. The first
      // version's outfit and caption stay the card's own fields.
      const keptVersions = kept.length > 1
        ? kept.map((row) => ({ outfit: row.outfit?.trim() ?? '', caption: row.caption?.trim() ?? '' }))
        : undefined
      // The video rides the one card: the pasted link first — sent even when
      // the reel is on the week already, so the route can free the machine's
      // own card for it — then the German playbook's own reference, then a
      // ticked wall video. A reel a written card owns refuses the add.
      const jobId = linkAt(0)
        ?? [germanJob, refs[0]?.jobId]
          .find((id): id is string => typeof id === 'string' && !taken.has(id))
      consumedLinks = Math.min(linkEntries.length, 1)
      landed = await postCards('format', [{
        label,
        body: dir || undefined,
        wardrobe: kept[0]?.outfit?.trim() || draft.wardrobe || undefined,
        caption: kept[0]?.caption?.trim() || draft.caption || undefined,
        editing_notes: notes || draft.editing || undefined,
        location: draft.location || undefined,
        job_id: jobId,
        versions: keptVersions,
      }], feedPreviewByJob)
    } else if (style === 'talking') {
      const fields = {
        label: draft.title || 'Talking reel',
        hook: draft.hook || undefined, body: draft.body || undefined,
        wardrobe: draft.wardrobe || undefined, caption: draft.caption || undefined,
        location: draft.location || undefined, editing_notes: draft.editing || undefined,
      }
      const jobs = [...new Set([...linkEntries.map((entry) => entry.jobId), ...refs.map((entry) => entry.jobId)])]
      consumedLinks = Math.min(linkEntries.length, jobs.length)
      landed = await postCards('talking', jobs.length
        ? jobs.map((jobId) => ({ ...fields, job_id: jobId }))
        : [fields], feedPreviewByJob)
    } else if (style === 'omegle') {
      if (items.some((item) => item.style === 'omegle')) {
        setBusy(false)
        setNote('The session is already on the week — duplicate it from step 3 if you need another.')
        return
      }
      const body = ['GAMES TO PLAY', draft.games || '—', '', 'QUESTIONS TO ASK', draft.questions].join('\n')
      consumedLinks = Math.min(linkEntries.length, 1)
      landed = await postCards('omegle', [{
        label: draft.title || 'Omegle session',
        body,
        editing_notes: [draft.training, draft.editing].filter(Boolean).join('\n') || undefined,
        location: draft.location || undefined,
        job_id: linkAt(0) ?? refs[0]?.jobId,
      }], feedPreviewByJob)
    } else {
      const what = draft.what || draft.title
      const jobs = [...new Set([...linkEntries.map((entry) => entry.jobId), ...refs.map((entry) => entry.jobId)])]
      const count = jobs.length || Math.max(1, Math.min(10, posts))
      consumedLinks = Math.min(linkEntries.length, jobs.length)
      landed = await postCards('posts', Array.from({ length: count }, (_, at) => ({
        label: what ? `Wall post · ${what}${count > 1 ? ` #${at + 1}` : ''}` : 'Wall post',
        body: 'From shoot-day photos — 3–6 slides, best one first.',
        location: draft.location || undefined, editing_notes: draft.editing || undefined,
        job_id: jobs[at],
      })), feedPreviewByJob)
    }

    // The links the cards had no room on. Queued already; landing them here
    // makes them thin cards of their own, exactly like a paste in the queue.
    const leftoverLinks = linkEntries.slice(landed === null ? 0 : consumedLinks)
    if (leftoverLinks.length > 0) {
      await fetch('/api/links', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: leftoverLinks.map((entry) => entry.url).join('\n'), plan_id: planId }),
      }).catch(() => null)
    }

    setBusy(false)
    if (landed === null) {
      setNote(lastError.current ?? (linkEntries.length > 0
        ? 'The cards did not land — the selected or pasted video went onto the week by itself.'
        : 'That did not land — check the connection and try again.'))
      return
    }
    onClose()
  }

  return (
    <div className="plancomposer" role="group" aria-label="Add a card">
      {(!style || changingStyle) && (
        <div className="plancomposer-styles">
          {CONTENT_STYLES.map((entry) => (
            <button
              type="button"
              className="stylecard"
              data-on={style === entry.id || undefined}
              key={entry.id}
              onClick={() => { setStyle(entry.id); setChangingStyle(false); setNote(null) }}
            >
              <span className="stylecard-ico">{STYLE_ICONS[entry.id]}</span>
              <span className="stylecard-name">{entry.label}</span>
              <span className="stylecard-line">{entry.line}</span>
            </button>
          ))}
        </div>
      )}

      {style && !changingStyle && (
        <div className="plancomposer-chosen">
          <span className="plancomposer-chosen-ico">{STYLE_ICONS[style]}</span>
          <span className="plancomposer-chosen-name">
            {CONTENT_STYLES.find((entry) => entry.id === style)?.label}
          </span>
          <button
            type="button"
            className="btn btn-small btn-quiet plancomposer-change"
            onClick={() => setChangingStyle(true)}
          >Change style</button>
        </div>
      )}

      {style && !changingStyle && (
        <div className="plancomposer-body">
          {references.length > 0 && (
            <div className="plancomposer-picked">
              <span className="axis-name">
                {references.length === 1 ? 'Selected video' : `${references.length} selected videos`}
              </span>
              <div className="plancomposer-picked-row">
                <span className="plancomposer-picked-thumbs">
                  {references.slice(0, 8).map((entry, at) => {
                    const key = `${entry.kind}:${entry.kind === 'library' ? entry.jobId : entry.url}:${at}`
                    if (entry.kind === 'feed' && entry.video) {
                      /* The feed video itself is the only faithful preview
                         before the queue has made its poster frame. */
                      return <video
                        className="plancomposer-picked-thumb"
                        key={key}
                        src={entry.video.includes('#') ? entry.video : `${entry.video}#t=0.001`}
                        muted
                        autoPlay
                        playsInline
                        preload="metadata"
                        onLoadedData={(event) => event.currentTarget.pause()}
                        aria-label="Selected video preview"
                      />
                    }
                    if (entry.thumb) {
                      /* eslint-disable-next-line @next/next/no-img-element */
                      return <img className="plancomposer-picked-thumb" key={key} src={entry.thumb} alt="" width={44} height={55} />
                    }
                    return <span className="plancomposer-picked-thumb plancomposer-picked-blank" key={key} />
                  })}
                </span>
                <span className="plancomposer-picked-name">
                  {references.map((entry) => entry.name ?? (entry.kind === 'feed' ? 'Social video' : 'Library video')).join(' · ')}
                </span>
                <button type="button" className="btn btn-small btn-quiet" onClick={onClearReference}>Remove</button>
              </div>
            </div>
          )}

          <div className="cform-row">
            <div className="f pf-2">
              <span className="axis-name">Template</span>
              <DropSelect
                label="Start from a template"
                value={draft.template}
                onChange={applyTemplate}
                options={[
                  { value: '', label: 'No template' },
                  // A German template belongs to the Format reel lane — it is
                  // the playbook entry, its versions and its video
                  // (2026-10-16); every other lane sees the general blanks only.
                  ...templates
                    .filter((template) => style === 'format' || !template.variant)
                    .map((template) => ({ value: template.id, label: template.label })),
                ]}
              />
            </div>
            <div className="f pf-2">
              <span className="axis-name">Format</span>
              <DropSelect
                label="Format"
                value={draft.formatTag}
                onChange={(next) => set({ formatTag: next })}
                options={[
                  { value: '', label: 'Any format' },
                  ...taxonomy.format.tags.map((tag) => ({ value: tag.id, label: tag.label })),
                ]}
              />
            </div>
            <div className="f pf-4">
              <label className="axis-name" htmlFor="plan-cf-link">
                Reference video — from Instagram, TikTok or X
              </label>
              <input
                id="plan-cf-link"
                className="field"
                type="url"
                value={draft.link}
                placeholder="Paste a video link — it queues and rides the first card onto the week"
                onChange={(event) => set({ link: event.target.value })}
                onKeyDown={(event) => { if (event.key === 'Enter') event.preventDefault() }}
              />
            </div>
          </div>

          {style === 'format' && (
            <div className="cform">
              <div className="cform-row">
                <div className="f pf-2">
                  <label className="axis-name" htmlFor="plan-cf-german">
                    German playbook — all 57, prefills the brief
                  </label>
                  <select
                    id="plan-cf-german"
                    className="field"
                    value={germanPick}
                    onChange={(event) => {
                      const chosen = event.target.value
                      if (!chosen) {
                        germanWanted.current = ''
                        setGermanPick('')
                        setGermanNo('')
                        setGermanRef(null)
                        setGermanLooking(false)
                        setKeepName('')
                        setKeepNote(null)
                        return
                      }
                      if (chosen.startsWith('k:')) {
                        const entry = customPlaybook.find((row) => `k:${row.id}` === chosen)
                        if (entry) applyCustomPlaybook(entry)
                        return
                      }
                      const pickedGerman = findGerman(chosen)
                      if (pickedGerman) applyGerman(pickedGerman)
                    }}
                  >
                    <option value="">Pick a German format…</option>
                    {GERMAN_TYPES.map((type) => (
                      <optgroup key={type.id} label={type.label}>
                        {type.formats.map((entry) => (
                          <option key={entry.no} value={entry.no}>#{entry.no} · {entry.name}</option>
                        ))}
                      </optgroup>
                    ))}
                    {/* The team's own entries, added in the queue — they
                        prefill instructions and versions like the doc's own
                        (2026-10-16). */}
                    {customPlaybook.length > 0 && (
                      <optgroup label="Our playbook">
                        {customPlaybook.map((entry) => (
                          <option key={entry.id} value={`k:${entry.id}`}>{entry.label}</option>
                        ))}
                      </optgroup>
                    )}
                  </select>
                  {/* The doc's own reference video attaches itself (Geno,
                      2026-10-13) — said here, so nobody has to wonder whether
                      it did or go tick it off the wall by hand. */}
                  {germanNo && (
                    <span className="hint">
                      {germanRef
                        ? taken.has(germanRef.jobId)
                          ? `Its reference video is already on this week (${germanRef.label}).`
                          : `Its reference video rides Version 1 — ${germanRef.label}.`
                        : germanLooking
                          ? 'Finding its reference video…'
                          : 'No reference video for this one yet — paste one into the Queue and it attaches from then on.'}
                    </span>
                  )}
                </div>
                <div className="f pf-2">
                  <label className="axis-name" htmlFor="plan-cf-format">Playbook</label>
                  <input
                    id="plan-cf-format"
                    className="field"
                    list="plan-format-options"
                    autoComplete="off"
                    value={draft.format}
                    placeholder="Number or name"
                    onChange={(event) => onFormatInput(event.target.value)}
                  />
                  <datalist id="plan-format-options">
                    {FORMAT_REELS.map((reel) => <option key={reel.no} value={`${reel.no} · ${reel.name}`} />)}
                    {GERMAN_FORMATS.map((entry) => <option key={`g${entry.no}`} value={`German #${entry.no} · ${entry.name}`} />)}
                  </datalist>
                </div>
              </div>
              {/* Only a picked German format offers this (Geno, 2026-10-16):
                  the entry, its versions and its reference video become a
                  template any later week can pick again. */}
              {germanNo && (
                <div className="f pf-4 plancomposer-keep">
                  <span className="axis-name">Save as a template — the playbook entry and its reference video ride it</span>
                  <div className="plancomposer-keep-row">
                    <input
                      className="field"
                      value={keepName}
                      maxLength={120}
                      aria-label="Template name"
                      placeholder="Name this template"
                      onChange={(event) => { setKeepName(event.target.value); setKeepNote(null) }}
                    />
                    <button
                      type="button"
                      className="btn btn-small"
                      disabled={keepBusy || !keepName.trim()}
                      onClick={() => void keepGermanTemplate()}
                    >{keepBusy ? 'Saving…' : 'Save template'}</button>
                  </div>
                  {keepNote && <span className="hint" role="status">{keepNote}</span>}
                </div>
              )}
              <div className="f pf-4">
                <span className="axis-name">Versions — what changes each time</span>
                <div className="cform-vers">
                  {versions.map((row, at) => (
                    <div className="cf-ver" key={at}>
                      <span className="cf-ver-no">V{at + 1}</span>
                      <input
                        className="field"
                        value={row.outfit}
                        placeholder="Outfit"
                        aria-label={`Version ${at + 1} outfit`}
                        onChange={(event) => setVersions((list) => list.map((v, i) => (i === at ? { ...v, outfit: event.target.value } : v)))}
                      />
                      <input
                        className="field"
                        value={row.caption}
                        placeholder="Caption"
                        aria-label={`Version ${at + 1} caption`}
                        onChange={(event) => setVersions((list) => list.map((v, i) => (i === at ? { ...v, caption: event.target.value } : v)))}
                      />
                      <button
                        type="button"
                        className="cardtool"
                        disabled={versions.length <= 1}
                        aria-label={`Remove version ${at + 1}`}
                        onClick={() => setVersions((list) => list.filter((_, i) => i !== at))}
                      >×</button>
                    </div>
                  ))}
                  {versions.length < 8 && (
                    <button
                      type="button"
                      className="btn btn-small btn-quiet cf-vers-add"
                      onClick={() => setVersions((list) => [...list, { outfit: '', caption: '' }])}
                    >+ Add version</button>
                  )}
                </div>
              </div>
              <div className="cform-row">
                <div className="f pf-2">
                  <label className="axis-name" htmlFor="plan-cf-dir">Instructions — what she films</label>
                  <textarea
                    id="plan-cf-dir"
                    className="field"
                    rows={3}
                    value={draft.dir}
                    onChange={(event) => set({ dir: event.target.value })}
                  />
                </div>
                <div className="f pf-2">
                  <label className="axis-name" htmlFor="plan-cf-notes">Editor notes</label>
                  <textarea
                    id="plan-cf-notes"
                    className="field"
                    rows={3}
                    value={draft.notes}
                    onChange={(event) => set({ notes: event.target.value })}
                  />
                </div>
              </div>
            </div>
          )}

          {style === 'talking' && (
            <div className="cform">
              <div className="cform-row">
                <div className="f pf-2">
                  <label className="axis-name" htmlFor="plan-cf-hook">Hook — the opening line</label>
                  <input id="plan-cf-hook" className="field" value={draft.hook} onChange={(event) => set({ hook: event.target.value })} />
                </div>
                <div className="f pf-2">
                  <label className="axis-name" htmlFor="plan-cf-body">Body — the point</label>
                  <textarea id="plan-cf-body" className="field" rows={2} value={draft.body} onChange={(event) => set({ body: event.target.value })} />
                </div>
              </div>
            </div>
          )}

          {style === 'omegle' && (
            <div className="cform">
              <div className="cform-row">
                <div className="f pf-2">
                  <label className="axis-name" htmlFor="plan-cf-games">Games to play</label>
                  <textarea id="plan-cf-games" className="field" rows={3} value={draft.games} onChange={(event) => set({ games: event.target.value })} />
                </div>
                <div className="f pf-2">
                  <label className="axis-name" htmlFor="plan-cf-training">Training — the note on the card</label>
                  <input id="plan-cf-training" className="field" value={draft.training} onChange={(event) => set({ training: event.target.value })} />
                </div>
              </div>
              <div className="f pf-4">
                <label className="axis-name" htmlFor="plan-cf-questions">Questions to ask</label>
                <textarea id="plan-cf-questions" className="field" rows={6} value={draft.questions} onChange={(event) => set({ questions: event.target.value })} />
              </div>
            </div>
          )}

          {style === 'posts' && (
            <div className="cform">
              <div className="cform-row">
                <div className="f pf-3">
                  <label className="axis-name" htmlFor="plan-cf-what">What the set is</label>
                  <input id="plan-cf-what" className="field" value={draft.what} onChange={(event) => set({ what: event.target.value })} />
                </div>
                <div className="f">
                  <span className="axis-name">How many</span>
                  <div className="volstep">
                    <button type="button" className="volstep-btn" aria-label="One fewer" disabled={posts <= 1} onClick={() => setPosts((n) => Math.max(1, n - 1))}>−</button>
                    <span className="vers-count">{posts}</span>
                    <button type="button" className="volstep-btn" aria-label="One more" disabled={posts >= 10} onClick={() => setPosts((n) => Math.min(10, n + 1))}>+</button>
                  </div>
                </div>
              </div>
            </div>
          )}

          <div className="cform-split" aria-hidden="true" />

          <div className="cform-grid2">
            <div className="f">
              <label className="axis-name" htmlFor="plan-cf-title">Title — what the card is called</label>
              <input id="plan-cf-title" className="field" value={draft.title} onChange={(event) => set({ title: event.target.value })} />
            </div>
            <div className="f">
              <label className="axis-name" htmlFor="plan-cf-location">Location — groups her plan</label>
              <input id="plan-cf-location" className="field" value={draft.location} onChange={(event) => set({ location: event.target.value })} />
            </div>
            <div className="f">
              <label className="axis-name" htmlFor="plan-cf-wardrobe">Wardrobe / outfit</label>
              <input id="plan-cf-wardrobe" className="field" value={draft.wardrobe} onChange={(event) => set({ wardrobe: event.target.value })} placeholder="Baggie tee, denim shorts" />
            </div>
            <div className="f">
              <label className="axis-name" htmlFor="plan-cf-caption">Caption</label>
              <input id="plan-cf-caption" className="field" value={draft.caption} onChange={(event) => set({ caption: event.target.value })} placeholder="Optional" />
            </div>
            <div className="f pf-2">
              <label className="axis-name" htmlFor="plan-cf-editing">Editing notes — in-house, she never sees this</label>
              <input id="plan-cf-editing" className="field" value={draft.editing} onChange={(event) => set({ editing: event.target.value })} placeholder="Optional" />
            </div>
          </div>

          {note && <p className="hint" role="status">{note}</p>}

          <div className="plancomposer-foot">
            <button type="button" className="btn btn-small btn-quiet" onClick={onClose}>Cancel</button>
            <button type="button" className="btn" disabled={busy} onClick={() => void add()}>
              {busy ? 'Adding…' : '+ Add to the week'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
