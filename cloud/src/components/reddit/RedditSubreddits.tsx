'use client'

import Link from 'next/link'
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { SubredditRow } from '@/lib/reddit/types'
import type { CompareRow } from '@/lib/reddit/queries'
import { REGISTRY_CATEGORIES } from '@/lib/reddit/registry'
import { CONFIDENCE_LABEL, CONFIDENCE_NOTE } from '@/lib/reddit/requirements'
import DropSelect from '../dashboard/DropSelect'
import Sparkline from '../dashboard/Sparkline'
import { compact, timeAgo } from './bits'
import { useJson } from './useReddit'

/** The board row: tracker columns where trend collection follows the
 *  community, gates columns everywhere — the union of both registries. */
type BoardRow = SubredditRow & { tracked: boolean }

type ListPayload = {
  rows: BoardRow[]
  categories: string[]
  registry: { candidates: number; unique: number; untracked: number }
  untracked: { name: string; category: string; adult: boolean }[]
}

const STATUS_TONE: Record<string, string> = {
  active: 'ok', pending: 'idle', unavailable: 'bad', restricted: 'warn',
  quarantined: 'warn', error: 'bad', disabled: 'idle',
}

const CONFIDENCE_TONE: Record<string, string> = {
  verified: 'ok', high: 'ok', medium: 'idle', low: 'warn', insufficient: 'idle',
}

/** How long the add popup's fade-out runs before it unmounts. */
const ADD_CLOSE_MS = 180

function number(value: number | null) {
  return value === null ? <span className="rt-dim">—</span> : compact(value)
}

/** Community tracking: what we watch, how each one is behaving, and the
 *  controls — add, pause, prioritise, remove, compare. */
