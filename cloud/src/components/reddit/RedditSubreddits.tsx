'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import type { SubredditRow } from '@/lib/reddit/types'
import type { CompareRow } from '@/lib/reddit/queries'
import { REGISTRY_CATEGORIES } from '@/lib/reddit/registry'
import DropSelect from '../dashboard/DropSelect'
import Sparkline from '../dashboard/Sparkline'
import { compact, timeAgo } from './bits'
import { useJson } from './useReddit'

type ListPayload = {
  rows: SubredditRow[]
  categories: string[]
  registry: { candidates: number; unique: number; untracked: number }
  untracked: { name: string; category: string; adult: boolean }[]
}

const STATUS_TONE: Record<string, string> = {
  active: 'ok', pending: 'idle', unavailable: 'bad', restricted: 'warn',
  quarantined: 'warn', error: 'bad', disabled: 'idle',
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
  const [addInput, setAddInput] = useState('')
  const [addCategory, setAddCategory] = useState<string>(REGISTRY_CATEGORIES[0])
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return (data?.rows ?? [])
      .filter((row) => (category ? row.category === category : true))
      .filter((row) => (status ? row.status === status : true))
      .filter((row) => (needle ? row.id.includes(needle) || (row.title ?? '').toLowerCase().includes(needle) : true))
  }, [data, query, category, status])

  const counts = useMemo(() => {
    const all = data?.rows ?? []
    return {
      tracked: all.length,
      active: all.filter((row) => row.status === 'active').length,
      paused: all.filter((row) => row.paused).length,
      adult: all.filter((row) => row.adult).length,
    }
  }, [data])

  const compareUrl = selected.length >= 2 ? `/api/reddit/subreddits/compare?ids=${selected.join(',')}` : null

  async function addSubreddit() {
    setBusy(true)
    setNotice(null)
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
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : String(reason))
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
          <span className="rt-stamp">{counts.tracked} tracked · {counts.active} active · {counts.paused} paused · {counts.adult} adult</span>
        </div>
        <div className="rt-toolbar-right">
          <button type="button" className="rt-btn" onClick={() => setAdding((open) => !open)}>
            + Add subreddit
          </button>
          <button type="button" className="rt-btn rt-btn-quiet" onClick={validate} disabled={busy}>Validate</button>
          <a className="rt-btn rt-btn-quiet" href="/api/reddit/dataset?export=subreddits" download>Export</a>
        </div>
      </div>

      {adding && (
        <section className="rt-panel rt-addpanel">
          <div className="rt-addrow">
            <input className="rt-input rt-input-wide" autoFocus value={addInput}
              onChange={(event) => setAddInput(event.target.value)}
              onKeyDown={(event) => { if (event.key === 'Enter' && addInput.trim().length >= 2) void addSubreddit() }}
              placeholder="Name or URL — e.g. OnlyFansAdvice or reddit.com/r/OnlyFansAdvice" aria-label="Subreddit name or URL" />
            <DropSelect className="rt-dd" label="Category" value={addCategory} onChange={setAddCategory}
              options={(data?.categories ?? []).map((option) => ({ value: option, label: option }))} />
            <button type="button" className="rt-btn" disabled={busy || addInput.trim().length < 2} onClick={addSubreddit}>Add</button>
          </div>
          {data && data.untracked.length > 0 && (
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
          )}
        </section>
      )}

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
        <table className="rt-table">
          <thead>
            <tr>
              <th className="rt-col-check">
                <input type="checkbox" aria-label="Select all"
                  checked={rows.length > 0 && rows.every((row) => selected.includes(row.id))}
                  onChange={(event) => setSelected(event.target.checked ? rows.map((row) => row.id) : [])} />
              </th>
              <th>Subreddit</th>
              <th>Category</th>
              <th className="rt-col-num">Subscribers</th>
              <th>Status</th>
              <th className="rt-col-num">Posts</th>
              <th className="rt-col-num">Engagement</th>
              <th className="rt-col-num">Trend · 14d</th>
              <th className="rt-col-num">Last sync</th>
              <th>Priority</th>
              <th className="rt-col-num">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td className="rt-col-check">
                  <input type="checkbox" checked={selected.includes(row.id)} aria-label={`Compare r/${row.id}`}
                    onChange={(event) => setSelected((current) => event.target.checked
                      ? [...current, row.id].slice(0, 6)
                      : current.filter((id) => id !== row.id))} />
                </td>
                <td>
                  <Link href={`/reddit-trends/subreddits/${row.id}`}><b>r/{row.display_name}</b></Link>
                </td>
                <td>
                  <DropSelect className="rt-dd rt-dd-sm" label={`Category for r/${row.id}`} value={row.category}
                    disabled={busy}
                    onChange={(next) => act(`/api/reddit/subreddits/${row.id}`, 'PATCH', { category: next })}
                    options={(data?.categories ?? [row.category]).map((option) => ({ value: option, label: option }))} />
                </td>
                <td className="rt-col-num">{row.subscribers === null ? '—' : compact(row.subscribers)}</td>
                <td><i className="rt-status" data-tone={STATUS_TONE[row.status] ?? 'idle'}
                  title={row.status_note ?? row.last_error ?? row.status}>{row.status}</i></td>
                <td className="rt-col-num">{compact(row.posts_collected)}</td>
                <td className="rt-col-num">{compact(row.engagement)}</td>
                <td className="rt-col-num">
                  {row.spark && row.spark.length >= 2
                    ? <Sparkline values={row.spark} width={72} height={22} />
                    : <span className="rt-dim">—</span>}
                </td>
                <td className="rt-col-num rt-dim">{timeAgo(row.last_synced_at)}</td>
                <td>
                  <DropSelect className="rt-dd rt-dd-sm" label={`Priority for r/${row.id}`} value={row.priority}
                    disabled={busy}
                    onChange={(next) => act(`/api/reddit/subreddits/${row.id}`, 'PATCH', { priority: next })}
                    options={[{ value: 'high', label: 'high' }, { value: 'medium', label: 'medium' }, { value: 'low', label: 'low' }]} />
                </td>
                <td className="rt-col-num">
                  <span className="rt-actions">
                    <button type="button" className="rt-mini" disabled={busy}
                      onClick={() => act(`/api/reddit/subreddits/${row.id}`, 'PATCH', { paused: !row.paused })}>
                      {row.paused ? 'Resume' : 'Pause'}
                    </button>
                    <button type="button" className="rt-mini" data-tone="danger" disabled={busy}
                      onClick={() => {
                        if (window.confirm(`Stop tracking r/${row.display_name}?`)) {
                          void act(`/api/reddit/subreddits/${row.id}`, 'DELETE', undefined, `r/${row.display_name} removed`)
                        }
                      }}>
                      Remove
                    </button>
                  </span>
                </td>
              </tr>
            ))}
            {loading && !data && Array.from({ length: 6 }, (_, index) => (
              <tr key={index}><td colSpan={11}><div className="rt-skel"><i /></div></td></tr>
            ))}
            {!loading && !rows.length && (
              <tr><td colSpan={11} className="rt-hint">No communities match</td></tr>
            )}
          </tbody>
        </table>
      </div>
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
