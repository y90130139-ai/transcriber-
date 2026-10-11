'use client'

import { useCallback, useEffect, useMemo, useState, type Dispatch, type DragEvent, type SetStateAction } from 'react'
import LibraryCard from '@/components/LibraryCard'
import { MediaCard, type Feed, type MediaItem } from '@/components/platform/MediaFeed'
import PlatformIcon from '@/components/roster/PlatformIcon'
import DropMulti, { type MultiSection } from '@/components/dashboard/DropMulti'
import { EMPTY_FILTERS, SORTS, WINDOWS, toQuery, type Filters } from '../FilterBar'
import { thumbUrl, type LibraryItem } from '@/lib/format'
import type { Platform } from '@/lib/socials'
import { AXES, taxonomy } from '@/lib/taxonomy'

/**
 * The plan dialog's left pane: pick the videos the week is made of.
 *
 * A row of sources — the Library, and the three OFMPro feeds (Instagram,
 * TikTok, X) that the platform pages already draw — over a scrolling wall of
 * selectable cards. Ticking is a plain tap; "Select shown" takes a whole
 * screen; the footer sends everything picked onto the open week in one move.
 *
 * What happens on Add is the point of the whole screen: a library pick arrives
 * with its brief already drafted (appendItems — direction, fields, location,
 * title), and a feed pick lands as a thin card whose brief drafts itself the
 * moment the Mac's fetch completes (lib/models.ts redraftForJob). Either way
 * nobody has to write the steps by hand afterwards.
 */

const BATCH = 48
const LIBRARY_LIMIT = 90
const LIBRARY_TTL_MS = 5 * 60_000
const DEFAULT_LIBRARY_FILTERS: Filters = { ...EMPTY_FILTERS, sort: 'hot' }
type FeedSort = 'score' | 'views' | 'likes' | 'newest'
type FeedFilters = { creator: string; window: Filters['window']; sort: FeedSort; scoredOnly: boolean }
const DEFAULT_FEED_FILTERS: FeedFilters = { creator: '', window: '', sort: 'score', scoredOnly: false }
/** The items route caps one add at 60 — chunk to it rather than lose the tail. */
const ADD_CHUNK = 60

type SourceId = 'library' | 'instagram' | 'tiktok' | 'twitter'

const FEED_SOURCES: {
  id: Exclude<SourceId, 'library'>
  label: string
  platform: Platform
  dataUrl: string
}[] = [
  { id: 'instagram', label: 'Instagram', platform: 'instagram', dataUrl: '/api/ofmpro/instagram' },
  { id: 'tiktok', label: 'TikTok', platform: 'tiktok', dataUrl: '/api/ofmpro/tiktok' },
  { id: 'twitter', label: 'Twitter / X', platform: 'x', dataUrl: '/api/ofmpro/twitter' },
]

/** `name` and `thumb` are for showing the pick elsewhere (the card composer);
 *  only `jobId` / `url` ever go to the server. */
export type Pick =
  | { kind: 'library'; jobId: string; name?: string; thumb?: string | null }
  | { kind: 'feed'; url: string; name?: string; thumb?: string | null }

/** Keyed `${source}:${id}`, so a pick from the library and one from a feed
 *  with the same post can both be on the pile while they are different. */
export type Selection = Map<string, Pick>

const libraryPick = (item: LibraryItem): Pick => ({
  kind: 'library',
  jobId: item.id,
  name: item.title ?? item.author ?? item.author_name ?? undefined,
  // Always keep the cover URL — the thumb route 404s cleanly when missing.
  thumb: thumbUrl(item.id),
})
const feedPick = (item: MediaItem): Pick => ({
  kind: 'feed',
  url: item.url ?? '',
  name: item.username ?? item.caption ?? undefined,
  thumb: item.image,
})

/** What a dragged card carries — read by the week pane's drop zone. */
export const PICK_MIME = 'application/x-plan-picks'

export function readDraggedPicks(data: DataTransfer): Pick[] {
  const raw = data.getData(PICK_MIME)
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((pick) =>
      (pick?.kind === 'library' && typeof pick.jobId === 'string') ||
      (pick?.kind === 'feed' && typeof pick.url === 'string' && pick.url)) : []
  } catch {
    return []
  }
}