export default function RedditSubreddits() {
  const { data, error, loading, reload } = useJson<ListPayload>('/api/reddit/subreddits')
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('')
  const [status, setStatus] = useState('')
  const [selected, setSelected] = useState<string[]>([])
  const [compareOpen, setCompareOpen] = useState(false)
  const [adding, setAdding] = useState(false)
  const [addClosing, setAddClosing] = useState(false)
  const [addInput, setAddInput] = useState('')
  const [addCategory, setAddCategory] = useState<string>(REGISTRY_CATEGORIES[0])
  const [addError, setAddError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [visible, setVisible] = useState(300)

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return (data?.rows ?? [])
      .filter((row) => (category ? row.category === category : true))
      .filter((row) => (status ? row.tracked && row.status === status : true))
      .filter((row) => (needle ? row.id.includes(needle) || (row.title ?? '').toLowerCase().includes(needle) : true))
  }, [data, query, category, status])

  const counts = useMemo(() => {
    const all = data?.rows ?? []
    const tracked = all.filter((row) => row.tracked)
    const gateStamps = all
      .map((row) => row.gates?.last_collected_at)
      .filter((value): value is string => Boolean(value))
      .sort()
    return {
      total: all.length,
      tracked: tracked.length,
      active: tracked.filter((row) => row.status === 'active').length,
      paused: tracked.filter((row) => row.paused).length,
      gatesAt: gateStamps.length ? gateStamps[gateStamps.length - 1] : null,
    }
  }, [data])

  function toggleExpanded(id: string) {
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const compareUrl = selected.length >= 2 ? `/api/reddit/subreddits/compare?ids=${selected.join(',')}` : null

  /** The add popup (Geno, 2026-10-18): opens fresh, and every way out — the
   *  ×, Cancel, the veil, a successful add — fades before it unmounts, the
   *  same exit every dialog in the console uses. The pending timer is cleared
   *  on open, so reopening mid-fade is not cut short by the old close. */
  const addTimer = useRef<number | null>(null)
  const addClosingRef = useRef(false)

  const openAdd = useCallback(() => {
    if (addTimer.current !== null) {
      window.clearTimeout(addTimer.current)
      addTimer.current = null
    }
    addClosingRef.current = false
    setAddInput('')
    setAddError(null)
    setAddClosing(false)
    setAdding(true)
  }, [])

  const closeAdd = useCallback(() => {
    if (addClosingRef.current) return
    addClosingRef.current = true
    setAddClosing(true)
    addTimer.current = window.setTimeout(() => {
      addTimer.current = null
      addClosingRef.current = false
      setAdding(false)
      setAddClosing(false)
    }, ADD_CLOSE_MS)
  }, [])

  useEffect(() => {
    if (!adding) return
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') closeAdd()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [adding, closeAdd])

  async function addSubreddit() {
    setBusy(true)
    setNotice(null)
    setAddError(null)
    try {
      const response = await fetch('/api/reddit/subreddits', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: addInput, category: addCategory }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body?.error ?? `Request failed (${response.status})`)
      setNotice(`${body.subreddit?.display_name ? `r/${body.subreddit.display_name}` : addInput} added`)
      setAddInput('')
      reload()
      closeAdd()
    } catch (reason) {
      // Said inside the popup, where the fields are — the page notice sits
      // behind the veil.
      setAddError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy(false)
    }
  }

  /** One call for every selected community — move, prioritise, pause, remove. */
  async function bulk(action: string, value?: string) {
    if (!selected.length) return
    setBusy(true)
    setNotice(null)
    try {
      const response = await fetch('/api/reddit/subreddits/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: selected, action, value }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body?.error ?? `Request failed (${response.status})`)
      setNotice(`${action === 'remove' ? 'Removed' : 'Updated'} ${body.affected} communities`)
      if (action === 'remove') {
        setSelected([])
        setCompareOpen(false)
      }
      reload()
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy(false)
    }
  }

  async function act(url: string, method: string, body?: unknown, okMessage?: string) {
    setBusy(true)
    setNotice(null)
    try {
      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
      const parsed = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(parsed?.error ?? `Request failed (${response.status})`)
      if (okMessage) setNotice(okMessage)
      reload()
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy(false)
    }
  }

  async function validate() {
    setBusy(true)
    setNotice(null)
    try {
      const response = await fetch('/api/reddit/collect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'validate' }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body?.error ?? `Request failed (${response.status})`)
      setNotice(`validated ${body.result.subreddits} · ${body.result.errors} problems`)
      reload()
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rt-page">
      <div className="rt-toolbar">
        <div className="rt-toolbar-left">
          <span className="rt-stamp">{counts.total} communities · {counts.tracked} tracked · {counts.active} active · {counts.paused} paused{counts.gatesAt ? ` · rules read ${timeAgo(counts.gatesAt)}` : ''}</span>
        </div>
        <div className="rt-toolbar-right">
          <button type="button" className="rt-btn" onClick={openAdd}>
            + Add subreddit
          </button>
          <button type="button" className="rt-btn rt-btn-quiet" onClick={validate} disabled={busy}>Validate</button>
          <a className="rt-btn rt-btn-quiet" href="/api/reddit/dataset?export=subreddits" download>Export</a>
        </div>
      </div>

      {notice && <p className="rt-notice">{notice}</p>}
      {error && <div className="rt-error"><b>Could not load subreddits</b><p>{error}</p></div>}

      {selected.length > 0 && (
        <div className="rt-bulkbar">
          <b>{selected.length} selected</b>
          <DropSelect className="rt-dd" label="Move to category" value="" placeholder="Move to category…"
            disabled={busy}
            onChange={(value) => bulk('category', value)}
            options={(data?.categories ?? []).map((option) => ({ value: option, label: option }))} />
          <DropSelect className="rt-dd" label="Set priority" value="" placeholder="Set priority…"
            disabled={busy}
            onChange={(value) => bulk('priority', value)}
            options={[{ value: 'high', label: 'high' }, { value: 'medium', label: 'medium' }, { value: 'low', label: 'low' }]} />
          <button type="button" className="rt-btn rt-btn-quiet" disabled={busy} onClick={() => bulk('pause')}>Pause</button>
          <button type="button" className="rt-btn rt-btn-quiet" disabled={busy} onClick={() => bulk('resume')}>Resume</button>
          <button type="button" className="rt-btn rt-btn-quiet" disabled={busy || selected.length < 2}
            onClick={() => setCompareOpen(true)}>Compare</button>
          <button type="button" className="rt-btn rt-btn-danger" disabled={busy}
            onClick={() => {
              if (window.confirm(`Stop tracking ${selected.length} communities?`)) void bulk('remove')
            }}>Remove</button>
          <button type="button" className="rt-btn rt-btn-quiet" disabled={busy}
            onClick={() => { setSelected([]); setCompareOpen(false) }}>Clear</button>
        </div>
      )}

      {compareOpen && selected.length >= 2 && (
        <ComparePanel url={compareUrl} onClear={() => { setSelected([]); setCompareOpen(false) }} />
      )}

      <div className="rt-toolbar">
        <div className="rt-filters">
          <DropSelect className="rt-dd" label="Filter by category" value={category} onChange={setCategory}
            options={[{ value: '', label: 'All categories' }, ...(data?.categories ?? []).map((option) => ({ value: option, label: option }))]} />
          <DropSelect className="rt-dd" label="Filter by status" value={status} onChange={setStatus}
            options={[
              { value: '', label: 'Any status' },
              ...['active', 'pending', 'restricted', 'unavailable', 'error'].map((option) => ({ value: option, label: option })),
            ]} />
        </div>
        <div className="rt-toolbar-right">
          <form className="rt-searchform" onSubmit={(event) => event.preventDefault()}>
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8"
              strokeLinecap="round" aria-hidden>
              <circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" />
            </svg>
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search tracked…" aria-label="Search subreddits" />
          </form>
        </div>
      </div>

      <div className="rt-tablewrap">
        <table className="rt-table rt-mergetable">
          <thead>
            <tr>
              <th className="rt-col-check">
                <input type="checkbox" aria-label="Select all"
                  checked={rows.length > 0 && rows.every((row) => selected.includes(row.id))}
                  onChange={(event) => setSelected(event.target.checked ? rows.map((row) => row.id) : [])} />
              </th>
              <th>Subreddit</th>
              <th>Category</th>
              <th>Status</th>
              <th className="rt-col-num">Subscribers</th>
              <th className="rt-col-num" title="Lowest post karma among surviving posts">Min. post karma</th>
              <th className="rt-col-num" title="Lowest comment karma among surviving posts">Min. comment karma</th>
              <th className="rt-col-num" title="Shortest account age among surviving posts">Min. age</th>
              <th className="rt-col-num" title="Average total karma among survivors">Avg. karma</th>
              <th className="rt-col-num" title="From the sampled listings">Posts / day</th>
              <th title="Sample depth behind the gates">Verification</th>
              <th title="The posts that evidence the gates">Evidence</th>
              <th className="rt-col-num">Posts</th>
              <th className="rt-col-num">Engagement</th>
              <th className="rt-col-num" title="New posts per reading — the content collector's scans for tracked communities, the gates pass's visits (~2× a day) for the rest">Trend · readings</th>
              <th className="rt-col-num">Last sync</th>
              <th>Priority</th>
              <th className="rt-col-num">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, visible).map((row) => {
              const gates = row.gates ?? null
              const sources = row.gate_sources ?? []
              const open = expanded.has(row.id)
              return (
                <Fragment key={row.id}>
                  <tr>
                    <td className="rt-col-check">
                      <input type="checkbox" checked={selected.includes(row.id)} aria-label={`Compare r/${row.id}`}
                        onChange={(event) => setSelected((current) => event.target.checked
                          ? [...current, row.id].slice(0, 6)
                          : current.filter((id) => id !== row.id))} />
                    </td>
                    <td>
                      {row.tracked ? (
                        <Link href={`/reddit-trends/subreddits/${row.id}`}><b>r/{row.display_name}</b></Link>
                      ) : (
                        <a className="rt-link" href={`https://www.reddit.com/r/${row.id}/`} target="_blank" rel="noreferrer noopener">
                          <b>r/{row.display_name}</b>
                        </a>
                      )}
                    </td>
                    <td>
                      <DropSelect className="rt-dd rt-dd-sm" label={`Category for r/${row.id}`} value={row.category}
                        disabled={busy}
                      onChange={(next) => (row.tracked
                        ? act(`/api/reddit/subreddits/${row.id}`, 'PATCH', { category: next })
                        : act('/api/reddit/requirements', 'PATCH', { id: row.id, category: next }))}
                      options={(data?.categories ?? [row.category]).map((option) => ({ value: option, label: option }))}
                    />
                    </td>
                    <td>{row.tracked
                      ? <i className="rt-status" data-tone={STATUS_TONE[row.status] ?? 'idle'}
                        title={row.status_note ?? row.last_error ?? row.status}>{row.status}</i>
                      : <i className="rt-status" data-tone="idle"
                        title="In the gates registry only — the requirements pass samples its posting rules; trend collection does not follow it">gates only</i>}</td>
                    <td className="rt-col-num">{row.subscribers === null ? '—' : compact(row.subscribers)}</td>
                    <td className="rt-col-num">{number(gates?.min_post_karma ?? null)}</td>
                    <td className="rt-col-num">{number(gates?.min_comment_karma ?? null)}</td>
                    <td className="rt-col-num">{gates?.min_age_days === null || gates?.min_age_days === undefined
                      ? <span className="rt-dim">—</span> : `${gates.min_age_days}d`}</td>
                    <td className="rt-col-num">{number(gates?.avg_total_karma ?? null)}</td>
                    <td className="rt-col-num">{gates?.posts_per_day === null || gates?.posts_per_day === undefined
                      ? <span className="rt-dim">—</span> : gates.posts_per_day.toFixed(1)}</td>
                    <td>
                      {gates ? (
                        <i className="rt-status" data-tone={CONFIDENCE_TONE[gates.confidence] ?? 'idle'}
                          title={`${CONFIDENCE_NOTE[gates.confidence]} · ${gates.survivor_count} survivors, ${gates.filtered_count} filtered`}>
                          {CONFIDENCE_LABEL[gates.confidence]}
                        </i>
                      ) : <span className="rt-dim">—</span>}
                    </td>
                    <td>
                      {sources.length ? (
                        <button type="button" className="rt-link rt-evidencelink" onClick={() => toggleExpanded(row.id)}
                          aria-expanded={open}>
                          {sources.length} {sources.length === 1 ? 'post' : 'posts'}
                        </button>
                      ) : <span className="rt-dim">—</span>}
                    </td>
                    <td className="rt-col-num">{compact(row.posts_collected)}</td>
                    <td className="rt-col-num">{compact(row.engagement)}</td>
                    <td className="rt-col-num">
                      {row.spark && row.spark.length >= 2
                        ? <Sparkline values={row.spark} width={72} height={22} />
                        : <span className="rt-dim">—</span>}
                    </td>
                    <td className="rt-col-num rt-dim">{row.tracked ? timeAgo(row.last_synced_at) : '—'}</td>
                    <td>
                      <DropSelect className="rt-dd rt-dd-sm" label={`Priority for r/${row.id}`} value={row.priority}
                        disabled={busy}
                        onChange={(next) => (row.tracked
                          ? act(`/api/reddit/subreddits/${row.id}`, 'PATCH', { priority: next })
                          : act('/api/reddit/requirements', 'PATCH', { id: row.id, priority: next }))}
                        options={[{ value: 'high', label: 'high' }, { value: 'medium', label: 'medium' }, { value: 'low', label: 'low' }]} />
                    </td>
                    <td className="rt-col-num">
                      <span className="rt-actions">
                        {row.tracked && (
                          <button type="button" className="rt-mini" disabled={busy}
                            onClick={() => act(`/api/reddit/subreddits/${row.id}`, 'PATCH', { paused: !row.paused })}>
                            {row.paused ? 'Resume' : 'Pause'}
                          </button>
                        )}
                        <button type="button" className="rt-mini" data-tone="danger" disabled={busy}
                          onClick={() => {
                            const question = row.tracked
                              ? `Stop tracking r/${row.display_name}? Its gates stay on the board.`
                              : `Remove r/${row.display_name} from the gates registry? Its samples and jobs go too.`
                            if (!window.confirm(question)) return
                            if (row.tracked) {
                              void act(`/api/reddit/subreddits/${row.id}`, 'DELETE', undefined, `r/${row.display_name} removed from tracking`)
                            } else {
                              void act(`/api/reddit/requirements?id=${encodeURIComponent(row.id)}`, 'DELETE', undefined, `r/${row.display_name} removed`)
                            }
                          }}>
                          Remove
                        </button>
                      </span>
                    </td>
                  </tr>
                  {open && (
                    <tr className="rt-reqexpand">
                      <td colSpan={18}>
                        {sources.length === 0 && <span className="rt-dim">No samples yet — evidence appears after the requirements pass visits this community.</span>}
                        <ul className="rt-list">
                          {sources.map((source) => (
                            <li key={source.post_id} className="rt-list-row">
                              <i className="rt-status" data-tone={source.outcome === 'filtered' ? 'bad' : source.outcome === 'survived' ? 'ok' : 'idle'}
                                title={source.outcome === 'filtered' ? 'AutoMod filtered this post — holds the floor of the gates' : source.outcome === 'survived' ? 'This post survived — holds the ceiling of the gates' : undefined}>
                                {source.outcome}
                              </i>
                              <span className="rt-list-main">
                                <b>u/{source.author ?? 'deleted'}</b>
                                <span className="rt-dim">
                                  {source.link_karma === null ? 'karma unknown' : `${compact(source.link_karma)} post · ${compact(source.comment_karma ?? 0)} comment karma`}
                                  {source.account_age_days === null ? '' : ` · ${source.account_age_days}d old`}
                                  {' · '}{timeAgo(source.post_created_utc)}
                                </span>
                              </span>
                              {source.permalink && (
                                <a className="rt-link" href={source.permalink} target="_blank" rel="noreferrer">post ↗</a>
                              )}
                            </li>
                          ))}
                        </ul>
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
            {loading && !data && Array.from({ length: 6 }, (_, index) => (
              <tr key={index}><td colSpan={18}><div className="rt-skel"><i /></div></td></tr>
            ))}
            {!loading && !rows.length && (
              <tr><td colSpan={18} className="rt-hint">No communities match</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {rows.length > visible && (
        <div className="rt-toolbar">
          <span className="rt-stamp">Showing {visible} of {rows.length}</span>
          <button type="button" className="rt-btn rt-btn-quiet" onClick={() => setVisible((value) => value + 300)}>
            Show 300 more
          </button>
        </div>
      )}

      {/* Add a subreddit — a popup over the board (Geno, 2026-10-18): the
          inline panel moved into a dialog that fades in and out. The registry
          suggestions live inside it, so adding several in a row is one visit. */}
      {adding && (
        <div className="rt-modal-veil" data-closing={addClosing || undefined} onClick={closeAdd}>
          <div
            className="rt-modal rt-modal-card"
            data-closing={addClosing || undefined}
            role="dialog"
            aria-modal="true"
            aria-label="Add a subreddit"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="rt-modal-head">
              <div>
                <h2>Add a subreddit</h2>
                <p className="rt-panel-sub">A name, a URL, or one of the suggestions below.</p>
              </div>
              <button type="button" className="rt-modal-x" onClick={closeAdd} aria-label="Close">×</button>
            </header>
            <div className="rt-modal-body">
              <div className="rt-addrow">
                <input className="rt-input rt-input-wide" autoFocus value={addInput}
                  onChange={(event) => { setAddInput(event.target.value); if (addError) setAddError(null) }}
                  onKeyDown={(event) => { if (event.key === 'Enter' && addInput.trim().length >= 2) void addSubreddit() }}
                  placeholder="Name or URL — e.g. OnlyFansAdvice or reddit.com/r/OnlyFansAdvice" aria-label="Subreddit name or URL" />
                <DropSelect className="rt-dd" label="Category" value={addCategory} onChange={setAddCategory}
                  options={(data?.categories ?? []).map((option) => ({ value: option, label: option }))} />
              </div>
              {addError && <p className="rt-modal-error" role="alert">{addError}</p>}
              {data && data.untracked.length > 0 && (
                <>
                  <p className="rt-section-label">Suggested from the registry</p>
                  <div className="rt-chipline">
                    {(data.untracked ?? []).slice(0, 24).map((candidate) => (
                      <button key={candidate.name} type="button" className="rt-chip" disabled={busy}
                        title={candidate.adult ? 'Adult candidate' : `Add r/${candidate.name}`}
                        onClick={() => act('/api/reddit/subreddits', 'POST', { input: candidate.name, category: candidate.category },
                          `r/${candidate.name} added`)}>
                        + r/{candidate.name}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
            <footer className="rt-modal-foot">
              <button type="button" className="rt-btn rt-btn-quiet" onClick={closeAdd}>Cancel</button>
              <button type="button" className="rt-btn" disabled={busy || addInput.trim().length < 2} onClick={() => void addSubreddit()}>
                {busy ? 'Adding…' : 'Add subreddit'}
              </button>
            </footer>
          </div>
        </div>
      )}
    </div>
  )
}

function ComparePanel({ url, onClear }: { url: string | null; onClear: () => void }) {
  const { data, error } = useJson<{ rows: CompareRow[] }>(url)
  if (!url) return null
  return (
    <section className="rt-panel">
      <div className="rt-panel-head">
        <h2>Compare</h2>
        <button type="button" className="rt-btn rt-btn-quiet" onClick={onClear}>Clear</button>
      </div>
      {error && <p className="rt-error-inline">{error}</p>}
      <div className="rt-tablewrap">
        <table className="rt-table">
          <thead>
            <tr>
              <th>Community</th><th>Category</th>
              <th className="rt-col-num">Subscribers</th><th className="rt-col-num">Posts · 30d</th>
              <th className="rt-col-num">Posts / day</th><th className="rt-col-num">Engagement · 30d</th>
              <th className="rt-col-num">Avg / post</th>
            </tr>
          </thead>
          <tbody>
            {(data?.rows ?? []).map((row) => (
              <tr key={row.id}>
                <td><b>r/{row.id}</b></td>
                <td className="rt-dim">{row.category}</td>
                <td className="rt-col-num">{row.subscribers === null ? '—' : compact(row.subscribers)}</td>
                <td className="rt-col-num">{row.posts_30d}</td>
                <td className="rt-col-num">{row.posts_per_day === null ? '—' : row.posts_per_day.toFixed(1)}</td>
                <td className="rt-col-num">{compact(row.engagement_30d)}</td>
                <td className="rt-col-num">{row.avg_post_engagement === null ? '—' : compact(row.avg_post_engagement)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
