'use client'

import { useEffect, useState } from 'react'
import { formatDate } from '@/lib/dates'

/** One repurposed file, as GET /api/models/[id]/repurpose returns it. */
export type RepurposeRow = {
  id: string
  post_id: string
  code: string | null
  status: 'marked' | 'queued' | 'rendering' | 'ready' | 'failed'
  destination: 'trial' | 'main' | 'both'
  seed: number | null
  created_at: string | null
  rendered_at: string | null
  error: string | null
  bytes: number | null
  upload_date: string | null
  has_thumb: boolean
  source_url: string | null
  video: string | null
  download: string | null
}

export type RepurposedPayload = { repurposes: RepurposeRow[]; working: boolean; mac: boolean }

/** How long the section waits between looks while a render is in flight. */
const CHECK_MS = 15_000

const STATUS_WORDS: Record<RepurposeRow['status'], string> = {
  marked: 'Marked — render it again to get the file',
  queued: 'Queued for the studio',
  rendering: 'Rendering on the studio',
  ready: 'Fresh file',
  failed: 'Render failed',
}

/**
 * Her repurposed files — the ♻ results, saved here (Geno, 2026-10-18).
 *
 * The render happens on the Mac (`src/repurpose.py`): mirrored, re-cut,
 * re-encoded, metadata scrubbed, so nothing Instagram holds can match it to
 * the original. This section is where the result lives — play it, download
 * it, send it back to her; a render still in flight polls itself rather than
 * asking anyone to refresh.
 */
export default function RepurposedReels({
  modelId,
  data,
  reload,
}: {
  modelId: string
  data: RepurposedPayload | null
  reload: () => void
}) {
  const [playing, setPlaying] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const working = data?.working ?? false

  useEffect(() => {
    if (!working) return
    const timer = setInterval(reload, CHECK_MS)
    return () => clearInterval(timer)
  }, [working, reload])

  /** Take one back: the mark goes, and the rendered file is reclaimed with it. */
  async function unmark(row: RepurposeRow) {
    setBusy(row.id)
    await fetch(`/api/models/${modelId}/posts/${row.post_id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'unrepurpose' }),
    }).catch(() => null)
    setBusy(null)
    setPlaying(null)
    reload()
  }

  /** A row from before renders existed, or one that failed: queue it again.
   *  Same route the winners strip uses, so the seed and the key are minted
   *  the same way. */
  async function requeue(row: RepurposeRow) {
    setBusy(row.id)
    await fetch(`/api/models/${modelId}/posts/${row.post_id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'repurpose' }),
    }).catch(() => null)
    setBusy(null)
    reload()
  }

  const rows = data?.repurposes ?? []
  const waitingOnMac = Boolean(data && !data.mac && rows.some((row) => row.status === 'queued'))

  return (
    <section className="reels-row" data-tone="repost">
      <header>
        <h3>Repurposed <span>{rows.length}</span></h3>
        <p>
          Fresh files rendered by the studio — mirrored, re-cut, re-encoded.
          Nothing Instagram can match to the original. Send one back and she posts it again.
        </p>
      </header>
      {!data ? (
        <p className="hint">Loading the repurposed files…</p>
      ) : rows.length === 0 ? (
        <p className="hint">Nothing yet. Tap ♻ Repurpose on a winner and the studio renders it here.</p>
      ) : (
        <ul className="repostlist">
          {rows.map((row) => (
            <li key={row.id} className="repostrow" data-status={row.status}>
              {row.has_thumb ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img className="repostrow-thumb" src={`/api/thumb/${row.post_id}`} alt="" width={44} height={55} loading="lazy" />
              ) : (
                <span className="repostrow-thumb repostrow-thumb-blank" aria-hidden="true" />
              )}
              <div className="repostrow-id">
                <p className="repostrow-what">
                  {STATUS_WORDS[row.status] ?? row.status}
                  {row.status === 'ready' && row.bytes ? <span className="hint"> · {(row.bytes / 1e6).toFixed(1)} MB</span> : null}
                </p>
                <p className="repostrow-meta">
                  {[
                    row.status === 'ready' && row.rendered_at ? `cut ${formatDate(row.rendered_at.slice(0, 10))}` : null,
                    row.upload_date ? `from their reel of ${formatDate(row.upload_date)}` : null,
                    row.destination === 'both' ? 'trial + main' : row.destination,
                  ].filter(Boolean).join(' · ')}
                </p>
                {row.status === 'failed' && row.error ? <p className="repostrow-error">{row.error}</p> : null}
              </div>
              <div className="repostrow-acts">
                {row.status === 'ready' && row.video ? (
                  <button type="button" className="dash-reel-action" onClick={() => setPlaying(playing === row.id ? null : row.id)}>
                    {playing === row.id ? 'Hide' : 'Play'}
                  </button>
                ) : null}
                {row.status === 'ready' && row.download ? (
                  <a className="dash-reel-action" href={row.download}>Download</a>
                ) : null}
                {row.status === 'marked' || row.status === 'failed' ? (
                  <button type="button" className="dash-reel-action" disabled={busy === row.id} onClick={() => void requeue(row)}>
                    {busy === row.id ? 'Queueing…' : 'Render it'}
                  </button>
                ) : null}
                {row.code ? (
                  <a
                    className="repostrow-source"
                    href={row.source_url ?? `https://www.instagram.com/reel/${row.code}/`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Their post ↗
                  </a>
                ) : null}
                <button type="button" className="repostrow-unmark" disabled={busy === row.id} onClick={() => void unmark(row)}>
                  {busy === row.id ? 'Removing…' : 'Remove'}
                </button>
              </div>
              {playing === row.id && row.video ? (
                <div className="repostrow-player">
                  {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                  <video
                    src={row.video}
                    poster={row.has_thumb ? `/api/thumb/${row.post_id}` : undefined}
                    controls
                    playsInline
                    preload="metadata"
                  />
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {waitingOnMac ? <p className="hint">The Mac is offline — it renders this the moment it is back.</p> : null}
    </section>
  )
}
