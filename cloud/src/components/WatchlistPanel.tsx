'use client'

import { useCallback, useEffect, useState } from 'react'

/**
 * The watchlist, as a thing you can add to.
 *
 * Until now the watched accounts were whatever had been pasted into the queue
 * at some point — the list grew by accident. Two deliberate ways in:
 *
 *   paste      — handles or profile links, in bulk. This is how the sweep
 *                reaches past the obvious: a comedian, a cooking account, a
 *                cleaning page. We copy the *format*, and the format travels
 *                between niches far better than the subject does.
 *   suggested  — accounts that collaborated on a reel the sweep picked. They
 *                sit here, costing nothing, until someone says watch.
 */
type Suggested = { handle: string; found_via: string | null; seen: number }
type Counts = { watching: number; suggested: number; gated: number }

export default function WatchlistPanel() {
  const [suggested, setSuggested] = useState<Suggested[]>([])
  const [counts, setCounts] = useState<Counts | null>(null)
  const [paste, setPaste] = useState('')
  const [busy, setBusy] = useState(false)
  const [said, setSaid] = useState<string | null>(null)
  const [open, setOpen] = useState(false)

  const load = useCallback(async () => {
    const response = await fetch('/api/creators/watchlist')
    if (!response.ok) return
    const body = await response.json()
    setSuggested(body.suggested ?? [])
    setCounts(body.counts ?? null)
  }, [])

  useEffect(() => { void load() }, [load])

  const send = useCallback(
    async (payload: { add?: string; dismiss?: string[] }) => {
      setBusy(true)
      const response = await fetch('/api/creators/watchlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const body = response.ok ? await response.json() : null
      setBusy(false)
      if (!body) return setSaid('That did not save.')
      if (body.added) setSaid(`Watching ${body.added} more — the next sweep reads them.`)
      if (body.dismissed) setSaid(`Dismissed ${body.dismissed}.`)
      setPaste('')
      await load()
    },
    [load],
  )

  return (
    <section className="watchlist">
      <button className="watchlist-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span>Watchlist</span>
        {counts && (
          <span className="watchlist-counts">
            {counts.watching} watched · {counts.gated} need the burner
            {counts.suggested > 0 && ` · ${counts.suggested} suggested`}
          </span>
        )}
        <span aria-hidden>{open ? '−' : '+'}</span>
      </button>

      {open && (
        <div className="watchlist-body">
          <label className="watchlist-add">
            <span>Add accounts — handles or profile links, any separator</span>
            <textarea
              value={paste}
              onChange={(event) => setPaste(event.target.value)}
              placeholder="@comedian.page  instagram.com/chef_mike  cleaning.tok"
              rows={3}
            />
          </label>
          <div className="watchlist-actions">
            <button
              className="pill"
              disabled={busy || paste.trim().length === 0}
              onClick={() => void send({ add: paste })}
            >
              Watch these
            </button>
            {said && <span className="watchlist-said">{said}</span>}
          </div>

          {suggested.length > 0 && (
            <>
              <p className="watchlist-note">
                Found on reels the sweep picked. Nothing is swept until you say so.
              </p>
              <ul className="watchlist-suggested">
                {suggested.map((one) => (
                  <li key={one.handle}>
                    <a href={`https://instagram.com/${one.handle}`} target="_blank" rel="noreferrer">
                      @{one.handle}
                    </a>
                    {one.found_via && <span>with @{one.found_via}</span>}
                    <button className="pill" disabled={busy} onClick={() => void send({ add: one.handle })}>
                      Watch
                    </button>
                    <button
                      className="pill"
                      disabled={busy}
                      onClick={() => void send({ dismiss: [one.handle] })}
                    >
                      Not for us
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </section>
  )
}
