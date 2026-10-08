'use client'

import { useEffect, useRef, useState } from 'react'
import ThemeToggle from './ThemeToggle'

/**
 * Her deck: library reels picked for her, one at a time, swipe or tap
 * (Geno, 2026-10-06 — "kind of like Tinder... they could click certain
 * videos to their plans"). A star saves it to her shelf, tells OPS through
 * the bot, and sharpens her picks; a pass never comes back. From the shelf
 * she can put a star straight on her own week.
 *
 * The cards are poster frames, not players: library files live on the Mac,
 * not in the cloud, so the frame plus the hook is the pitch and Instagram
 * is one tap away. (The reels on her PLAN play in full — those files are
 * uploaded for her on purpose.)
 */

type Card = {
  job_id: string
  preview: string | null
  duration_sec: number | null
  url: string | null
  formats: string[]
  has_thumb: boolean
  /** Signed Mac link while it is awake — inline playback. */
  video?: string | null
  item_id?: string | null
}

const SWIPE_PX = 70

export default function DiscoverView({ token }: { token: string }) {
  const [deck, setDeck] = useState<Card[] | null>(null)
  const [starred, setStarred] = useState<Card[]>([])
  const [drag, setDrag] = useState(0)
  /** Sound for the top card (Geno, 2026-10-07): the video plays muted in
   *  the frame; one tap hears it. Resets per card — autoplay with sound
   *  on a fresh card is how a deck gets closed in a quiet room. */
  const [sound, setSound] = useState(false)
  const [leaving, setLeaving] = useState<'star' | 'pass' | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const start = useRef<number | null>(null)

  useEffect(() => {
    let alive = true
    fetch(`/api/plan/${token}/discover`)
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (!alive || !data) return
        setDeck(data.deck ?? [])
        setStarred(data.starred ?? [])
      })
      .catch(() => alive && setDeck([]))
    return () => { alive = false }
  }, [token])

  const top = deck?.[0] ?? null

  async function act(action: 'star' | 'pass') {
    if (!top || leaving) return
    setLeaving(action)
    void fetch(`/api/plan/${token}/discover`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ job_id: top.job_id, action }),
    }).catch(() => null)
    setTimeout(() => {
      setDeck((cards) => (cards ? cards.slice(1) : cards))
      setSound(false) // the next card starts quiet
      if (action === 'star') setStarred((shelf) => [{ ...top, item_id: null }, ...shelf])
      setDrag(0)
      setLeaving(null)
    }, 220)
  }

  async function addToWeek(card: Card) {
    const response = await fetch(`/api/plan/${token}/discover/add`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ job_id: card.job_id }),
    }).catch(() => null)
    const payload = await response?.json().catch(() => null)
    if (response?.ok) {
      setStarred((shelf) => shelf.map((item) =>
        item.job_id === card.job_id ? { ...item, item_id: 'added' } : item))
      setNote('Added to your week ✓')
    } else {
      setNote(payload?.error ?? 'That one could not be added.')
    }
    setTimeout(() => setNote(null), 4000)
  }

  function onPointerDown(event: React.PointerEvent) {
    start.current = event.clientX
  }
  function onPointerMove(event: React.PointerEvent) {
    if (start.current === null) return
    setDrag(event.clientX - start.current)
  }
  function onPointerUp() {
    if (start.current === null) return
    start.current = null
    if (drag > SWIPE_PX) void act('star')
    else if (drag < -SWIPE_PX) void act('pass')
    else setDrag(0)
  }

  return (
    <main className="plan disc">
      <header className="disc-head">
        <a className="disc-back" href={`/p/${token}`}>&larr; Your plan</a>
        <b>Discover</b>
        <ThemeToggle />
      </header>

      <p className="disc-hint">
        Reels picked for you. Swipe right or tap &#9733; on ones you want to film —
        we see your stars and your picks get sharper.
      </p>

      {deck === null ? (
        <p className="disc-empty">Loading your deck&hellip;</p>
      ) : top ? (
        <>
          <div className="disc-stack">
            {deck[1] && <div className="disc-card disc-under" aria-hidden />}
            <div
              className="disc-card"
              data-leaving={leaving ?? undefined}
              style={{ transform: `translateX(${drag}px) rotate(${drag / 22}deg)` }}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
            >
              {top.video ? (
                /* The file itself, straight off the Mac while it is awake —
                   watch it on the spot instead of a trip to Instagram. */
                <video
                  key={top.job_id}
                  className="disc-frame"
                  src={top.video}
                  poster={top.has_thumb ? `/api/plan/${token}/discover/thumb/${top.job_id}` : undefined}
                  muted={!sound}
                  loop
                  playsInline
                  autoPlay
                  preload="metadata"
                />
              ) : top.has_thumb ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img className="disc-frame" src={`/api/plan/${token}/discover/thumb/${top.job_id}`} alt="" draggable={false} />
              ) : (
                <div className="disc-frame disc-blank" />
              )}
              {top.video && (
                <button
                  type="button"
                  className="disc-sound"
                  aria-pressed={sound}
                  onClick={(event) => { event.stopPropagation(); setSound((on) => !on) }}
                  onPointerDown={(event) => event.stopPropagation()}
                >
                  {sound ? '\u{1F50A}' : '\u{1F507}'}
                </button>
              )}
              <div className="disc-meta">
                {top.preview && <p className="disc-preview">{top.preview}</p>}
                <p className="disc-chips">
                  {top.duration_sec ? <span>{Math.round(top.duration_sec)}s</span> : null}
                  {top.formats.slice(0, 3).map((format) => <span key={format}>{format}</span>)}
                </p>
                {top.url && (
                  <a className="disc-watch" href={top.url} target="_blank" rel="noreferrer">
                    {top.video ? 'Open on Instagram \u2197' : 'Watch it on Instagram \u2197'}
                  </a>
                )}
              </div>
            </div>
          </div>
          <div className="disc-verdict">
            <button type="button" className="disc-pass" onClick={() => void act('pass')}>
              &#10005; Not for me
            </button>
            <button type="button" className="disc-star" onClick={() => void act('star')}>
              &#9733; Star it
            </button>
          </div>
        </>
      ) : (
        <p className="disc-empty">
          That&rsquo;s the deck for now &#127881; New reels land here as the library grows —
          check back in a few days.
        </p>
      )}

      {starred.length > 0 && (
        <section className="disc-shelf" aria-label="Your starred reels">
          <h2>Starred <span>{starred.length}</span></h2>
          <ul>
            {starred.map((card) => (
              <li key={card.job_id}>
                {card.has_thumb ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img src={`/api/plan/${token}/discover/thumb/${card.job_id}`} alt="" width={56} height={72} />
                ) : <span className="disc-mini-blank" />}
                <p>{card.preview ?? 'A reel you starred'}</p>
                {card.item_id ? (
                  <b className="disc-on-week">On your week &#10003;</b>
                ) : (
                  <button type="button" onClick={() => void addToWeek(card)}>Add to my week</button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {note && <p className="disc-note" role="status">{note}</p>}
    </main>
  )
}
