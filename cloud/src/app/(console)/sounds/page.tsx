'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import PlatformIcon from '@/components/roster/PlatformIcon'
import { compact } from '@/lib/format'
import type { Platform } from '@/lib/socials'

/**
 * Trending Sounds — every music track the OFM Pro feeds carry, most used
 * lately first. A sound a crowd of creators picked up this week is a reason
 * to use it; one that has held the same crowd for a month is one to avoid.
 * Per-creator originals are left out upstream, in lib/sounds.ts.
 *
 * The list runs to thousands, so it reads itself as the page scrolls: a
 * sentinel under the rows asks for the next page before it comes into view
 * (Geno, 2026-10-18: "the moment we scroll down it loads more and more").
 */
type Sound = {
  title: string
  platforms: Platform[]
  medias: number
  creators_now: number
  creators_before: number
  top_plays: number | null
  example: string | null
}

type SoundsFeed = { sounds: Sound[]; total: number; rising: number }

const PAGE = 100
/** How far below the fold the next page starts being read, so scrolling
 *  never waits on the network. */
const LEAD = 900

export default function SoundsPage() {
  const [sounds, setSounds] = useState<Sound[] | null>(null)
  const [total, setTotal] = useState(0)
  const [rising, setRising] = useState(0)
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)
  const sentinelRef = useRef<HTMLDivElement | null>(null)
  const feed = useRef({ busy: false, loaded: 0, total: 0, failed: false })

  const load = useCallback(async (offset: number) => {
    const live = feed.current
    if (live.busy) return
    live.busy = true
    setLoading(true)
    try {
      const response = await fetch(`/api/sounds?offset=${offset}&limit=${PAGE}`)
      if (!response.ok) throw new Error(String(response.status))
      const body = (await response.json()) as SoundsFeed
      live.loaded = offset + body.sounds.length
      live.total = body.total
      live.failed = false
      setSounds((current) => (offset === 0 || !current ? body.sounds : [...current, ...body.sounds]))
      setTotal(body.total)
      setRising(body.rising)
      setFailed(false)
      // A screen taller than the page would leave the sentinel still on it,
      // and no scroll would come to ask for the rest — so ask here.
      requestAnimationFrame(() => {
        const state = feed.current
        if (state.busy || state.failed || state.loaded >= state.total) return
        const node = sentinelRef.current
        if (node && node.getBoundingClientRect().top < window.innerHeight + LEAD) void load(state.loaded)
      })
    } catch {
      live.failed = true
      setFailed(true)
    } finally {
      live.busy = false
      setLoading(false)
    }
  }, [])

  const loadMore = useCallback(() => {
    const live = feed.current
    if (live.busy || live.failed || (live.total > 0 && live.loaded >= live.total)) return
    void load(live.loaded)
  }, [load])

  useEffect(() => { void load(0) }, [load])

  useEffect(() => {
    const node = sentinelRef.current
    if (!node) return
    const observer = new IntersectionObserver(
      (entries) => { if (entries.some((entry) => entry.isIntersecting)) loadMore() },
      { rootMargin: `${LEAD}px 0px` },
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [loadMore])

  const done = sounds !== null && total > 0 && sounds.length >= total

  return (
    <div className="dash">
      <header className="dash-head dash-head-flush">
        <div>
          <h2 className="dash-title">Sounds</h2>
          <p className="dash-sub">
            {sounds === null
              ? failed ? 'The feeds did not answer.' : 'Reading the feeds…'
              : `${total.toLocaleString('en-US')} going round · ${rising.toLocaleString('en-US')} rising`}
          </p>
        </div>
      </header>

      {sounds === null && !failed && (
        <div className="snd-skel" aria-hidden="true">
          {Array.from({ length: 8 }, (_, row) => (
            <div key={row} className="snd-skel-row">
              <span className="snd-skel-bar snd-skel-rank" />
              <span className="snd-skel-bar snd-skel-title" />
              <span className="snd-skel-bar snd-skel-count" />
              <span className="snd-skel-bar snd-skel-delta" />
              <span className="snd-skel-bar snd-skel-pill" />
            </div>
          ))}
        </div>
      )}

      {failed && sounds === null && (
        <div className="snd-note" role="alert">
          <span>Couldn&apos;t read the feeds.</span>
          <button type="button" className="pill" onClick={() => void load(0)} disabled={loading}>Retry</button>
        </div>
      )}

      {sounds !== null && sounds.length === 0 && (
        <p className="dash-empty">Nothing tracked yet — the feeds fill this as they land.</p>
      )}

      {sounds !== null && sounds.length > 0 && (
        <>
          <ol className="snd-list" aria-busy={loading}>
            {sounds.map((sound, index) => {
              const up = sound.creators_now > sound.creators_before
              const down = sound.creators_before > sound.creators_now
              return (
                <li key={sound.title} className="snd-row" data-top={index < 3 ? 'true' : undefined}>
                  <span className="wk-n">{String(index + 1).padStart(2, '0')}</span>
                  <span className="snd-main">
                    <span className="snd-title">{sound.title}</span>
                    <span className="snd-meta">
                      <span className="snd-plays">
                        {sound.medias} {sound.medias === 1 ? 'reel' : 'reels'}
                        {sound.top_plays !== null ? ` · ${compact(sound.top_plays)} plays at best` : ''}
                      </span>
                      {sound.platforms.length > 0 && (
                        <span className="snd-marks">
                          {sound.platforms.map((platform) => (
                            <PlatformIcon key={platform} platform={platform} size={12} />
                          ))}
                        </span>
                      )}
                    </span>
                  </span>
                  <span className="snd-count"><b>{sound.creators_now.toLocaleString('en-US')}</b> creator{sound.creators_now === 1 ? '' : 's'}</span>
                  <span className="snd-delta" data-trend={up ? 'up' : down ? 'down' : undefined}>
                    {up ? `▲ up from ${sound.creators_before}` : down ? `▼ was ${sound.creators_before}` : 'holding'}
                  </span>
                  {sound.example && (
                    <a className="pill" href={sound.example} target="_blank" rel="noreferrer" aria-label={`Hear ${sound.title}`}>Hear it</a>
                  )}
                </li>
              )
            })}
          </ol>

          {loading && <p className="snd-note" aria-hidden="true">Reading more…</p>}

          {failed && (
            <div className="snd-note" role="alert">
              <span>Couldn&apos;t read more of the list.</span>
              <button type="button" className="pill" onClick={() => void load(feed.current.loaded)} disabled={loading}>Retry</button>
            </div>
          )}

          {done && !failed && (
            <p className="snd-note">That&apos;s all {total.toLocaleString('en-US')} sounds.</p>
          )}

          <p className="sr-only" role="status">
            {loading ? 'Reading more sounds…' : `${sounds.length.toLocaleString('en-US')} of ${total.toLocaleString('en-US')} sounds read`}
          </p>
        </>
      )}

      <div ref={sentinelRef} className="snd-sentinel" aria-hidden="true" />
    </div>
  )
}
