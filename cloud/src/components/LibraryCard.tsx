'use client'

/**
 * One library card (split out of LibraryGrid, 2026-10-06 — Geno: clicking
 * into every reel to find out what it is "is too time-consuming").
 *
 * Three things the grid card can now do without opening the item:
 *   preview   the video itself plays in the frame, muted and looping —
 *             automatically under the pointer on a mouse machine, by the
 *             Preview button anywhere
 *   save      the file straight off the Mac, same link ItemView offers
 *   caption   a fold with the reel's whole caption, plan-card style
 *
 * The video and the caption are not in the grid's own payload (90 cards,
 * polled every 15 seconds — signed links there would churn every poll), so
 * the card fetches its item once, on the first hover or tap, and a
 * module-level cache keeps every later look free. The files live on the
 * Mac: when it is asleep there is no preview and no save, and the card
 * says so instead of pretending.
 */
import { useEffect, useRef, useState } from 'react'
import { clock, compact, displayName, thumbUrl, type LibraryItem } from '@/lib/format'
import { explainOutperformance } from '@/lib/outperformance'

type Detail = {
  caption: string | null
  media: { video: string; poster: string; download: string } | null
}

/** One fetch per item per session, shared by every card and both buttons. */
const details = new Map<string, Promise<Detail>>()

function detailFor(id: string): Promise<Detail> {
  const held = details.get(id)
  if (held) return held
  const fetched = fetch(`/api/items/${id}`)
    .then((response) => (response.ok ? response.json() : null))
    .then((body) => ({
      caption: body?.item?.caption ? String(body.item.caption) : null,
      media: body?.media ?? null,
    }))
    .catch(() => ({ caption: null, media: null }))
    .then((detail) => {
      // A miss while the Mac was asleep must not cache "no video" forever.
      if (!detail.media) details.delete(id)
      return detail
    })
  details.set(id, fetched)
  return fetched
}

/** Under the pointer this long before the video starts — a scroll past a
 *  card is not a request to play it. */
const HOVER_DELAY_MS = 250

function Frame({ item }: { item: LibraryItem }) {
  if (item.has_thumb) {
    return (
      <img
        src={thumbUrl(item.id)}
        alt=""
        width={420}
        height={525}
        loading="lazy"
        decoding="async"
      />
    )
  }
  // No poster frame is not a reason to show an empty grey box.
  return <div className="card-frame-empty">{displayName(item)}</div>
}

