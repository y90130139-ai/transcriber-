'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from '@/components/console/ConsoleIcons'
import PlatformIcon from '@/components/roster/PlatformIcon'
import type { Platform } from '@/lib/socials'
import { ago, compact } from '@/lib/format'
import {
  CheckGlyph, CommentGlyph, DownloadGlyph, HeartGlyph,
  MuteGlyph, OpenGlyph, PlayGlyph, SoundGlyph,
} from './glyphs'

/**
 * A platform feed (2026-10-07). Geno's OFMPro medias exports — Instagram's
 * 1,982 videos, TikTok's 848, X's 556 posts — drawn as the reference's card
 * grid: a frame per post, the age chip top left, the tools top right, the
 * handle and numbers over the floor.
 *
 * Saved media streams from Cloudflare R2 first. Unmirrored rows use their
 * recorded source links until the R2 backlog reaches them. A preview the
 * player cannot open is tagged `unavailable_at` and left on screen; nothing
 * is deleted until the feed's own "Delete unavailable" button. A handful of
 * videos download at a time so the row in front of you paints first. The
 * handle, date and counts stay on the card while that frame arrives.
 * X rows are not all video: pictures and slideshows draw as stills (the
 * slideshow wears its slide count). Re-run `scripts/import-ofmpro.mjs
 * <platform>` with a fresh export to refresh the data.
 */

type MediaItem = {
  id: string
  shortcode: string | null
  url: string | null
  created: string | null
  caption: string | null
  type: string | null
  views: number
  likes: number
  comments: number
  score: number | null
  username: string | null
  nickname: string | null
  followers: number | null
  audio: string | null
  video: string | null
  image: string | null
  slides: number | null
  mirror: string | null
  fallback: string | null
}
export type { MediaItem }

type Feed = {
  platform: string
  window: { from: string | null; to: string | null }
  rows: number
  unique: number
  duplicates: number
  /** Rows tagged unavailable, still in the table until someone deletes them. */
  unavailable?: number
  totals: { views: number; likes: number; comments: number; creators: number; scored: number }
  items: MediaItem[]
}
export type { Feed }

const PAGE_SIZE = 16

const SORTS = [
  { id: 'score', label: 'Score' },
  { id: 'views', label: 'Views' },
  { id: 'likes', label: 'Likes' },
  { id: 'newest', label: 'Newest' },
] as const
type SortId = (typeof SORTS)[number]['id']

const exact = (value: number) => value.toLocaleString('en-US')

/** How many previews may download at once. More than this and the cards on
 *  screen sit black while off-screen ones occupy every connection. */
const MAX_VIDEO_LOADS = 4
let activeVideoLoads = 0
const videoLoadQueue: Array<() => void> = []

function requestVideoSlot(): Promise<() => void> {
  return new Promise((resolve) => {
    const grant = () => {
      activeVideoLoads += 1
      let released = false
      resolve(() => {
        if (released) return
        released = true
        activeVideoLoads -= 1
        videoLoadQueue.shift()?.()
      })
    }
    if (activeVideoLoads < MAX_VIDEO_LOADS) grant()
    else videoLoadQueue.push(grant)
  })
}

/* ---------------------------------------------------------------- card */

