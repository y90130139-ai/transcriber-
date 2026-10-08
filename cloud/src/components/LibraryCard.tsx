'use client'

/**
 * One library card — redrawn as a platform card (2026-10-08).
 *
 * The grid used to be a picture with a paragraph under it: handle, preview,
 * likes, tags, buttons — six pieces of furniture below every frame. The
 * /instagram feed showed the better shape: the frame IS the card, and
 * everything lives on it, the way the reference app draws a reel. This is
 * that shape with the library's own contents in it — the age and the 90-day
 * clock top left, the tools top right, who and what it says over the floor,
 * the numbers stacked bottom right.
 *
 * All six behaviours survive the redraw:
 *   preview   the video plays in the frame under the pointer, or pinned
 *   sound     the mute tool unmutes and keeps it playing
 *   save      the file straight off the Mac, same link ItemView offers
 *   caption   a fold over the floor with the reel's whole caption
 *   select    the check tool, or any tap while a selection is live
 *   tags      worn as chips above the name, hover for the rest
 *
 * The video and the caption are not in the grid's own payload (90 cards,
 * polled every 15 seconds — signed links there would churn every poll), so
 * the card fetches its item once, on the first hover or tap, and a
 * module-level cache keeps every later look free. The files live on the
 * Mac: when it is asleep there is no preview and no save, and the card
 * says so instead of pretending.
 */
import { useEffect, useRef, useState } from 'react'
import { Icon } from '@/components/console/ConsoleIcons'
import {
  CaptionGlyph, CheckGlyph, CommentGlyph, DownloadGlyph,
  HeartGlyph, MuteGlyph, PauseGlyph, PlayGlyph, SoundGlyph,
} from '@/components/platform/glyphs'
import { ago, clock, compact, displayName, thumbUrl, type LibraryItem } from '@/lib/format'
import { explainOutperformance } from '@/lib/outperformance'

