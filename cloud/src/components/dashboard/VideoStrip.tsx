'use client'

import { useState, type ReactNode } from 'react'
import type { ReelMedia } from '@/lib/reel-media'
import { useLive } from '@/lib/live'
import Avatar from './Avatar'
import { compact } from './format'

export type StripItem = {
  code: string
  /** The one word on the cover: Winner, Flop, Edit… */
  badge?: { label: string; tone: 'win' | 'good' | 'avg' | 'low' | 'flop' | 'edit' }
  /** One short line under the numbers: "3.4× their usual", "due 30 Sep". */
  sub?: string
  actions?: ReactNode
}

/** Covers, video and numbers for a set of reels, fetched once — and remembered,
 *  so the strip renders finished instead of filling in row by row. */
export function useReelMedia(codes: string[]): Record<string, ReelMedia> {
  const key = [...new Set(codes)].sort().join(',')
  const live = useLive<{ media: Record<string, ReelMedia> }>(
    key ? `/api/reels/media?codes=${encodeURIComponent(key)}` : null,
  )
  return live.data?.media ?? {}
}

/**
 * A row of reels to swipe through, upright like the phone they were made for.
 * Plays in place when a video is available (Instagram's link, or the Mac's
 * copy while it is awake); otherwise opens the reel on Instagram.
 */
export default function VideoStrip({ items, media, who }: {
  items: StripItem[]
  media: Record<string, ReelMedia>
  /** Whose reels, for the corner badge. */
  who: { name: string; photo: string | null }
}) {
  if (!items.length) return null
  return (
    <ol className="dash-reel-strip">
      {items.map((item) => <li key={item.code}><Card item={item} media={media[item.code]} who={who} /></li>)}
    </ol>
  )
}

function Card({ item, media, who }: { item: StripItem; media?: ReelMedia; who: { name: string; photo: string | null } }) {
  const [playing, setPlaying] = useState(false)
  const [broken, setBroken] = useState(false)
  const permalink = `https://www.instagram.com/reel/${item.code}/`
  const open = () => (media?.video ? setPlaying(true) : window.open(permalink, '_blank', 'noopener,noreferrer'))
  return (
    <article className="dash-reel">
      <div className="dash-reel-media">
        {playing && media?.video ? (
          <video src={media.video} controls autoPlay playsInline poster={media.poster ?? undefined} />
        ) : (
          <button className="dash-reel-cover" onClick={open} aria-label={media?.video ? 'Play this reel' : 'Open this reel on Instagram'}>
            {media?.poster && !broken
              ? <img src={media.poster} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setBroken(true)} />
              : <span className="dash-reel-blank" aria-hidden />}
            <span className="dash-reel-play" aria-hidden>{media?.video ? '▶' : '↗'}</span>
          </button>
        )}
        <header className="dash-reel-who">
          <Avatar name={who.name} src={who.photo} size={28} />
          <span><b>@{media?.handle ?? '—'}</b></span>
        </header>
        {item.badge && <span className="dash-reel-grade" data-tone={item.badge.tone}>{item.badge.label}</span>}
      </div>
      <footer className="dash-reel-stats">
        <span title="Views"><b aria-hidden>▶</b> {compact(media?.plays)}</span>
        <span title="Likes"><b aria-hidden>♥</b> {compact(media?.likes)}</span>
        <span title="Comments"><b aria-hidden>💬</b> {compact(media?.comments)}</span>
        <a href={permalink} target="_blank" rel="noreferrer" aria-label="Open on Instagram">↗</a>
      </footer>
      {item.sub && <p className="dash-reel-status">{item.sub}</p>}
      {item.actions && <div className="dash-reel-actions">{item.actions}</div>}
    </article>
  )
}
