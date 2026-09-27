'use client'

import { forwardRef, useMemo, useState } from 'react'
import type { ModelPerf } from '@/lib/performance/load'
import { TAG_LABEL, type TagKey } from '@/lib/performance/math'
import Avatar from './Avatar'
import { ago, compact, percent, signed } from './format'
import Sparkline from './Sparkline'
import { TagChip, TrendBadge } from './TrendBadge'

type SortKey = 'followers' | 'growth' | 'views' | 'reels' | 'stories'

const SORTS: { key: SortKey; label: string; value: (m: ModelPerf) => number }[] = [
  { key: 'followers', label: 'Followers', value: (m) => m.followers ?? -1 },
  { key: 'growth', label: 'Growth', value: (m) => m.followers_gain ?? -Infinity },
  { key: 'views', label: 'Views', value: (m) => m.views_period },
  { key: 'reels', label: 'Reels / wk', value: (m) => m.reels_per_week },
  { key: 'stories', label: 'Stories', value: (m) => (m.story_days_observed ? m.story_days / m.story_days_observed : -1) },
]

/** Every model, one row each. Sort by any number, filter by tag, find by name. */
const AccountsTable = forwardRef<HTMLElement, { models: ModelPerf[]; days: number; onOpen: (id: string) => void }>(
  function AccountsTable({ models, days, onOpen }, ref) {
    const [sort, setSort] = useState<SortKey>('followers')
    const [tag, setTag] = useState<TagKey | 'all'>('all')
    const [query, setQuery] = useState('')

    const rows = useMemo(() => {
      const by = SORTS.find((s) => s.key === sort) ?? SORTS[0]
      const q = query.trim().toLowerCase()
      return models
        .filter((m) => tag === 'all' || m.tag === tag)
        .filter((m) => !q || m.name.toLowerCase().includes(q) || m.handles.some((h) => h.includes(q)))
        .sort((a, b) => by.value(b) - by.value(a))
    }, [models, sort, tag, query])

    return (
      <section ref={ref} className="dash-panel dash-accounts" aria-labelledby="dash-acc-h">
        <header className="dash-panel-head dash-accounts-head">
          <div>
            <h2 id="dash-acc-h">Your accounts <span>{models.length}</span></h2>
            <p>Growth and views over {days} days</p>
          </div>
          <div className="dash-filters">
            <input className="field" type="search" placeholder="Search models…" value={query}
              onChange={(e) => setQuery(e.target.value)} aria-label="Search models" />
            <select className="field" value={tag} onChange={(e) => setTag(e.target.value as TagKey | 'all')} aria-label="Filter by tag">
              <option value="all">All tags</option>
              {(Object.keys(TAG_LABEL) as TagKey[]).map((k) => <option key={k} value={k}>{TAG_LABEL[k]}</option>)}
            </select>
          </div>
        </header>
        <div className="dash-table-wrap">
          <table className="dash-table">
            <thead>
              <tr>
                <th scope="col">Account</th>
                {SORTS.map((s) => (
                  <th key={s.key} scope="col" aria-sort={sort === s.key ? 'descending' : undefined}>
                    <button className="dash-sort" data-on={sort === s.key} onClick={() => setSort(s.key)}>
                      {s.label}{sort === s.key ? ' ↓' : ''}
                    </button>
                  </th>
                ))}
                <th scope="col">Trend</th>
                <th scope="col">Last post</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((m) => (
                <tr key={m.id} onClick={() => onOpen(m.id)} tabIndex={0}
                  onKeyDown={(e) => { if (e.key === 'Enter') onOpen(m.id) }}>
                  <th scope="row">
                    <span className="dash-who">
                      <Avatar name={m.name} src={m.photo_url} />
                      <span>
                        <b>{m.name}</b>
                        <small>{m.handles.length ? `@${m.handles[0]}${m.handles.length > 1 ? ` +${m.handles.length - 1}` : ''}` : 'No Instagram on file'}</small>
                        <TagChip tag={m.tag} label={m.tag_label} pinned={m.tag_pinned} />
                      </span>
                    </span>
                  </th>
                  <td>{compact(m.followers)}</td>
                  <td>
                    <span data-sign={Math.sign(m.followers_gain ?? 0)}>{signed(m.followers_gain)}</span>
                    {m.followers_pct !== null && <small> {percent(m.followers_pct)}</small>}
                  </td>
                  <td>{compact(m.views_period)}</td>
                  <td>{m.reels_per_week}</td>
                  <td>{m.story_days_observed ? `${m.story_days}/${m.story_days_observed} days` : '—'}</td>
                  <td>
                    <span className="dash-trend-cell">
                      <Sparkline values={m.followers_spark} width={64} height={22} />
                      <TrendBadge trend={m.trend} compactLabel />
                    </span>
                  </td>
                  <td>{ago(m.last_posted_at)}</td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={8} className="dash-empty">No model matches.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    )
  },
)

export default AccountsTable