/**
 * Put picks on a week. The library first: those cards get their briefs
 * drafted in the same breath (appendItems), so they arrive ready to film.
 * Then the feed picks, through the queue exactly like a paste — thin cards,
 * video on its way. Shared by the wall's Add button and a drop on the week.
 */
export type SkipReason = 'already' | 'declined' | 'solo'

export const SKIP_WORDS: Record<SkipReason, string> = {
  already: 'is already on this week',
  declined: 'was turned down by them',
  solo: 'needs a second person on camera, and they film alone',
}

export async function addPicksToWeek(planId: string, picks: Pick[]): Promise<{
  text: string; bad?: boolean; landed: number; skipped: Record<string, SkipReason>
}> {
  const library = picks.filter((pick) => pick.kind === 'library')
  const urls = picks.filter((pick) => pick.kind === 'feed').map((pick) => pick.url).filter(Boolean)
  let landed = 0
  const skipped: Record<string, SkipReason> = {}

  // One round-trip for the whole library pile (written cards + cover job).
  if (library.length > 0) {
    const response = await fetch(`/api/plans/${planId}/items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        custom: {
          cards: library.map((pick) => ({
            label: pick.name?.trim() || 'Library video',
            job_id: pick.jobId,
          })),
        },
      }),
    }).catch(() => null)
    const body = await response?.json().catch(() => ({}))
    if (!response?.ok && response?.status !== 409) {
      return { text: body?.error ?? 'Could not add those to the week.', bad: true, landed, skipped }
    }
    landed += Number(body?.added ?? 0)
    for (const jobId of Array.isArray(body?.skipped) ? body.skipped as string[] : []) {
      skipped[jobId] = 'already'
    }
  }

  if (urls.length > 0) {
    const response = await fetch('/api/links', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: urls.join('\n'), plan_id: planId }),
    }).catch(() => null)
    const body = await response?.json().catch(() => ({}))
    if (!response?.ok) return { text: body?.error ?? 'Could not send those to the week.', bad: true, landed, skipped }
    landed += Number(body?.attached ?? 0)
  }

  const dropped = picks.length - landed
  const parts = [`Added ${landed} to the week`]
  if (dropped > 0) parts.push(`${dropped} were already on the week`)
  return { text: `${parts.join(' · ')}.`, landed, skipped }
}

const isPicture = (item: MediaItem) => item.image !== null && item.video === null

/* ---------------------------------------------------------- the cache
   The dialog opens with videos already on screen (Geno, 2026-10-09): the
   wall is warmed while the roster is still being looked at — RosterTab calls
   `prefetchPicks` on mount — and every source is kept in a module cache after
   its first load, so reopening the dialog paints what was already fetched
   while a stale library quietly refreshes behind it. */
let libraryCache = new Map<string, { at: number; items: LibraryItem[] }>()
let libraryFlight = new Map<string, Promise<LibraryItem[]>>()
const feedCache: Partial<Record<SourceId, Feed>> = {}
const feedFlight: Partial<Record<SourceId, Promise<Feed>>> = {}

function libraryRequestKey(filters: Filters, query: string): string {
  const params = new URLSearchParams(toQuery(filters, query))
  params.set('limit', String(LIBRARY_LIMIT))
  return params.toString()
}

function fetchLibrary(filters = DEFAULT_LIBRARY_FILTERS, query = ''): Promise<LibraryItem[]> {
  const key = libraryRequestKey(filters, query)
  const cached = libraryCache.get(key)
  if (cached && Date.now() - cached.at <= LIBRARY_TTL_MS) return Promise.resolve(cached.items)
  let flight = libraryFlight.get(key)
  if (!flight) {
    flight = fetch(`/api/library?${key}`)
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error(String(response.status)))))
      .then((body) => {
        const items = (body.items ?? []).filter((item: LibraryItem) => item.status === 'done')
        libraryCache.set(key, { at: Date.now(), items })
        while (libraryCache.size > 24) {
          const oldest = [...libraryCache].sort((a, b) => a[1].at - b[1].at)[0]
          if (!oldest) break
          libraryCache.delete(oldest[0])
        }
        return items
      })
      .finally(() => { libraryFlight.delete(key) })
    libraryFlight.set(key, flight)
  }
  return flight
}

function fetchFeed(id: SourceId): Promise<Feed> {
  const spec = FEED_SOURCES.find((entry) => entry.id === id)
  if (!spec) return Promise.reject(new Error('unknown source'))
  const held = feedCache[id]
  if (held) return Promise.resolve(held)
  if (!feedFlight[id]) {
    feedFlight[id] = fetch(spec.dataUrl)
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error(String(response.status)))))
      .then((body: Feed) => {
        feedCache[id] = body
        return body
      })
      .finally(() => { delete feedFlight[id] })
  }
  return feedFlight[id] as Promise<Feed>
}

/** Warm the wall before the dialog opens. Called by the roster on mount. */
export function prefetchPicks(): void {
  void fetchLibrary().catch(() => null)
}

function libraryFilterValues(filters: Filters): string[] {
  return [
    ...AXES.flatMap((axis) => filters[axis].map((tag) => `tag:${axis}:${tag}`)),
    `creator:${filters.creator || '__all__'}`,
    `window:${filters.window || 'all'}`,
    `hot:${filters.hot ? 'only' : 'all'}`,
    `sort:${filters.sort}`,
    `shelf:${filters.shelf || 'all'}`,
  ]
}

function libraryFiltersFromValues(values: string[]): Filters {
  const selected = new Set(values)
  const valueAfter = (prefix: string, fallback: string) =>
    values.find((value) => value.startsWith(prefix))?.slice(prefix.length) ?? fallback

  const axes = Object.fromEntries(AXES.map((axis) => [
    axis,
    values
      .filter((value) => value.startsWith(`tag:${axis}:`))
      .map((value) => value.slice(`tag:${axis}:`.length)),
  ])) as Record<(typeof AXES)[number], string[]>

  const creator = valueAfter('creator:', '__all__')
  const window = valueAfter('window:', 'all')
  const sort = valueAfter('sort:', 'hot')
  const shelf = valueAfter('shelf:', 'all')
  return {
    ...DEFAULT_LIBRARY_FILTERS,
    ...axes,
    creator: creator === '__all__' ? '' : creator,
    window: window === 'all' ? '' : window as Filters['window'],
    hot: selected.has('hot:only'),
    sort: sort as Filters['sort'],
    shelf: shelf === 'all' ? '' : shelf as Filters['shelf'],
  }
}

function libraryActiveFilterCount(filters: Filters): number {
  return AXES.reduce((count, axis) => count + filters[axis].length, 0)
    + Number(Boolean(filters.creator))
    + Number(Boolean(filters.window))
    + Number(filters.hot)
    + Number(filters.sort !== DEFAULT_LIBRARY_FILTERS.sort)
    + Number(Boolean(filters.shelf))
}

function feedFilterValues(filters: FeedFilters): string[] {
  return [
    `feed-creator:${filters.creator || '__all__'}`,
    `feed-window:${filters.window || 'all'}`,
    `feed-quality:${filters.scoredOnly ? 'scored' : 'all'}`,
    `feed-sort:${filters.sort}`,
  ]
}

function feedFiltersFromValues(values: string[]): FeedFilters {
  const valueAfter = (prefix: string, fallback: string) =>
    values.find((value) => value.startsWith(prefix))?.slice(prefix.length) ?? fallback
  const creator = valueAfter('feed-creator:', '__all__')
  const window = valueAfter('feed-window:', 'all')
  const quality = valueAfter('feed-quality:', 'all')
  const sort = valueAfter('feed-sort:', 'score')
  return {
    creator: creator === '__all__' ? '' : creator,
    window: window === 'all' ? '' : window as Filters['window'],
    scoredOnly: quality === 'scored',
    sort: sort as FeedSort,
  }
}

function feedActiveFilterCount(filters: FeedFilters): number {
  return Number(Boolean(filters.creator))
    + Number(Boolean(filters.window))
    + Number(filters.scoredOnly)
    + Number(filters.sort !== DEFAULT_FEED_FILTERS.sort)
}

function inWindow(created: string | null, window: Filters['window']): boolean {
  if (!window) return true
  const timestamp = created ? Date.parse(created) : Number.NaN
  if (!Number.isFinite(timestamp)) return false
  const days = window === 'week' ? 7 : Number(window)
  return timestamp >= Date.now() - days * 24 * 60 * 60 * 1000
}

export default function PickVideos({
  planId,
  enabled,
  selection,
  setSelection,
  onAdded,
}: {
  /** What is ticked — held by the editor, so the card composer can show the
   *  picks and put its settings on them. */
  selection: Selection
  setSelection: Dispatch<SetStateAction<Selection>>
  /** The week being built, or null while none is open — the wall still
   *  scrolls, only the add waits for a week to put things on. */
  planId: string | null
  /** Picking switched on from the week pane ("From the library" under Add
   *  cards). Off, the wall can be browsed but nothing on it can be picked. */
  enabled: boolean
  /** The week changed — the editor reloads the plan and its preview. */
  onAdded: () => void
}) {
  const [source, setSource] = useState<SourceId>('library')
  const [libraryResult, setLibraryResult] = useState<{ key: string; items: LibraryItem[] } | null>(() => {
    const key = libraryRequestKey(DEFAULT_LIBRARY_FILTERS, '')
    const cached = libraryCache.get(key)
    return cached ? { key, items: cached.items } : null
  })
  const [feeds, setFeeds] = useState<Partial<Record<SourceId, Feed>>>(() => ({ ...feedCache }))
  const [failed, setFailed] = useState(false)
  const [query, setQuery] = useState('')
  const [settledQuery, setSettledQuery] = useState('')
  const [shown, setShown] = useState(BATCH)
  const [libraryFilters, setLibraryFilters] = useState<Filters>(DEFAULT_LIBRARY_FILTERS)
  const [feedFilters, setFeedFilters] = useState<FeedFilters>(DEFAULT_FEED_FILTERS)
  const [libraryCreators, setLibraryCreators] = useState<{ handle: string; posts: number }[]>([])
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<{ text: string; bad?: boolean } | null>(null)

  const libraryKey = libraryRequestKey(libraryFilters, settledQuery)
  const library = libraryResult?.key === libraryKey ? libraryResult.items : null

  useEffect(() => {
    const timer = window.setTimeout(() => setSettledQuery(query), 220)
    return () => window.clearTimeout(timer)
  }, [query])

  const loadFeed = useCallback(async (id: SourceId) => {
    try {
      const body = await fetchFeed(id)
      setFeeds((current) => ({ ...current, [id]: body }))
    } catch {
      setFailed(true)
    }
  }, [])

  useEffect(() => {
    if (source !== 'library') return
    let live = true
    setFailed(false)
    void fetchLibrary(libraryFilters, settledQuery)
      .then((items) => { if (live) setLibraryResult({ key: libraryKey, items }) })
      .catch(() => { if (live) setFailed(true) })
    return () => { live = false }
  }, [source, libraryKey, libraryFilters, settledQuery])

  useEffect(() => {
    if (source === 'library') return
    setFailed(false)
    if (!feeds[source]) void loadFeed(source)
  }, [source, feeds, loadFeed])

  useEffect(() => {
    let live = true
    fetch('/api/creators')
      .then((response) => (response.ok ? response.json() : { creators: [] }))
      .then((body) => { if (live) setLibraryCreators(body.creators ?? []) })
      .catch(() => { if (live) setLibraryCreators([]) })
    return () => { live = false }
  }, [])

  useEffect(() => setShown(BATCH), [source, query, libraryKey, feedFilters])

  const needle = query.trim().toLowerCase()
  const items = useMemo(() => {
    if (source === 'library') return library ?? []
    const feed = feeds[source]
    if (!feed) return []
    const sort: Record<FeedSort, (a: MediaItem, b: MediaItem) => number> = {
      score: (a, b) => (b.score ?? -1) - (a.score ?? -1) || b.views - a.views,
      views: (a, b) => b.views - a.views,
      likes: (a, b) => b.likes - a.likes,
      newest: (a, b) => Date.parse(b.created ?? '0') - Date.parse(a.created ?? '0'),
    }
    return feed.items
      // A picture has nothing for whisper to hear, and a row without a post
      // link has nothing to queue — the plan only takes fetchable video.
      .filter((item) => !isPicture(item) && Boolean(item.url))
      .filter((item) => !feedFilters.creator || item.username === feedFilters.creator)
      .filter((item) => inWindow(item.created, feedFilters.window))
      .filter((item) => !feedFilters.scoredOnly || item.score !== null)
      .filter((item) => !needle ||
        (item.username ?? '').toLowerCase().includes(needle) ||
        (item.nickname ?? '').toLowerCase().includes(needle) ||
        (item.caption ?? '').toLowerCase().includes(needle))
      .sort(sort[feedFilters.sort])
  }, [source, library, feeds, needle, feedFilters])

  const visible = items.slice(0, shown)
  const loading = source === 'library' ? library === null : feeds[source] === undefined
  const locked = !planId || !enabled
  const shownAllSelected =
    visible.length > 0 &&
    visible.every((item) => selection.has(`${source}:${item.id}`))

  const selectedIn = (id: SourceId) =>
    [...selection.keys()].filter((key) => key.startsWith(`${id}:`)).length

  const sourceCount = (id: SourceId) => {
    if (id === 'library') return library?.length ?? null
    return feeds[id]?.items.filter((item) => !isPicture(item) && Boolean(item.url)).length ?? null
  }

  const libraryFilterSections: MultiSection[] = [
    ...AXES.map((axis) => ({
      label: taxonomy[axis].label,
      mode: 'multiple' as const,
      options: taxonomy[axis].tags.map((tag) => ({
        value: `tag:${axis}:${tag.id}`,
        label: tag.label,
      })),
    })),
    {
      label: 'Creator',
      mode: 'single',
      options: [
        { value: 'creator:__all__', label: 'Every creator' },
        ...libraryCreators.map((creator) => ({
          value: `creator:${creator.handle}`,
          label: `${creator.handle} (${creator.posts})`,
        })),
      ],
    },
    {
      label: 'Date range',
      mode: 'single',
      options: WINDOWS.map((option) => ({
        value: `window:${option.id || 'all'}`,
        label: option.label,
      })),
    },
    {
      label: 'Performance',
      mode: 'single',
      options: [
        { value: 'hot:all', label: 'All performance' },
        { value: 'hot:only', label: 'Outperforming only' },
      ],
    },
    {
      label: 'Sort by',
      mode: 'single',
      options: SORTS.map((option) => ({ value: `sort:${option.id}`, label: option.label })),
    },
    {
      label: 'Shelf',
      mode: 'single',
      options: [
        { value: 'shelf:all', label: 'All reels' },
        { value: 'shelf:expiring', label: 'Expiring' },
        { value: 'shelf:archived', label: 'Archived' },
      ],
    },
  ]

  const feedCreators = useMemo(() => {
    const counts = new Map<string, number>()
    for (const item of feeds[source]?.items ?? []) {
      if (item.username) counts.set(item.username, (counts.get(item.username) ?? 0) + 1)
    }
    return [...counts].sort(([a], [b]) => a.localeCompare(b))
  }, [feeds, source])

  const feedFilterSections: MultiSection[] = [
    {
      label: 'Creator',
      mode: 'single',
      options: [
        { value: 'feed-creator:__all__', label: 'Every creator' },
        ...feedCreators.map(([handle, posts]) => ({
          value: `feed-creator:${handle}`,
          label: `@${handle} (${posts})`,
        })),
      ],
    },
    {
      label: 'Date range',
      mode: 'single',
      options: WINDOWS.map((option) => ({
        value: `feed-window:${option.id || 'all'}`,
        label: option.label,
      })),
    },
    {
      label: 'Performance',
      mode: 'single',
      options: [
        { value: 'feed-quality:all', label: 'All posts' },
        { value: 'feed-quality:scored', label: 'Scored posts only' },
      ],
    },
    {
      label: 'Sort by',
      mode: 'single',
      options: [
        { value: 'feed-sort:score', label: 'Score' },
        { value: 'feed-sort:views', label: 'Views' },
        { value: 'feed-sort:likes', label: 'Likes' },
        { value: 'feed-sort:newest', label: 'Newest' },
      ],
    },
  ]

  const filterValues = source === 'library'
    ? libraryFilterValues(libraryFilters)
    : feedFilterValues(feedFilters)
  const filterCount = source === 'library'
    ? libraryActiveFilterCount(libraryFilters)
    : feedActiveFilterCount(feedFilters)
  const filterSections = source === 'library' ? libraryFilterSections : feedFilterSections

  function applyPickerFilters(next: string[]) {
    if (source === 'library') setLibraryFilters(libraryFiltersFromValues(next))
    else setFeedFilters(feedFiltersFromValues(next))
  }

  const hideUnavailableFeed = useCallback((id: string) => {
    if (source === 'library') return
    const sourceId = source
    const spec = FEED_SOURCES.find((entry) => entry.id === sourceId)
    if (!spec) return

    const cached = feedCache[sourceId]
    if (cached) {
      feedCache[sourceId] = { ...cached, items: cached.items.filter((item) => item.id !== id) }
    }
    setFeeds((current) => {
      const feed = current[sourceId]
      if (!feed) return current
      return { ...current, [sourceId]: { ...feed, items: feed.items.filter((item) => item.id !== id) } }
    })
    setSelection((current) => {
      const key = `${sourceId}:${id}`
      if (!current.has(key)) return current
      const next = new Map(current)
      next.delete(key)
      return next
    })
    void fetch(`${spec.dataUrl}?mediaId=${encodeURIComponent(id)}`, {
      method: 'DELETE',
      cache: 'no-store',
    }).catch(() => null)
  }, [source, setSelection])

  function toggle(key: string, pick: Pick) {
    if (locked) return
    setNote(null)
    setSelection((current) => {
      const next = new Map(current)
      if (next.has(key)) next.delete(key)
      else next.set(key, pick)
      return next
    })
  }

  function toggleShown() {
    if (locked) return
    setNote(null)
    setSelection((current) => {
      const next = new Map(current)
      for (const item of visible) {
        const key = `${source}:${item.id}`
        if (shownAllSelected) next.delete(key)
        else if (source === 'library') next.set(key, libraryPick(item as LibraryItem))
        else next.set(key, feedPick(item as MediaItem))
      }
      return next
    })
  }

  async function addToWeek() {
    if (!planId || selection.size === 0) return
    setBusy(true)
    setNote(null)
    const result = await addPicksToWeek(planId, [...selection.values()])
    setNote({ text: result.text, bad: result.bad })
    if (!result.bad) setSelection(new Map())
    if (result.landed > 0) onAdded()
    setBusy(false)
  }

  // Turned off from the week pane: whatever was ticked goes with it, so a
  // pile from last time cannot be added by accident later.
  useEffect(() => {
    if (!enabled) setSelection(new Map())
  }, [enabled, setSelection])

  /** The card being dragged — or, when it is one of the ticked ones, the
   *  whole pile, so a selection can be dropped onto the week in one move. */
  function startDrag(event: DragEvent, key: string, pick: Pick) {
    const picks = selection.has(key) ? [...selection.values()] : [pick]
    event.dataTransfer.setData(PICK_MIME, JSON.stringify(picks))
    event.dataTransfer.effectAllowed = 'copy'
  }

  const sourceChip = (id: SourceId, label: string, icon?: Platform) => {
    const held = selectedIn(id)
    const count = sourceCount(id)
    return (
      <button
        key={id}
        type="button"
        className="chip"
        data-on={source === id || undefined}
        aria-pressed={source === id}
        onClick={() => setSource(id)}
      >
        {icon && <PlatformIcon platform={icon} size={12} />} {label}
        {held > 0
          ? <b className="planpicker-sel"> {held}</b>
          : count !== null ? <b> {count}</b> : null}
      </button>
    )
  }

  return (
    <aside className="planpicker" aria-label="Pick videos">
      <header className="planpicker-head">
        <div className="planpicker-sources" role="group" aria-label="Video sources">
          {sourceChip('library', 'Library')}
          {FEED_SOURCES.map((entry) => sourceChip(entry.id, entry.label, entry.platform))}
        </div>

        <input
          className="pl-search planpicker-search"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search handle, name or caption…"
          aria-label="Search this source"
        />

        <div className="planpicker-row">
          {items.length > 0 && (
            <button
              type="button"
              className="chip"
              data-on={shownAllSelected || undefined}
              onClick={toggleShown}
              disabled={locked}
              title={locked ? 'Open a week first' : 'Tick every card on screen'}
            >
              {shownAllSelected ? 'Deselect shown' : 'Select shown'}
            </button>
          )}
          <DropMulti
            values={filterValues}
            sections={filterSections}
            onChange={applyPickerFilters}
            label={`Filter ${source === 'library' ? 'library videos' : 'social posts'}`}
            summary="Filters"
            count={filterCount}
            clearable={filterCount > 0}
          />
        </div>

        {note && (
          <p className="hint" role="status" data-tone={note.bad ? 'bad' : undefined}>{note.text}</p>
        )}
        {failed && <p className="hint" data-tone="bad">One of the sources could not be read — try again in a moment.</p>}
      </header>

      {planId && !enabled && (
        <p className="planpicker-lock" role="note">
          <b>Browsing only.</b> Press <em>+ Add a card</em> on the right and choose a library video to pick or drag from here.
        </p>
      )}

      <div className="planpicker-scroll" data-locked={locked || undefined}>
        {loading ? (
          <div className="grid planpicker-grid" aria-busy="true">
            {Array.from({ length: 6 }, (_, index) => <div className="pl-skeleton" key={index} />)}
          </div>
        ) : items.length === 0 ? (
          <div className="pl-none">
            <p>{needle ? `Nothing matches “${query.trim()}” here.` : 'Nothing to pick from this source yet.'}</p>
            {needle && <button type="button" className="chip" onClick={() => setQuery('')}>Clear the search</button>}
          </div>
        ) : (
          <>
            {source === 'library' ? (
              <div className="grid planpicker-grid">
                {(visible as LibraryItem[]).map((item) => {
                  const key = `${source}:${item.id}`
                  const pick = libraryPick(item)
                  return (
                    <div
                      key={item.id}
                      className="planpicker-drag"
                      draggable={!locked}
                      onDragStart={(event) => startDrag(event, key, pick)}
                    >
                      <LibraryCard
                        item={item}
                        picked={selection.has(key)}
                        selecting
                        selectable={!locked}
                        onOpen={() => toggle(key, pick)}
                        onToggle={() => toggle(key, pick)}
                      />
                    </div>
                  )
                })}
              </div>
            ) : (
              <div className="pl-grid planpicker-grid">
                {(visible as MediaItem[]).map((item) => {
                  const key = `${source}:${item.id}`
                  const spec = FEED_SOURCES.find((entry) => entry.id === source)
                  const pick = feedPick(item)
                  return (
                    <div
                      key={item.id}
                      className="planpicker-drag"
                      draggable={!locked}
                      onDragStart={(event) => startDrag(event, key, pick)}
                    >
                      <MediaCard
                        item={item}
                        platform={spec?.platform ?? 'x'}
                        selected={selection.has(key)}
                        selectable={!locked}
                        onToggle={() => toggle(key, pick)}
                        onUnavailable={hideUnavailableFeed}
                      />
                    </div>
                  )
                })}
              </div>
            )}

            {shown < items.length && (
              <div className="loadmore">
                <button type="button" className="btn btn-quiet" onClick={() => setShown((count) => count + BATCH)}>
                  Load {Math.min(BATCH, items.length - shown)} more · {items.length - shown} left
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {selection.size > 0 && !locked && (
        <div className="planpicker-foot" role="status">
          <span className="planpicker-count">{selection.size} selected</span>
          <button
            type="button"
            className="pill"
            data-primary="true"
            disabled={busy}
            title="Add them as they are — or set a template, label and directions in the card on the right first"
            onClick={() => void addToWeek()}
          >
            {busy ? 'Adding' : 'Add as they are'}
          </button>
          <button type="button" className="chip" onClick={() => { setSelection(new Map()); setNote(null) }}>
            Clear
          </button>
        </div>
      )}
      {!planId && (
        <p className="hint planpicker-wait">
          Start a week from the rail beside this pane, then pick videos onto it.
        </p>
      )}
    </aside>
  )
}