export function MediaCard({ item, platform, selected, onToggle, onUnavailable, selectable = true }: {
  item: MediaItem
  platform: Platform
  selected: boolean
  onToggle: (id: string) => void
  onUnavailable?: (id: string) => void
  selectable?: boolean
}) {
  const frame = useRef<HTMLDivElement>(null)
  const video = useRef<HTMLVideoElement>(null)
  /** The active source: null until the card approaches the viewport. */
  const [src, setSrc] = useState<string | null>(null)
  const [imageSrc, setImageSrc] = useState<string | null>(item.image)
  const [imageReady, setImageReady] = useState(false)
  const [failed, setFailed] = useState(false)
  /** The first frame has actually painted — until then, a shimmer holds the
   *  frame instead of a black hole. */
  const [loaded, setLoaded] = useState(false)
  const [muted, setMuted] = useState(true)
  const [hovering, setHovering] = useState(false)
  /** One report per post. A refresh must not send the same id again. */
  const reportedUnavailable = useRef(false)
  /** The post this instance has already painted. A new signed URL for the
   *  same id must not restart the frame. */
  const paintedId = useRef<string | null>(null)
  const srcRef = useRef<string | null>(null)
  const releaseSlot = useRef<(() => void) | null>(null)
  srcRef.current = src

  const primary = item.video ? `${item.video}#t=0.001` : null
  const fallbackUrl = item.fallback ?? (item.mirror !== item.video ? item.mirror : null)
  const fallback = fallbackUrl && fallbackUrl !== item.video ? `${fallbackUrl}#t=0.001` : null
  const firstVideoSource = primary ?? fallback
  const fileUrl = item.video ?? item.image ?? item.mirror ?? item.fallback

  function freeSlot() {
    releaseSlot.current?.()
    releaseSlot.current = null
  }

  // Only videos arm lazily, and only a few at a time. Pictures let the
  // browser's own lazy loading do it.
  useEffect(() => {
    const node = frame.current
    if (!node || !firstVideoSource || failed) return
    let cancel = false
    const observer = new IntersectionObserver((entries) => {
      if (cancel || srcRef.current || !entries.some((entry) => entry.isIntersecting)) return
      observer.disconnect()
      void requestVideoSlot().then((done) => {
        if (cancel || srcRef.current) {
          done()
          return
        }
        releaseSlot.current = done
        setLoaded(false)
        setSrc(firstVideoSource)
      })
    }, { rootMargin: '480px 0px' })
    observer.observe(node)
    return () => {
      cancel = true
      observer.disconnect()
      freeSlot()
    }
  }, [failed, firstVideoSource])

  // Hover can arrive before the lazy video element mounts. Retry when its
  // source is attached, and again when the browser says it can play.
  useEffect(() => {
    if (!hovering || !src) return
    void video.current?.play().catch(() => null)
  }, [hovering, src])

  useEffect(() => {
    if (paintedId.current === item.id) return
    paintedId.current = item.id
    reportedUnavailable.current = false
    setImageSrc(item.image)
  }, [item.id, item.image])

  function tryPlay() {
    if (!window.matchMedia('(hover: hover)').matches) return
    setHovering(true)
    void video.current?.play().catch(() => null)
  }

  function tryStop() {
    setHovering(false)
    video.current?.pause()
  }

  /** Cloudflare first, then the source fallback; never leave a broken frame. */
  function onError() {
    if (src !== primary && src !== fallback && primary) {
      setLoaded(false)
      setSrc(primary)
      return
    }
    if (src === primary && fallback) {
      setLoaded(false)
      setSrc(fallback)
      return
    }
    setFailed(true)
    freeSlot()
    if (reportedUnavailable.current) return
    reportedUnavailable.current = true
    onUnavailable?.(item.id)
  }

  function onImageError() {
    if (imageSrc === item.image && fallbackUrl && fallbackUrl !== item.image) {
      setImageReady(false)
      setImageSrc(fallbackUrl)
      return
    }
    setFailed(true)
    if (reportedUnavailable.current) return
    reportedUnavailable.current = true
    onUnavailable?.(item.id)
  }

  function toggleMute() {
    const next = !muted
    setMuted(next)
    if (!next) void video.current?.play().catch(() => null)
  }

  const handle = item.username ?? 'unknown'
  const hasSize = typeof item.followers === 'number' && item.followers > 0
  const isPicture = item.image !== null && item.video === null
  const nothingToShow = !item.video && !item.image && !item.mirror && !item.fallback

  useEffect(() => {
    if (!nothingToShow || reportedUnavailable.current) return
    reportedUnavailable.current = true
    setFailed(true)
    onUnavailable?.(item.id)
  }, [item.id, nothingToShow, onUnavailable])

  return (
    <article className="pl-card" data-on={selected || undefined}>
      <div className="pl-frame" ref={frame} onMouseEnter={tryPlay} onMouseLeave={tryStop}>
        {failed || nothingToShow ? (
          <div className="pl-blank">
            <PlatformIcon platform={platform} size={26} />
            <span>
              {nothingToShow ? 'No source recorded' : 'Preview unavailable'}
              {!nothingToShow && <><br />link expired — re-import to refresh</>}
            </span>
          </div>
        ) : isPicture ? (
          <img
            className="pl-poster"
            src={imageSrc ?? ''}
            alt=""
            loading="lazy"
            decoding="async"
            referrerPolicy={platform === 'x' ? 'no-referrer' : undefined}
            onLoad={() => setImageReady(true)}
            onError={onImageError}
          />
        ) : src ? (
          <video
            ref={video}
            src={src}
            preload="metadata"
            muted={muted}
            loop
            playsInline
            /* React's video props do not type referrerPolicy though every
               browser honours it; the spread keeps the attribute and the
               type check green. */
            {...(platform === 'x' ? { referrerPolicy: 'no-referrer' } : {})}
            data-loaded={loaded || undefined}
            onLoadedData={(event) => {
              setLoaded(true)
              freeSlot()
              if (hovering) void event.currentTarget.play().catch(() => null)
            }}
            onError={onError}
          />
        ) : null}
        {((!isPicture && !loaded && !failed && !nothingToShow) || (isPicture && !imageReady && !failed && !nothingToShow)) && (
          <span className="pl-loading" aria-hidden />
        )}
        <span className="pl-scrim" aria-hidden />

        <a
          className="pl-open"
          href={item.url ?? '#'}
          target="_blank"
          rel="noreferrer"
          aria-label={`Open @${handle}'s post`}
          title={item.caption ?? undefined}
        />

        <>
            <span className="pl-topline">
              <span className="pl-when">
                <Icon name="calendar" size={12} />
                {ago(item.created)}
              </span>
              {item.slides !== null && item.slides > 1 && (
                <span className="pl-slides">{item.slides} slides</span>
              )}
            </span>

            <span className="pl-tools">
              {!isPicture && (
                <button
                  type="button"
                  className="pl-tool"
                  data-on={!muted || undefined}
                  onClick={toggleMute}
                  aria-pressed={!muted}
                  title={muted ? 'Unmute' : 'Mute'}
                >
                  {muted ? <MuteGlyph /> : <SoundGlyph />}
                </button>
              )}
              {fileUrl && (
                <a
                  className="pl-tool"
                  href={fileUrl}
                  target="_blank"
                  rel="noreferrer"
                  title={isPicture ? 'Open the image' : 'Open the video file'}
                >
                  <DownloadGlyph />
                </a>
              )}
              <a
                className="pl-tool"
                href={item.url ?? '#'}
                target="_blank"
                rel="noreferrer"
                title="Open the post"
              >
                <OpenGlyph />
              </a>
              <button
                type="button"
                className="pl-tool"
                data-on={selected || undefined}
                onClick={() => onToggle(item.id)}
                disabled={!selectable}
                aria-pressed={selected}
                title={selected ? 'Deselect' : 'Select'}
              >
                <CheckGlyph />
              </button>
            </span>

            <span className="pl-foot">
              <span className="pl-user" title={item.nickname ?? undefined}>@{handle}</span>
              <span className="pl-subline">
                {hasSize ? `${compact(item.followers)} followers` : item.nickname ?? '—'}
                {item.audio ? ` · ${item.audio}` : ''}
              </span>
              {item.score !== null && (
                <span className="pl-score" title={`Outer score ${item.score}`}>{item.score.toFixed(1)}</span>
              )}
            </span>

            <span className="pl-stats">
              <span className="pl-stat" title={`${exact(item.views)} views`}><PlayGlyph />{compact(item.views)}</span>
              <span className="pl-stat" title={`${exact(item.likes)} likes`}><HeartGlyph />{compact(item.likes)}</span>
              <span className="pl-stat" title={`${exact(item.comments)} comments`}><CommentGlyph />{compact(item.comments)}</span>
            </span>
          </>
      </div>
    </article>
  )
}

