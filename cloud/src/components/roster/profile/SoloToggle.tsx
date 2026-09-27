'use client'

import { useEffect, useState } from 'react'

/**
 * Films alone, or with other people. Saves on the tap, on its own route, so it
 * never rides the profile's Save.
 */
export default function SoloToggle({ modelId }: { modelId: string }) {
  const [solo, setSolo] = useState<boolean | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    fetch(`/api/models/${modelId}/solo`)
      .then((response) => response.ok ? response.json() : Promise.reject(new Error(String(response.status))))
      .then((body) => { if (live) setSolo(body.solo !== false) })
      .catch(() => { if (live) setError('Could not load this setting.') })
    return () => { live = false }
  }, [modelId])

  async function choose(next: boolean) {
    if (next === solo) return
    const previous = solo
    setSolo(next)
    setError(null)
    const response = await fetch(`/api/models/${modelId}/solo`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ solo: next }),
    }).catch(() => null)
    if (!response?.ok) {
      setSolo(previous)
      setError('That did not save — try again.')
    }
  }

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
      <span className="hint" data-tone={error ? 'bad' : undefined}>
        {error ?? (solo === false
          ? 'Couple and group reels can go on their week.'
          : 'Reels that need someone else on camera are never added to their week, and ones already there are hidden from them unless they took them on.')}
      </span>
    </div>
  )
}
