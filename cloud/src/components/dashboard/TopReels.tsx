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
/** A reel at this many times her usual views is flagged for repurposing. */
const REPURPOSE_AT = 2

export default function TopReels({ reels, title = 'Top reels', note, onRepurpose }: {
  reels: Reel[]
  title?: string
  note?: string
  /** On a model's Analytics tab: put the reel on her week as a Repurpose card.
   *  Resolves to what to tell the operator. */
  onRepurpose?: (reel: Reel) => Promise<string>
}) {
  return (
    <section className="dash-panel dash-reels" aria-labelledby="dash-reels-h">
      <header className="dash-panel-head">
        <h2 id="dash-reels-h">{title}</h2>
        <p>{note ?? 'Most viewed, posted in this period'}</p>
      </header>
      {reels.length === 0 ? <p className="dash-empty">No reels in this period yet.</p> : (
        <ol className="dash-reel-strip">
          {reels.map((reel) => <li key={reel.post_id}><ReelCard reel={reel} onRepurpose={onRepurpose} /></li>)}
        </ol>
      )}
    </section>
  )
}

function ReelCard({ reel, onRepurpose }: { reel: Reel; onRepurpose?: (reel: Reel) => Promise<string> }) {
  const [playing, setPlaying] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const flagged = Boolean(onRepurpose && reel.multiple !== null && reel.multiple >= REPURPOSE_AT)
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
        {flagged && (
          <span className="dash-reel-flag" title={`${reel.multiple}× their usual views — worth repurposing`}>
            ♻ Repurpose · {reel.multiple}×
          </span>
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
      {onRepurpose && (
        <>
          <button type="button" className="dash-reel-action" data-flagged={flagged} disabled={status === 'Adding…'}
            onClick={async () => { setStatus('Adding…'); setStatus(await onRepurpose(reel)) }}>
            ♻ Repurpose
          </button>
          {status && status !== 'Adding…' && <p className="dash-reel-status" role="status">{status}</p>}
        </>
      )}
    </article>
  )
}