/* ---------------------------------------------------------------- page */

export default function MediaFeed({ platform, label, dataUrl, unit }: {
  /** Brand glyph and the blank state's mark. */
  platform: Platform
  /** The page title. */
  label: string
  /** Where the trimmed import lives (public folder). */
  dataUrl: string
  /** What one row is called around here: "videos" or "posts". */
  unit: 'videos' | 'posts'
}) {
  const [feed, setFeed] = useState<Feed | null>(null)
  const [failed, setFailed] = useState(false)
  /** Posts whose preview cannot play. Hidden only after an explicit delete. */
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(() => new Set())
  const [taggedIds, setTaggedIds] = useState<Set<string>>(() => new Set())
  const [taggedCount, setTaggedCount] = useState(0)
  const [purging, setPurging] = useState(false)
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<SortId>('score')
  const [shown, setShown] = useState(PAGE_SIZE)
  const loadMoreSentinel = useRef<HTMLDivElement>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [copied, setCopied] = useState(false)
  /** The library run: sending, and what the queue said back. */
  const [adding, setAdding] = useState(false)
  const [note, setNote] = useState<{ text: string; bad?: boolean } | null>(null)

  const load = useCallback((clear = false) => {
    setFailed(false)
    if (clear) setFeed(null)
    fetch(dataUrl, { cache: 'no-store' })
      .then((response) => {
        if (!response.ok) throw new Error(String(response.status))
        return response.json() as Promise<Feed>
      })
      .then((body) => {
        setFeed(body)
        setTaggedCount(body.unavailable ?? 0)
        // Nothing scored in this window — Score is not a sort here, say Views.
        if (body.totals.scored === 0) setSort('views')
      })
      .catch(() => setFailed(true))
  }, [dataUrl])

  useEffect(() => {
    load(true)
    const refresh = () => {
      if (document.visibilityState === 'visible') void load()
    }
    const timer = window.setInterval(refresh, 5 * 60_000)
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [load])

  const onUnavailable = useCallback((id: string) => {
    setTaggedIds((current) => {
      if (current.has(id)) return current
      const next = new Set(current)
      next.add(id)
      setTaggedCount((count) => count + 1)
      return next
    })
    setSelected((current) => {
      if (!current.has(id)) return current
      const next = new Set(current)
      next.delete(id)
      return next
    })
    // Tag the row. Deleting here is what stalled the scroll.
    void fetch(dataUrl, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mediaId: id }),
      cache: 'no-store',
    }).catch(() => null)
  }, [dataUrl])

  async function deleteUnavailable() {
    if (purging || taggedCount === 0) return
    setPurging(true)
    const response = await fetch(`${dataUrl}?unavailable=1`, { method: 'DELETE', cache: 'no-store' })
    if (response.ok) {
      const ids = taggedIds
      setHiddenIds((current) => {
        const next = new Set(current)
        for (const id of ids) next.add(id)
        return next
      })
      setTaggedIds(new Set())
      setTaggedCount(0)
    }
    setPurging(false)
  }

  useEffect(() => setShown(PAGE_SIZE), [query, sort])

  const items = useMemo(() => {
    if (!feed) return []
    const needle = query.trim().toLowerCase()
    const filtered = needle
      ? feed.items.filter((item) =>
          (item.username ?? '').toLowerCase().includes(needle) ||
          (item.nickname ?? '').toLowerCase().includes(needle) ||
          (item.caption ?? '').toLowerCase().includes(needle))
      : feed.items.slice()
    const by: Record<SortId, (a: MediaItem, b: MediaItem) => number> = {
      score: (a, b) => (b.score ?? -1) - (a.score ?? -1) || b.views - a.views,
      views: (a, b) => b.views - a.views,
      likes: (a, b) => b.likes - a.likes,
      newest: (a, b) => Date.parse(b.created ?? '0') - Date.parse(a.created ?? '0'),
    }
    return filtered.filter((item) => !hiddenIds.has(item.id)).sort(by[sort])
  }, [feed, hiddenIds, query, sort])

  /** Tick or untick one card. */
  function toggle(id: string) {
    setNote(null)
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  /** Everything currently drawn. The next page mounts before it reaches the
   *  viewport, so a scroll lands on frames that have already settled. */
  const visible = items.slice(0, shown)

  useEffect(() => {
    const node = loadMoreSentinel.current
    if (!node || shown >= items.length) return

    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return
      observer.disconnect()
      setShown((count) => Math.min(items.length, count + PAGE_SIZE))
    }, { rootMargin: '900px 0px' })

    observer.observe(node)
    return () => observer.disconnect()
  }, [items.length, shown])

  const shownAllSelected = visible.length > 0 && visible.every((item) => selected.has(item.id))

  /** Select or deselect the posts currently visible in the feed. */
  function toggleShown() {
    setNote(null)
    setSelected((current) => {
      const next = new Set(current)
      const all = visible.length > 0 && visible.every((item) => next.has(item.id))
      for (const item of visible) {
        if (all) next.delete(item.id)
        else next.add(item.id)
      }
      return next
    })
  }

  /** Straight into the library: the picked rows' post links go through the
   *  queue exactly like a paste (scripts/import-ofmpro.mjs feeds these feeds;
   *  /api/links is the door into the corpus). Pictures are skipped — a still
   *  has nothing whisper can hear — and the queue's own dedupe answers with
   *  how many were already held. */
  async function addToLibrary() {
    if (!feed) return
    const picked = feed.items.filter((item) => selected.has(item.id))
    const isPicture = (item: MediaItem) => item.image !== null && item.video === null
    const pictures = picked.filter(isPicture).length
    const videos = picked.filter((item) => item.url && !isPicture(item))
    const linkless = picked.length - videos.length - pictures

    if (videos.length === 0) {
      setNote({
        text: pictures
          ? 'Nothing to hear in a picture — select videos to send to the library.'
          : 'Nothing there carries a link the library can fetch.',
        bad: true,
      })
      return
    }

    setAdding(true)
    setNote(null)
    const response = await fetch('/api/links', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: videos.map((item) => item.url).join('\n') }),
    })
    const body = await response.json().catch(() => ({}))
    if (!response.ok) {
      setNote({ text: body.error ?? 'Could not send those to the library.', bad: true })
    } else {
      const parts = [`Added ${body.added} to the library`]
      if (body.skipped) parts.push(`${body.skipped} already held`)
      if (pictures) parts.push(`${pictures} picture${pictures === 1 ? '' : 's'} skipped`)
      if (linkless) parts.push(`${linkless} with no link`)
      setNote({ text: `${parts.join(' · ')} — the Mac fetches and listens from here.` })
    }
    setAdding(false)
  }

  function copyLinks() {
    if (!feed) return
    const links = feed.items.filter((item) => selected.has(item.id) && item.url).map((item) => item.url as string)
    void navigator.clipboard?.writeText(links.join('\n')).catch(() => null)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1600)
  }

  const period = feed?.window
  const sorts = feed && feed.totals.scored === 0 ? SORTS.filter((option) => option.id !== 'score') : SORTS

  return (
    <div className="dash">
      <header className="pl-head">
        <span className="pl-badge"><PlatformIcon platform={platform} size={26} /></span>
        <div className="pl-head-copy">
          <h2 className="pl-title">{label}</h2>
          <p className="pl-sub">
            {feed ? (
              <>
                Imported from OFMPro · <b>{period?.from}</b> → <b>{period?.to}</b> ·
                {' '}<b>{exact(feed.unique)}</b> {unit}
                {feed.duplicates > 0 ? <> from <b>{exact(feed.rows)}</b> tracked rows</> : null}
              </>
            ) : 'Loading the import…'}
          </p>
        </div>
      </header>

      {failed && (
        <div className="pl-fail">
          <span>The import could not be read ({dataUrl}).</span>
          <button type="button" onClick={() => load(true)}>Try again</button>
        </div>
      )}

      {!feed && !failed && (
        <div className="pl-grid" aria-busy="true" aria-label="Loading media">
          {Array.from({ length: 12 }, (_, index) => <div className="pl-skeleton" key={index} />)}
        </div>
      )}

      {feed && (
        <>
          <section className="pl-bar">
            <input
              className="pl-search"
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search handle, name or caption…"
              aria-label={`Search the ${label} feed`}
            />
            <div className="pl-bar-sorts" role="group" aria-label="Sort the feed">
              {sorts.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  className="chip"
                  data-on={sort === option.id || undefined}
                  aria-pressed={sort === option.id}
                  onClick={() => setSort(option.id)}
                >
                  {option.label}
                </button>
              ))}
            </div>
            {taggedCount > 0 && (
              <button
                type="button"
                className="chip"
                onClick={() => void deleteUnavailable()}
                disabled={purging}
                title="Remove every preview tagged unavailable from the database"
              >
                {purging ? 'Deleting…' : `Delete ${exact(taggedCount)} unavailable`}
              </button>
            )}
            {items.length > 0 && (
              <button
                type="button"
                className="chip"
                data-on={shownAllSelected || undefined}
                onClick={toggleShown}
                title="Tick every card on screen, for a run into the library"
              >
                {shownAllSelected ? 'Deselect shown' : 'Select shown'}
              </button>
            )}
            <span className="pl-bar-count">
              {exact(items.length)} of {exact(feed.unique)}
            </span>
          </section>

          {items.length === 0 ? (
            <div className="pl-none">
              <p>Nothing matches “{query.trim()}” in this window.</p>
              <button type="button" className="chip" onClick={() => setQuery('')}>Clear the search</button>
            </div>
          ) : (
            <>
              <div className="pl-grid">
                {visible.map((item) => (
                  <MediaCard
                    key={item.id}
                    item={item}
                    platform={platform}
                    selected={selected.has(item.id)}
                    onToggle={toggle}
                    onUnavailable={onUnavailable}
                  />
                ))}
              </div>

              {shown < items.length && (
                <>
                  <div className="pl-load-sentinel" ref={loadMoreSentinel} aria-hidden="true" />
                  <p className="sr-only" role="status" aria-live="polite">
                    Showing {visible.length} of {items.length} {unit}
                  </p>
                </>
              )}
            </>
          )}

          {selected.size > 0 && (
            <div className="pl-bulk" role="status">
              <span className="pl-bulk-count">{selected.size} selected</span>
              <button
                type="button"
                className="pill"
                data-primary="true"
                onClick={() => void addToLibrary()}
                disabled={adding}
                title="Send the ticked videos to the library — the Mac fetches and transcribes each one"
              >
                {adding ? 'Sending' : 'Add to library'}
              </button>
              <button type="button" className="chip" onClick={copyLinks}>
                {copied ? 'Copied ✓' : 'Copy links'}
              </button>
              <button
                type="button"
                className="chip"
                onClick={() => { setSelected(new Set()); setNote(null) }}
              >
                Clear
              </button>
              {note && (
                <span className="pl-bulk-note hint" data-tone={note.bad ? 'bad' : undefined} title={note.text}>
                  {note.text}
                </span>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
