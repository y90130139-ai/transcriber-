'use client'

import { useState } from 'react'
import type { Reel } from '@/lib/performance/load'
import Avatar from './Avatar'
import { ago, compact } from './format'

/**
 * The best reels of the period, upright like the phone they were made for.
 * A reel whose video link is still live plays right here; the rest open on
 * Instagram — Instagram's links expire within a day of Scout seeing them.
 */
export default function TopReels({ reels, title = 'Top reels', note }: { reels: Reel[]; title?: string; note?: string }) {
  return (
    <section className="dash-panel dash-reels" aria-labelledby="dash-reels-h">
      <header className="dash-panel-head">
        <h2 id="dash-reels-h">{title}</h2>
        <p>{note ?? 'Most viewed, posted in this period'}</p>
      </header>
      {reels.length === 0 ? <p className="dash-empty">No reels in this period yet.</p> : (
        <ol className="dash-reel-strip">
          {reels.map((reel) => <li key={reel.post_id}><ReelCard reel={reel} /></li>)}
        </ol>
      )}
    </section>
  )
}

function ReelCard({ reel }: { reel: Reel }) {
  const [playing, setPlaying] = useState(false)
  const [posterBroken, setPosterBroken] = useState(false)
  const open = () => {
    if (reel.video_url) setPlaying(true)
    else window.open(reel.permalink, '_blank', 'noopener,noreferrer')
  }
  return (
    <article className="dash-reel">
      <div className="dash-reel-media">
        {playing && reel.video_url ? (
          <video src={reel.video_url} controls autoPlay playsInline poster={reel.poster_url ?? undefined} />
        ) : (
          <button className="dash-reel-cover" onClick={open}
            aria-label={reel.video_url ? `Play ${reel.model_name}'s reel` : `Open ${reel.model_name}'s reel on Instagram`}>
            {reel.poster_url && !posterBroken
              ? <img src={reel.poster_url} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setPosterBroken(true)} />
              : <span className="dash-reel-blank" aria-hidden />}
            <span className="dash-reel-play" aria-hidden>{reel.video_url ? '▶' : '↗'}</span>
          </button>
        )}
        <header className="dash-reel-who">
          <Avatar name={reel.model_name} src={reel.photo_url} size={28} />
          <span><b>@{reel.handle}</b><small>{ago(reel.posted_at)}</small></span>
        </header>
      </div>
      <footer className="dash-reel-stats">
        <span title="Views"><b aria-hidden>▶</b> {compact(reel.plays)}</span>
        <span title="Likes"><b aria-hidden>♥</b> {compact(reel.likes)}</span>
        <span title="Comments"><b aria-hidden>💬</b> {compact(reel.comments)}</span>
        <a href={reel.permalink} target="_blank" rel="noreferrer" aria-label="Open on Instagram">↗</a>
      </footer>
    </article>
  )
}
