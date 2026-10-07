'use client'

import { useEffect, useState } from 'react'
import { compact } from '@/lib/format'

type Sound = {
  audio_id: string
  title: string | null
  artist: string | null
  creators_now: number
  creators_before: number
  top_plays: number | string | null
  example: string | null
}

/** Sounds going round: what several watched creators picked up lately, rising
 *  first. A trend reaches an audio track before it reaches anyone's numbers,
 *  so this is the earliest signal the sweep has. */
export default function SoundsPage() {
  const [sounds, setSounds] = useState<Sound[] | null>(null)

  useEffect(() => {
    fetch('/api/scout/sounds')
      .then((response) => (response.ok ? response.json() : { sounds: [] }))
      .then((body) => setSounds(body.sounds ?? []))
      .catch(() => setSounds([]))
  }, [])

  const rising = sounds?.filter((sound) => sound.creators_now > sound.creators_before).length ?? 0

  return (
    <div className="dash">
      <header className="dash-head dash-head-flush">
        <div>
          <h2 className="dash-title">Sounds</h2>
          <p className="dash-sub">
            {sounds === null
              ? 'Reading the fortnight…'
              : `${sounds.length} going round · ${rising} rising`}
          </p>
        </div>
      </header>

      {sounds !== null && sounds.length === 0 && (
        <p className="dash-empty">Nothing tracked yet — the sweep fills this as it reads.</p>
      )}

      {sounds !== null && sounds.length > 0 && (
        <ol className="snd-list">
          {sounds.map((sound, index) => {
            const up = sound.creators_now > sound.creators_before
            const down = sound.creators_before > sound.creators_now
            return (
              <li key={sound.audio_id} className="snd-row">
                <span className="wk-n">{String(index + 1).padStart(2, '0')}</span>
                <span className="snd-main">
                  <span className="snd-title">
                    {sound.title ?? 'Untitled audio'}
                    {sound.artist && <em> · {sound.artist}</em>}
                  </span>
                  {sound.top_plays !== null && (
                    <span className="snd-plays">{compact(Number(sound.top_plays))} plays at best</span>
                  )}
                </span>
                <span className="snd-count"><b>{sound.creators_now}</b> creator{sound.creators_now === 1 ? '' : 's'}</span>
                <span className="snd-delta" data-trend={up ? 'up' : down ? 'down' : undefined}>
                  {up ? `▲ up from ${sound.creators_before}` : down ? `▼ was ${sound.creators_before}` : 'holding'}
                </span>
                {sound.example && (
                  <a className="pill" href={sound.example} target="_blank" rel="noreferrer">Hear it</a>
                )}
              </li>
            )
          })}
        </ol>
      )}
    </div>
  )
}
