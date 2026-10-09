'use client'

import { useRouter } from 'next/navigation'
import { useMemo, useState } from 'react'
import type { OverviewTopic } from '@/lib/reddit/queries'
import { TOPIC_CATEGORIES } from '@/lib/reddit/registry'
import DropSelect from '../dashboard/DropSelect'
import Sparkline from '../dashboard/Sparkline'
import { compact, num, timeAgo } from './bits'
import { useJson } from './useReddit'

type SortKey = 'interest' | 'growth' | 'activity' | 'velocity' | 'freshness'

const SORT_LABEL: Record<SortKey, string> = {
  interest: 'Interest',
  growth: '24h change',
  activity: 'Mentions',
  velocity: 'Velocity',
  freshness: 'Freshness',
}

const STATUSES = ['breakout', 'rising', 'stable', 'cooling', 'building'] as const

/** Trending Now — the sortable analytics table. Every row opens its topic. */
export default function RedditTrending() {
  const router = useRouter()
  const [category, setCategory] = useState('')
  const [status, setStatus] = useState('')
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<SortKey>('interest')
  const [showAll, setShowAll] = useState(false)

  const url = useMemo(() => {
    const params = new URLSearchParams()
    if (category) params.set('category', category)
    if (status) params.set('status', status)
    if (query.trim()) params.set('q', query.trim())
    params.set('sort', sort)
    params.set('limit', showAll ? '300' : '60')
    return `/api/reddit/trending?${params}`
  }, [category, status, query, sort, showAll])

  const { data, error, loading } = useJson<{ rows: OverviewTopic[]; sort: SortKey }>(url)
  const rows = data?.rows ?? []

  return (
    <div className="rt-page">
      <div className="rt-toolbar">
        <div className="rt-filters">
          <DropSelect className="rt-dd" label="Category"
            value={category} onChange={setCategory}
            options={[{ value: '', label: 'All categories' }, ...TOPIC_CATEGORIES.map((option) => ({ value: option, label: option }))]} />
          <DropSelect className="rt-dd" label="Status"
            value={status} onChange={setStatus}
            options={[
              { value: '', label: 'All statuses' },
              ...STATUSES.map((option) => ({
                value: option,
                label: option === 'building' ? 'Building baseline' : option[0].toUpperCase() + option.slice(1),
              })),
            ]} />
        </div>
        <div className="rt-toolbar-right">
          <form className="rt-searchform" onSubmit={(event) => event.preventDefault()}>
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8"
              strokeLinecap="round" aria-hidden>
              <circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" />
            </svg>
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter topics…" aria-label="Filter topics" />
          </form>
        </div>
      </div>

      {error && <div className="rt-error"><b>Could not load topics</b><p>{error}</p></div>}

      <div className="rt-tablewrap">
        <table className="rt-table">
          <thead>
            <tr>
              <th className="rt-col-rank">#</th>
              <th>Topic</th>
              <th>Category</th>
              {(['interest', 'growth', 'activity', 'velocity'] as SortKey[]).map((key) => (
                <th key={key} className="rt-col-num">
                  <button type="button" className="rt-sortbtn" data-on={sort === key} onClick={() => setSort(key)}>
                    {SORT_LABEL[key]}{sort === key ? ' ↓' : ''}
                  </button>
                </th>
              ))}
              <th className="rt-col-num">Subscribers</th>
              <th className="rt-col-num">Authors</th>
              <th className="rt-col-num">Comms</th>
              <th className="rt-col-num">Trend</th>
              <th className="rt-col-num">
                <button type="button" className="rt-sortbtn" data-on={sort === 'freshness'} onClick={() => setSort('freshness')}>
                  Freshness{sort === 'freshness' ? ' ↓' : ''}
                </button>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((topic, index) => (
              <tr key={topic.id} tabIndex={0} role="link" aria-label={`Open ${topic.name}`}
                onClick={() => router.push(`/reddit-trends/topics/${topic.id}`)}
                onKeyDown={(event) => { if (event.key === 'Enter') router.push(`/reddit-trends/topics/${topic.id}`) }}>
                <td className="rt-col-rank rt-dim">{index + 1}</td>
                <td><b>{topic.name}</b>{topic.creator && <i className="rt-tag">creator</i>}</td>
                <td className="rt-dim">{topic.category}</td>
                <td className="rt-col-num"><b>{topic.interest === null ? '—' : topic.interest.toFixed(1)}</b></td>
                <td className="rt-col-num">
                  <span className="rt-growth" data-dir={(topic.growth ?? 0) > 0.05 ? 'up' : (topic.growth ?? 0) < -0.05 ? 'down' : 'flat'}>
                    {topic.growth === null ? 'new' : `${topic.growth > 0 ? '+' : ''}${Math.round(topic.growth * 100)}%`}
                  </span>
                </td>
                <td className="rt-col-num">{compact(topic.mentions)}</td>
                <td className="rt-col-num">{num(topic.velocity, 1)}</td>
                <td className="rt-col-num">{topic.subscriber_context === null ? '—' : compact(topic.subscriber_context)}</td>
                <td className="rt-col-num">{compact(topic.unique_authors)}</td>
                <td className="rt-col-num">{topic.subreddits}</td>
                <td className="rt-col-num"><Sparkline values={topic.spark} width={72} height={22} /></td>
                <td className="rt-col-num rt-dim">{timeAgo(topic.captured_at)}</td>
              </tr>
            ))}
            {loading && !data && Array.from({ length: 8 }, (_, index) => (
              <tr key={index}><td colSpan={12}><div className="rt-skel"><i /></div></td></tr>
            ))}
            {!loading && !rows.length && (
              <tr><td colSpan={12} className="rt-hint">Nothing matches</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {!showAll && rows.length >= 60 && (
        <div className="rt-tablefoot">
          <span />
          <button type="button" className="rt-btn rt-btn-quiet" onClick={() => setShowAll(true)}>Show more</button>
        </div>
      )}
    </div>
  )
}
