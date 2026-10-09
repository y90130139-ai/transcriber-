'use client'

import { useCallback, useEffect, useMemo, useState, type Dispatch, type DragEvent, type SetStateAction } from 'react'
import LibraryCard from '@/components/LibraryCard'
import { MediaCard, type Feed, type MediaItem } from '@/components/platform/MediaFeed'
import PlatformIcon from '@/components/roster/PlatformIcon'
import { thumbUrl, type LibraryItem } from '@/lib/format'
import type { Platform } from '@/lib/socials'

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
/** The items route caps one add at 60 — chunk to it rather than lose the tail. */
const ADD_CHUNK = 60

type SourceId = 'library' | 'instagram' | 'tiktok' | 'twitter'

const FEED_SOURCES: {
  id: Exclude<SourceId, 'library'>
  label: string
  platform: Platform
  dataUrl: string
}[] = [
  { id: 'instagram', label: 'Instagram', platform: 'instagram', dataUrl: '/instagram/medias.json' },
  { id: 'tiktok', label: 'TikTok', platform: 'tiktok', dataUrl: '/tiktok/medias.json' },
  { id: 'twitter', label: 'Twitter / X', platform: 'x', dataUrl: '/twitter/medias.json' },
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
const LIBRARY_TTL_MS = 5 * 60_000

let libraryCache: { at: number; items: LibraryItem[] } | null = null
let libraryFlight: Promise<LibraryItem[]> | null = null
const feedCache: Partial<Record<SourceId, Feed>> = {}
const feedFlight: Partial<Record<SourceId, Promise<Feed>>> = {}

function fetchLibrary(): Promise<LibraryItem[]> {
  if (!libraryFlight) {
    libraryFlight = fetch(`/api/library?limit=${LIBRARY_LIMIT}&sort=hot`)
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error(String(response.status)))))
      .then((body) => {
        const items = (body.items ?? []).filter((item: LibraryItem) => item.status === 'done')
        libraryCache = { at: Date.now(), items }
        return items
      })
      .finally(() => { libraryFlight = null })
  }
  return libraryFlight
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
  if (libraryCache && Date.now() - libraryCache.at <= LIBRARY_TTL_MS) return
  void fetchLibrary().catch(() => null)
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
  const [library, setLibrary] = useState<LibraryItem[] | null>(() => libraryCache?.items ?? null)
  const [feeds, setFeeds] = useState<Partial<Record<SourceId, Feed>>>(() => ({ ...feedCache }))
  const [failed, setFailed] = useState(false)
  const [query, setQuery] = useState('')
  const [shown, setShown] = useState(BATCH)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<{ text: string; bad?: boolean } | null>(null)

  const loadLibrary = useCallback(async () => {
    try {
      setLibrary(await fetchLibrary())
    } catch {
      setFailed(true)
    }
  }, [])

  const loadFeed = useCallback(async (id: SourceId) => {
    try {
      const body = await fetchFeed(id)
      setFeeds((current) => ({ ...current, [id]: body }))
    } catch {
      setFailed(true)
    }
  }, [])

  useEffect(() => {
    if (source === 'library') {
      // Cached and fresh: nothing to do. Absent or stale: load — a stale cache
      // still paints first, the fresh copy replaces it when it lands.
      if (library && libraryCache && Date.now() - libraryCache.at <= LIBRARY_TTL_MS) return
      void loadLibrary()
      return
    }
    if (!feeds[source]) void loadFeed(source)
  }, [source, library, feeds, loadLibrary, loadFeed])

  useEffect(() => setShown(BATCH), [source, query])

  const needle = query.trim().toLowerCase()
  const items = useMemo(() => {
    if (source === 'library') {
      const held = library ?? []
      if (!needle) return held
      return held.filter((item) =>
        (item.author ?? '').toLowerCase().includes(needle) ||
        (item.author_name ?? '').toLowerCase().includes(needle) ||
        (item.title ?? '').toLowerCase().includes(needle) ||
        (item.preview ?? '').toLowerCase().includes(needle))
    }
    const feed = feeds[source]
    if (!feed) return []
    return feed.items
      // A picture has nothing for whisper to hear, and a row without a post
      // link has nothing to queue — the plan only takes fetchable video.
      .filter((item) => !isPicture(item) && Boolean(item.url))
      .filter((item) => !needle ||
        (item.username ?? '').toLowerCase().includes(needle) ||
        (item.nickname ?? '').toLowerCase().includes(needle) ||
        (item.caption ?? '').toLowerCase().includes(needle))
      .sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || b.views - a.views)
  }, [source, library, feeds, needle])

  const visible = items.slice(0, shown)
  const shownAllSelected =
    visible.length > 0 &&
    visible.every((item) => selection.has(`${source}:${item.id}`))

  const selectedIn = (id: SourceId) =>
    [...selection.keys()].filter((key) => key.startsWith(`${id}:`)).length

  const sourceCount = (id: SourceId) => {
    if (id === 'library') return library?.length ?? null
    return feeds[id]?.items.filter((item) => !isPicture(item) && Boolean(item.url)).length ?? null
  }

  function toggle(key: string, pick: Pick) {
    setNote(null)
    setSelection((current) => {
      const next = new Map(current)
      if (next.has(key)) next.delete(key)
      else next.set(key, pick)
      return next
    })
  }

  function toggleShown() {
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

  const loading = source === 'library' ? library === null : feeds[source] === undefined
  /** No week open, or the week pane has not asked for videos from here: the
   *  wall is a window, not a picker (Geno, 2026-10-09). "From the library"
   *  under Add cards is what lifts it. */
  const locked = !planId || !enabled

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
          <span className="pl-bar-count">
            {loading ? 'Loading…' : `${items.length} pickable`}
          </span>
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
                        onToggle={() => toggle(key, pick)}
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
