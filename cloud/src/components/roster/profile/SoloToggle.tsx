'use client'

import { useEffect, useState } from 'react'
import { put, useLive } from '@/lib/live'

/**
 * Films alone, or with other people. Saves on the tap, on its own route, so it
 * never rides the profile's Save.
 */
export default function SoloToggle({ modelId }: { modelId: string }) {
  const url = `/api/models/${modelId}/solo`
  const live = useLive<{ solo: boolean }>(url)
  const [solo, setSolo] = useState<boolean | null>(null)
  const [error, setError] = useState<string | null>(null)

  // The cached read seeds the draft; the draft is what an optimistic tap edits.
  useEffect(() => {
    if (live.data) setSolo(live.data.solo !== false)
  }, [live.data])

  async function choose(next: boolean) {
    if (next === solo) return
    const previous = solo
    setSolo(next)
    setError(null)
    const response = await fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ solo: next }),
    }).catch(() => null)
    if (!response?.ok) {
      setSolo(previous)
      setError('That did not save — try again.')
    } else {
      put(url, { solo: next })
    }
  }

  const failed = error ?? (live.error ? 'Could not load this setting.' : null)

  return (
    <div className="form-row">
      <span className="axis-name">Who is on camera</span>
      <div className="chips" role="group" aria-label="Who is on camera">
        {([[true, 'Films solo'], [false, 'Films with others too']] as const).map(([value, label]) => (
          <button
            key={label}
            className="chip"
            data-on={solo === value}
            aria-pressed={solo === value}
            disabled={solo === null}
            onClick={() => void choose(value)}
          >
            {label}
          </button>
        ))}
      </div>
      <span className="hint" data-tone={failed ? 'bad' : undefined}>
        {failed ?? (solo === false
          ? 'Couple and group reels can go on their week.'
          : 'Reels that need someone else on camera are never added to their week, and ones already there are hidden from them unless they took them on.')}
      </span>
    </div>
  )
}
