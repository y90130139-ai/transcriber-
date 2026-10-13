'use client'

import { useCallback, useMemo, useState } from 'react'
import type { WatchlistData, WatchlistCounts, WatchlistSuggested, WatchlistWatched } from '@/lib/watchlist'

/**
 * The watchlist, as a page you can run.
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
 *
 * The redesign (2026-10-07): counts as stat cards, suggestions as a panel of
 * rows with real buttons and a search, the add box in a side rail, and the
 * watched accounts finally visible below — the page used to be one flat wall
 * of seventy-five handles with no way to see what was actually being read.
 *
 * Now server-fed (2026-10-13): the page hands in `initial` from the same
 * loadWatchlist() the route uses, so the first paint is the real list.
 */

const dateOf = (value: string | null) => {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? null
    : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export default function WatchlistPanel({ initial }: { initial: WatchlistData }) {
  const [suggested, setSuggested] = useState<WatchlistSuggested[]>(initial.suggested)
  const [watching, setWatching] = useState<WatchlistWatched[]>(initial.watching)
  const [counts, setCounts] = useState<WatchlistCounts>(initial.counts)
  const [paste, setPaste] = useState('')
  const [busy, setBusy] = useState(false)
  const [said, setSaid] = useState<string | null>(null)
  const [find, setFind] = useState('')
  const [findWatched, setFindWatched] = useState('')

  /** After a mutation only — first paint never waits on this. */
  const load = useCallback(async () => {
    const response = await fetch('/api/creators/watchlist')
    if (!response.ok) return
    const body = await response.json()
    setSuggested(body.suggested ?? [])
    setWatching(body.watching ?? [])
    if (body.counts) setCounts(body.counts)
  }, [])

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

  const shownSuggested = useMemo(() => {
    const needle = find.trim().toLowerCase()
    if (!needle) return suggested
    return suggested.filter((one) =>
      one.handle.toLowerCase().includes(needle) || (one.found_via ?? '').toLowerCase().includes(needle))
  }, [suggested, find])

  const shownWatching = useMemo(() => {
    const needle = findWatched.trim().toLowerCase()
    if (!needle) return watching
    return watching.filter((one) => one.handle.toLowerCase().includes(needle))
  }, [watching, findWatched])

  const watchAllShown = () => {
    if (shownSuggested.length > 10 &&
        !confirm(`Watch all ${shownSuggested.length} accounts shown? The sweep will read every one of them.`)) return
    void send({ add: shownSuggested.map((one) => one.handle).join('\n') })
  }

  const suggestedTotal = counts.suggested
  const watchingTotal = counts.watching

  return (
    <>
      <section className="dash-stats watch-stats" aria-label="Watchlist at a glance">
        <article className="dash-stat">
          <h3>Watching</h3>
          <p className="dash-stat-value">{counts.watching}</p>
          <p className="dash-stat-note">read by the sweep every week</p>
        </article>
        <article className="dash-stat" data-warn={counts.gated > 0 ? 'true' : undefined}>
          <h3>Need the burner</h3>
          <p className="dash-stat-value">{counts.gated}</p>
          <p className="dash-stat-note">gated accounts the sweep cannot read yet</p>
        </article>
        <article className="dash-stat">
          <h3>Suggested</h3>
          <p className="dash-stat-value">{counts.suggested}</p>
          <p className="dash-stat-note">picked up from reels — say watch or no</p>
        </article>
      </section>

      <div className="watch-grid">
        <section className="watch-panel" aria-label="Suggested accounts">
          <header className="watch-head">
            <div className="watch-heading">
              <h3 className="watch-title">From reels the sweep picked</h3>
              <p className="watch-sub">Accounts that collaborated on a winner. They cost nothing until you say watch.</p>
            </div>
            <span className="watch-count">
              {suggested.length === suggestedTotal ? `${suggestedTotal} waiting` : `${suggested.length} of ${suggestedTotal}`}
            </span>
          </header>

          <div className="watch-toolbar">
            <label className="watch-search">
              <input
                value={find}
                onChange={(event) => setFind(event.target.value)}
                placeholder="Find a handle"
                aria-label="Find a suggested account"
              />
            </label>
            <button
              className="pill"
              disabled={busy || shownSuggested.length === 0}
              onClick={watchAllShown}
            >
              Watch all shown {shownSuggested.length > 0 && `(${shownSuggested.length})`}
            </button>
          </div>

          {suggested.length === 0 ? (
            <p className="watch-empty">
              Nothing suggested right now — collaborators on a winner land here.
            </p>
          ) : shownSuggested.length === 0 ? (
            <p className="watch-empty">No handle matches that.</p>
          ) : (
            <ul className="watch-list">
              {shownSuggested.map((one) => (
                <li key={one.handle} className="watch-row">
                  <div className="watch-who">
                    <a className="watch-handle" href={`https://instagram.com/${one.handle}`} target="_blank" rel="noreferrer">
                      @{one.handle}
                    </a>
                    <span className="watch-meta">
                      {one.found_via && <>with @{one.found_via} · </>}
                      {one.seen} sighting{one.seen === 1 ? '' : 's'}
                    </span>
                  </div>
                  <div className="watch-actions">
                    <button className="pill" disabled={busy} onClick={() => void send({ add: one.handle })}>
                      Watch
                    </button>
                    <button className="pill" disabled={busy} onClick={() => void send({ dismiss: [one.handle] })}>
                      Not for us
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <aside className="watch-panel" aria-label="Add accounts">
          <header className="watch-head">
            <div className="watch-heading">
              <h3 className="watch-title">Add accounts</h3>
              <p className="watch-sub">Handles or profile links, any separator.</p>
            </div>
          </header>
          <div className="watch-add-body">
            <label className="watch-field">
              <span className="watch-field-label">Handles or profile links</span>
              <textarea
                value={paste}
                onChange={(event) => setPaste(event.target.value)}
                placeholder={'@comedian.page\ninstagram.com/chef_mike\ncleaning.tok'}
                rows={5}
              />
            </label>
            <button
              className="pill"
              data-primary={paste.trim().length > 0 || undefined}
              disabled={busy || paste.trim().length === 0}
              onClick={() => void send({ add: paste })}
            >
              Watch these
            </button>
            {said && <p className="watch-said" role="status">{said}</p>}
          </div>
        </aside>
      </div>

      <section className="watch-panel watch-watching" aria-label="Watched accounts">
        <header className="watch-head">
          <div className="watch-heading">
            <h3 className="watch-title">Watching</h3>
            <p className="watch-sub">Every account the weekly sweep reads.</p>
          </div>
          <span className="watch-count">
            {findWatched.trim() ? `${shownWatching.length} of ${watching.length}` : `${watchingTotal} accounts`}
          </span>
        </header>

        <div className="watch-toolbar">
          <label className="watch-search">
            <input
              value={findWatched}
              onChange={(event) => setFindWatched(event.target.value)}
              placeholder="Find a watched handle"
              aria-label="Find a watched account"
            />
          </label>
        </div>

        {watching.length === 0 ? (
          <p className="watch-empty">Nothing watched yet — paste handles above or take a suggestion.</p>
        ) : shownWatching.length === 0 ? (
          <p className="watch-empty">No watched handle matches that.</p>
        ) : (
          <ul className="watch-list watch-list-watching">
            {shownWatching.map((one) => (
              <li key={one.handle} className="watch-row">
                <div className="watch-who">
                  <a className="watch-handle" href={`https://instagram.com/${one.handle}`} target="_blank" rel="noreferrer">
                    @{one.handle}
                  </a>
                  <span className="watch-meta" data-gated={one.access === 'gated' || undefined}>
                    {one.access === 'gated' ? 'needs the burner' : 'open'}
                    {dateOf(one.updated_at) && <> · added {dateOf(one.updated_at)}</>}
                  </span>
                </div>
                <div className="watch-actions">
                  <button className="pill" disabled={busy} onClick={() => void send({ dismiss: [one.handle] })}>
                    Stop watching
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}

        {!findWatched.trim() && watching.length < watchingTotal && (
          <p className="watch-empty">Showing the {watching.length} most recently added.</p>
        )}
      </section>
    </>
  )
}
