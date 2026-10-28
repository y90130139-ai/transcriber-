'use client'

import { useMemo, useState } from 'react'
import type { FunnelView, Reading, State } from '@/lib/funnel'

/** The funnel, arranged so the first screen answers "what do I do".
 *
 *  Everything below the action list is reference. It is good reference — the
 *  whole roster, what each account is actually showing, what changed — but it
 *  is deliberately second, because a page that opens on sixty rows gets read
 *  once and never again.
 */

const money = (cents: number | null | undefined) =>
  cents == null ? '—' : `$${Math.round(cents / 100).toLocaleString('en-US')}`

const people = (n: number | null | undefined) =>
  n == null ? '—' : n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : String(n)

const SAYS: Record<State, string> = {
  green: 'link live',
  amber: 'unverified',
  red: 'nothing up',
  unknown: 'unread',
}

const host = (url: string | null) =>
  !url ? null : url.replace(/^https?:\/\//, '').replace(/\/$/, '')

type Filter = 'all' | 'red' | 'amber' | 'green' | 'story'

export default function FunnelPanel({ view }: { view: FunnelView }) {
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return view.readings.filter((r) => {
      if (filter === 'story' ? !r.has_story : filter !== 'all' && r.state !== filter) return false
      if (!needle) return true
      return r.handle.toLowerCase().includes(needle) || (r.creator ?? '').toLowerCase().includes(needle)
    })
  }, [view.readings, filter, query])

  if (!view.day) {
    return (
      <p className="fn-empty">
        No reading yet. The scan runs on the Mac at 08:00 and pushes the day up when it finishes.
      </p>
    )
  }

  const t = view.tally
  const top = view.actions.slice(0, 5)

  return (
    <>
      {/* ---- what to do, before anything else ---- */}
      <section className="fn-do" aria-labelledby="fn-do-h">
        <h3 className="fn-do-h" id="fn-do-h">Do these first</h3>
        {top.length === 0 ? (
          <p className="fn-empty">Every account that was read has a link live. Nothing to chase.</p>
        ) : (
          <ol className="fn-do-list">
            {top.map((a) => (
              <li key={a.creator} className="fn-do-row" data-kind={a.kind}>
                <span className="fn-do-rank" aria-hidden="true" />
                <span className="fn-do-main">
                  <b className="fn-do-who">{a.creator}</b>
                  <span className="fn-do-why">{a.why}</span>
                  <span className="fn-do-handles">
                    {a.handles.map((h) => (
                      <a key={h} href={`https://www.instagram.com/${h.replace(/^@/, '')}/`}
                         target="_blank" rel="noopener noreferrer" className="fn-handle">{h}</a>
                    ))}
                  </span>
                </span>
                <span className="fn-do-cost">
                  <b>{a.lostPerWeek ? `−${money(a.lostPerWeek)}` : '—'}</b>
                  <i>a week · {people(a.followers)} followers</i>
                </span>
                <span className="fn-do-owner" data-owner={a.owner}>
                  {a.owner === 'her' ? 'ask her' : a.owner}
                </span>
              </li>
            ))}
          </ol>
        )}
        {view.actions.length > top.length && (
          <p className="fn-do-more">{view.actions.length - top.length} more below.</p>
        )}
      </section>

      {/* ---- the shape of it, in one line of numbers ---- */}
      <section className="fn-band" aria-label="Funnel at a glance">
        <div><span className="fn-k">Link live now</span><b className={t.green ? 'ok' : 'bad'}>{t.green} / {t.scanned}</b>
          <i>{people(t.litFollowers)} followers can reach a page</i></div>
        <div><span className="fn-k">No way through</span><b className="bad">{t.red + t.amber}</b>
          <i>{people(t.darkFollowers)} followers behind them</i></div>
        <div><span className="fn-k">Story up</span><b>{t.stories}</b><i>of {t.scanned} read</i></div>
        <div><span className="fn-k">Read</span><b>{view.day}</b><i>on the burner, once a day</i></div>
      </section>

      {/* ---- the whole roster, for when the answer is not above ---- */}
      <div className="fn-controls">
        {(['all', 'red', 'amber', 'green', 'story'] as Filter[]).map((f) => (
          <button key={f} type="button" onClick={() => setFilter(f)}
                  aria-pressed={filter === f} className="fn-chip">
            {f === 'all' ? `All ${view.readings.length}`
              : f === 'story' ? `Story up (${t.stories})`
                : `${SAYS[f as State]} (${t[f as State]})`}
          </button>
        ))}
        <input className="fn-find" type="search" value={query} placeholder="Find a handle or creator"
               aria-label="Find a handle or creator" onChange={(e) => setQuery(e.target.value)} />
      </div>

      <div className="fn-tablewrap">
        <table className="fn-table">
          <thead>
            <tr>
              <th>Handle</th><th>Creator</th><th>Instagram now</th>
              <th className="r">Followers</th><th>Changed</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => <Row key={`${r.handle}-${r.creator ?? ''}`} r={r} />)}
            {rows.length === 0 && (
              <tr><td colSpan={5} className="fn-empty">Nothing matches that.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  )
}

function Row({ r }: { r: Reading }) {
  const site = host(r.bio_url)
  const bits = [
    r.has_story ? 'story up' : null,
    r.highlights ? `${r.highlights} highlight${r.highlights === 1 ? '' : 's'}` : null,
  ].filter(Boolean)
  return (
    <tr>
      <td>
        <a className="fn-handle" href={`https://www.instagram.com/${r.handle}/`}
           target="_blank" rel="noopener noreferrer">@{r.handle}</a>
      </td>
      <td className="fn-creator">{r.creator ?? <span className="fn-dim">unmatched</span>}</td>
      <td>
        <span className="fn-state" data-state={r.state}>{SAYS[r.state]}</span>
        {site && (
          <a className="fn-url" href={r.bio_url ?? '#'} target="_blank" rel="noopener noreferrer">{site}</a>
        )}
        {bits.length > 0 && <span className="fn-dim">{bits.join(' · ')}</span>}
      </td>
      <td className="r fn-num">{people(r.followers)}</td>
      <td>
        {/* A move out of `unknown` is the baseline filling in, not news. */}
        {r.was && r.was !== r.state && r.was !== 'unknown'
          ? <span className="fn-moved">{SAYS[r.was]} → {SAYS[r.state]}</span>
          : <span className="fn-dim">—</span>}
      </td>
    </tr>
  )
}
