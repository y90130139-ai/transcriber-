'use client'

import { useCallback, useEffect, useState } from 'react'

/**
 * Sounds several watched creators picked up lately, rising first.
 *
 * A trend reaches an audio track before it reaches any one creator's numbers,
 * so this is the earliest thing the sweep can show. "3 creators, up from 1"
 * is a reason to use a sound this week; the same sound at 12 creators for a
 * month is one to avoid.
 */
type Sound = {
  audio_id: string
  title: string | null
  artist: string | null
  creators_now: number
  creators_before: number
  top_plays: number | string | null
  example: string | null
}

export default function SoundsPanel() {
  const [sounds, setSounds] = useState<Sound[]>([])
  const [open, setOpen] = useState(false)

  const load = useCallback(async () => {
    const response = await fetch('/api/scout/sounds')
    if (response.ok) setSounds((await response.json()).sounds ?? [])
  }, [])

  useEffect(() => { void load() }, [load])

  if (sounds.length === 0) return null

  return (
    <section className="sounds">
      <button className="sounds-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span>Sounds going round</span>
        <span className="sounds-count">{sounds.length} in the last fortnight</span>
        <span aria-hidden>{open ? '−' : '+'}</span>
      </button>
      {open && (
        <ul className="sounds-list">
          {sounds.map((sound) => {
            const rising = sound.creators_now > sound.creators_before
            return (
              <li key={sound.audio_id}>
                <span className="sounds-title">
                  {sound.title ?? 'Untitled audio'}
                  {sound.artist && <em> · {sound.artist}</em>}
                </span>
                <span className="sounds-meta">
                  {sound.creators_now} creator{sound.creators_now === 1 ? '' : 's'}
                  {rising
                    ? ` · up from ${sound.creators_before}`
                    : sound.creators_before > sound.creators_now
                      ? ` · was ${sound.creators_before}`
                      : ''}
                </span>
                {sound.example && (
                  <a href={sound.example} target="_blank" rel="noreferrer">hear it</a>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
