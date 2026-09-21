'use client'

import { useState } from 'react'
import { formatDate } from '@/lib/dates'
import {
  PLATFORMS, labelOfPlatform, readCount, showCount, withImpliedInstagram,
  type Platform, type Social,
} from '@/lib/socials'
import type { Reading } from './reach'

/**
 * Record a follower count, and see the ones already recorded.
 *
 * A reading, never a field. Overwriting one number with a bigger one answers
 * "how big is she" and throws away the only thing that says whether the work is
 * working. So every entry is an insert, a correction is a second insert, and a
 * typo is deleted rather than edited.
 *
 * Saved immediately rather than with the rest of the sheet: it is not an edit
 * to her profile, it is an observation with a timestamp, and holding it until
 * somebody remembers to press Save would stamp it with the wrong day.
 */
export default function FollowerLog({
  modelId,
  socials,
  handle,
  readings,
  onRecorded,
}: {
  /** Null while she is being created — there is nowhere to write a reading
   *  until she has an id, and the box says so rather than failing on submit. */
  modelId: string | null
  socials: Social[]
  handle: string
  readings: Reading[]
  onRecorded: () => void
}) {
  const accounts = withImpliedInstagram(socials, handle || null)
  const [platform, setPlatform] = useState<Platform>(accounts[0]?.platform ?? 'instagram')
  const [count, setCount] = useState('')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)

  const parsed = readCount(count)

  async function record() {
    if (!modelId || parsed === null) return
    setBusy(true)
    setNote(null)
    const response = await fetch(`/api/models/${modelId}/followers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ platform, followers: parsed }),
    })
    setBusy(false)
    if (!response.ok) {
      const body = await response.json().catch(() => ({}))
      setNote(body.error ?? 'Could not record that.')
      return
    }
    setCount('')
    onRecorded()
  }

  async function drop(id: string) {
    if (!modelId) return
    setBusy(true)
    await fetch(`/api/models/${modelId}/followers?reading=${encodeURIComponent(id)}`, {
      method: 'DELETE',
    })
    setBusy(false)
    onRecorded()
  }

  return (
    <div className="axis">
      <div className="axis-head">
        <span className="axis-name">Followers</span>
        <span className="hint">{readings.length} recorded</span>
      </div>

      {modelId === null ? (
        <span className="hint">Add her first, then her numbers can be logged.</span>
      ) : (
        <>
          <div className="socialrow">
            <select
              className="field"
              aria-label="Which account"
              value={platform}
              onChange={(event) => setPlatform(event.target.value as Platform)}
            >
              {/* Her own accounts first, then the rest — logging a platform she
                  is not on is possible but should not be the easy path. */}
              {accounts.length > 0 && (
                <optgroup label="Hers">
                  {/* One option per platform, not per account: a reading is
                      stored against the platform, and a model running three
                      Instagrams would otherwise offer "Instagram" three
                      indistinguishable times — which React also rejects as a
                      duplicate key. Her per-account followers come from the
                      roster pass instead, on the scorecards above. */}
                  {[...new Set(accounts.map((account) => account.platform))].map((one) => (
                    <option key={`own-${one}`} value={one}>{labelOfPlatform(one)}</option>
                  ))}
                </optgroup>
              )}
              <optgroup label="Anywhere else">
                {PLATFORMS.filter((one) => !accounts.some((account) => account.platform === one))
                  .map((one) => (
                    <option key={one} value={one}>{labelOfPlatform(one)}</option>
                  ))}
              </optgroup>
            </select>
            <input
              className="field"
              aria-label="How many followers"
              value={count}
              placeholder="128.4k, or 128400"
              inputMode="decimal"
              onChange={(event) => setCount(event.target.value)}
              onKeyDown={(event) => { if (event.key === 'Enter') void record() }}
            />
            <button className="btn" disabled={busy || parsed === null} onClick={() => void record()}>
              Record
            </button>
          </div>
          <span className="hint" data-tone={note ? 'bad' : undefined}>
            {note
              ?? (count && parsed === null
                ? 'That is not a number I can read.'
                : parsed !== null
                  ? `Recording ${parsed.toLocaleString('en-US')} against today.`
                  : 'Whatever her profile says, as it says it. Typed by hand until App Review clears.')}
          </span>

          {readings.length > 0 && (
            <ul className="readings">
              {readings.slice(0, 8).map((reading) => (
                <li key={reading.id}>
                  <b>{showCount(reading.followers)}</b>
                  <span>
                    {labelOfPlatform(reading.platform)} · {formatDate(reading.taken_at.slice(0, 10))}
                    {reading.source === 'insights' && ' · from Insights'}
                  </span>
                  <button
                    className="axis-confirm"
                    disabled={busy}
                    onClick={() => void drop(reading.id)}
                    aria-label="Remove this reading"
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  )
}