export default function LibraryCard({
  item,
  feature = false,
  picked,
  selecting,
  onOpen,
  onToggle,
}: {
  item: LibraryItem
  feature?: boolean
  picked: boolean
  selecting: boolean
  onOpen: () => void
  onToggle: () => void
}) {
  const [detail, setDetail] = useState<Detail | null>(null)
  /** Playing right now — by hover, or pinned by the Preview button. */
  const [playing, setPlaying] = useState(false)
  const [pinned, setPinned] = useState(false)
  const [captionOpen, setCaptionOpen] = useState(false)
  /** The one honest excuse: the files live on the Mac and it is asleep. */
  const [macAsleep, setMacAsleep] = useState(false)
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => { if (hoverTimer.current) clearTimeout(hoverTimer.current) }, [])

  async function load(): Promise<Detail> {
    const loaded = await detailFor(item.id)
    setDetail(loaded)
    setMacAsleep(!loaded.media)
    return loaded
  }

  function hoverStart() {
    if (pinned || !window.matchMedia('(hover: hover)').matches) return
    hoverTimer.current = setTimeout(() => {
      void load().then((loaded) => { if (loaded.media) setPlaying(true) })
    }, HOVER_DELAY_MS)
  }

  function hoverEnd() {
    if (hoverTimer.current) clearTimeout(hoverTimer.current)
    if (!pinned) setPlaying(false)
  }

  async function togglePreview() {
    if (playing && pinned) {
      setPinned(false)
      setPlaying(false)
      return
    }
    const loaded = await load()
    if (!loaded.media) return
    setPinned(true)
    setPlaying(true)
  }

  /** The Save link needs the signed URL before it can be an <a>; the first
   *  press fetches it, and from then on the button IS the link. */
  async function save() {
    const loaded = detail ?? (await load())
    if (loaded.media) window.location.assign(loaded.media.download)
  }

  async function toggleCaption() {
    if (!captionOpen && !detail) await load()
    setCaptionOpen((current) => !current)
  }

  const video = detail?.media?.video ?? null

  return (
    <article
      className={`card${feature ? ' card-feature' : ''}`}
      data-picked={picked}
    >
      <button
        type="button"
        className="card-open"
        onClick={() => (selecting ? onToggle() : onOpen())}
      >
        <span
          className="card-frame"
          onMouseEnter={hoverStart}
          onMouseLeave={hoverEnd}
        >
          {playing && video ? (
            <video
              src={video}
              poster={item.has_thumb ? thumbUrl(item.id) : undefined}
              muted
              loop
              playsInline
              autoPlay
              preload="metadata"
            />
          ) : (
            <Frame item={item} />
          )}
          {item.is_hot && <span className="card-flame" aria-label="Outperforming">🔥</span>}
          {item.duration_sec !== null && (
            <span className="card-tag" data-corner="right">{clock(item.duration_sec)}</span>
          )}
          {/* Bottom-left, the way the Reels tab does it: the eye and the
              number first, the verdict beside it. A row rather than two
              absolutely-positioned tags, so they can never land on top of
              each other however long the label runs. */}
          <span className="card-stats">
            <ExpiryTag item={item} />
            {item.sig_plays !== null && item.sig_plays !== undefined && (
              <span className="card-tag" title={`${Number(item.sig_plays).toLocaleString()} views`}>
                <svg className="card-eye" viewBox="0 0 24 16" aria-hidden="true">
                  <path d="M1 8s4-6 11-6 11 6 11 6-4 6-11 6S1 8 1 8Z" fill="none"
                        stroke="currentColor" strokeWidth="2" />
                  <circle cx="12" cy="8" r="3" fill="currentColor" />
                </svg>
                {compact(Number(item.sig_plays))}
                <span className="sr-only"> views</span>
              </span>
            )}
            {item.badges && item.badges.length > 0 ? (
              <span className="card-tag" data-tone={item.badges[0].tone} title={item.badges[0].detail}>
                {item.badges[0].label}
              </span>
            ) : (
              item.outperformance !== null &&
              item.outperformance !== undefined && (
                <span className="card-tag" title={explainOutperformance(item.outperformance)}>
                  {item.outperformance}×
                </span>
              )
            )}
          </span>
        </span>
        <span className="card-handle">{displayName(item)}</span>
        {item.preview && <span className="card-line">{item.preview}</span>}
        <span className="card-meta">
          {item.upload_date && <span>{item.upload_date}</span>}
          {/* Views moved onto the frame, where the eye is. Repeating them
              here was the overlap that made the line hard to read. */}
          {item.like_count !== null && <span>{compact(item.like_count)} likes</span>}
          {item.comment_count !== null && <span>{compact(item.comment_count)} cm</span>}
        </span>
        {item.tags && item.tags.length > 0 && (
          <span className="card-tags">
            {item.tags.slice(0, 4).map((tag) => (
              <span key={`${tag.axis}-${tag.tag}`} data-origin={tag.origin}>{tag.tag}</span>
            ))}
          </span>
        )}
      </button>

      {/* What the card can do without being opened (Geno, 2026-10-06). */}
      <span className="card-acts">
        <button type="button" className="card-act" data-on={playing && pinned || undefined} onClick={() => void togglePreview()}>
          {playing && pinned ? 'Stop' : 'Preview'}
        </button>
        {detail?.media ? (
          <a className="card-act" href={detail.media.download}>Save video</a>
        ) : (
          <button type="button" className="card-act" onClick={() => void save()}>Save video</button>
        )}
        <button
          type="button"
          className="card-act"
          aria-expanded={captionOpen}
          onClick={() => void toggleCaption()}
        >
          {captionOpen ? '– Caption' : '+ Caption'}
        </button>
        {macAsleep && <span className="card-asleep">Mac asleep — no file right now</span>}
      </span>

      {captionOpen && (
        <div className="card-caption">
          {detail === null ? (
            <p className="card-caption-quiet">Reading…</p>
          ) : detail.caption ? (
            <>
              <p>{detail.caption}</p>
              <button
                type="button"
                className="card-act"
                onClick={() => void navigator.clipboard?.writeText(detail.caption ?? '').catch(() => null)}
              >
                Copy
              </button>
            </>
          ) : (
            <p className="card-caption-quiet">No caption stored for this one.</p>
          )}
        </div>
      )}

      <button
        type="button"
        className="card-pick"
        aria-label={picked ? 'Deselect' : 'Select'}
        aria-pressed={picked}
        onClick={onToggle}
      >
        {picked ? '✓' : '+'}
      </button>
    </article>
  )
}

/** The 90-day clock on a card (lib/expiry.ts): Expiring in its last five
 *  days, kept past it only while a plan card still uses it. */
function ExpiryTag({ item }: { item: LibraryItem }) {
  if (item.archived_at) return <span className="card-tag" data-tone="expired">Archived</span>
  const left = item.expires_in
  if (left === null || left === undefined || left > 5) return null
  if (left <= 0) {
    return item.on_open_card
      ? <span className="card-tag" data-tone="expired" title="Past 90 days — kept while it is on an open plan card">On a plan · past 90d</span>
      : <span className="card-tag" data-tone="expiring" title="Past 90 days — leaves the library at the next daily pass (10am ET)">Leaving today</span>
  }
  return (
    <span className="card-tag" data-tone="expiring" title={`Leaves the library in ${left} day${left === 1 ? '' : 's'} — put it on someone's week`}>
      ⏳ Expiring · {left}d
    </span>
  )
}