/** Transcripts start mid-thought; the card starts with a capital. */
const sentence = (text: string) => (text ? text.charAt(0).toUpperCase() + text.slice(1) : text)

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
  /** Playing right now — by hover, or pinned by the Preview tool. */
  const [playing, setPlaying] = useState(false)
  const [pinned, setPinned] = useState(false)
  /** Sound on: the hover preview is muted; this unmutes it so you can hear
   *  what they are saying. Turning sound on also pins playback, so walking
   *  the pointer away does not cut the audio mid-word. */
  const [sound, setSound] = useState(false)
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
      setSound(false)
      return
    }
    const loaded = await load()
    if (!loaded.media) return
    setPinned(true)
    setPlaying(true)
  }

  /** Hear it. Usually the preview is already running muted under the
   *  pointer, so this is an instant unmute; cold, it starts the video
   *  with sound inside the same tap the browser's autoplay rules want. */
  async function toggleSound() {
    if (sound) {
      setSound(false)
      return
    }
    const loaded = detail ?? (await load())
    if (!loaded.media) return
    setSound(true)
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
  const verdict = item.badges && item.badges.length > 0 ? item.badges[0] : null

  return (
    <article className={`card${feature ? ' card-feature' : ''}`} data-picked={picked}>
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
              muted={!sound}
              loop
              playsInline
              autoPlay
              preload="metadata"
              onCanPlay={(event) => void event.currentTarget.play().catch(() => null)}
            />
          ) : (
            <Frame item={item} />
          )}
          <span className="card-scrim" aria-hidden />

          {/* Top left: when it landed, how long it runs, and anything the
              library itself has to say — hot, the 90-day clock, a sleeping
              Mac. The same chips the platform feeds wear. */}
          <span className="card-topline">
            {item.upload_date && (
              <span className="card-when">
                <Icon name="calendar" size={12} />
                {ago(item.upload_date)}
              </span>
            )}
            {item.duration_sec !== null && (
              <span className="card-when">
                <Icon name="clock" size={12} />
                {clock(item.duration_sec)}
              </span>
            )}
            {item.is_hot && <span className="card-chip" data-tone="hot">Hot</span>}
            {macAsleep && (
              <span className="card-chip" data-tone="quiet" title="The files live on the Mac and it cannot be reached right now">Mac asleep</span>
            )}
            <ExpiryTag item={item} />
          </span>

          {/* Over the floor: the tags, who it is, what it says, the verdict.
              The numbers stack in the opposite corner, as the feeds do. */}
          <span className="card-foot">
            {item.tags && item.tags.length > 0 && (
              <span className="card-tags">
                {item.tags.map((tag, index) => (
                  <span key={`${tag.axis}-${tag.tag}`} data-axis={tag.axis} data-origin={tag.origin}
                    data-more={index >= 3 || undefined}>{tag.tag}</span>
                ))}
                {item.tags.length > 3 && (
                  <span className="card-tags-more" aria-hidden>+{item.tags.length - 3}</span>
                )}
              </span>
            )}
            <span className="card-handle" title={item.title ?? item.author_name ?? undefined}>
              {displayName(item)}
            </span>
            {item.preview && <span className="card-line">{sentence(item.preview)}</span>}
            {verdict ? (
              <span className="card-score" data-tone={verdict.tone} title={verdict.detail}>{verdict.label}</span>
            ) : item.outperformance !== null && item.outperformance !== undefined ? (
              <span className="card-score" title={explainOutperformance(item.outperformance)}>
                {item.outperformance}×
              </span>
            ) : null}
          </span>

          <span className="card-stats">
            {item.sig_plays !== null && item.sig_plays !== undefined && (
              <span className="card-stat" title={`${Number(item.sig_plays).toLocaleString()} views`}>
                <PlayGlyph />
                {compact(Number(item.sig_plays))}
                <span className="sr-only"> views</span>
              </span>
            )}
            {item.like_count !== null && (
              <span className="card-stat" title={`${item.like_count.toLocaleString()} likes`}>
                <HeartGlyph />
                {compact(item.like_count)}
              </span>
            )}
            {item.comment_count !== null && (
              <span className="card-stat" title={`${item.comment_count.toLocaleString()} comments`}>
                <CommentGlyph />
                {compact(item.comment_count)}
              </span>
            )}
          </span>
        </span>
      </button>

      {/* The tools sit above the frame like the feed's, and above the caption
          fold so it can always be closed again. */}
      <span className="card-tools">
        <button
          type="button"
          className="card-tool"
          data-on={(playing && pinned) || undefined}
          onClick={() => void togglePreview()}
          aria-pressed={playing && pinned}
          title={playing && pinned ? 'Stop the preview' : 'Preview the video'}
        >
          {playing && pinned ? <PauseGlyph /> : <PlayGlyph />}
        </button>
        <button
          type="button"
          className="card-tool"
          data-on={sound || undefined}
          onClick={() => void toggleSound()}
          aria-pressed={sound}
          title={sound ? 'Mute' : 'Play with sound'}
        >
          {sound ? <SoundGlyph /> : <MuteGlyph />}
        </button>
        {detail?.media ? (
          <a className="card-tool" href={detail.media.download} title="Save the video file">
            <DownloadGlyph />
          </a>
        ) : (
          <button type="button" className="card-tool" onClick={() => void save()} title="Save the video file">
            <DownloadGlyph />
          </button>
        )}
        <button
          type="button"
          className="card-tool"
          data-on={captionOpen || undefined}
          aria-expanded={captionOpen}
          onClick={() => void toggleCaption()}
          title={captionOpen ? 'Hide the caption' : 'Read the caption'}
        >
          <CaptionGlyph />
        </button>
        <button
          type="button"
          className="card-tool"
          data-on={picked || undefined}
          aria-label={picked ? 'Deselect' : 'Select'}
          aria-pressed={picked}
          onClick={onToggle}
          title={picked ? 'Deselect' : 'Select'}
        >
          <CheckGlyph />
        </button>
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
      Expiring · {left}d
    </span>
  )
}
