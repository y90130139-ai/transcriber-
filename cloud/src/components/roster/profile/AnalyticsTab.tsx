'use client'

import { useCallback, useEffect, useState } from 'react'
import type { Board, ModelPerf } from '@/lib/performance/load'
import { TAG_LABEL, type TagKey } from '@/lib/performance/math'
import BarChart from '../../dashboard/BarChart'
import LineChart from '../../dashboard/LineChart'
import PeriodSwitch, { type Period } from '../../dashboard/PeriodSwitch'
import TopReels from '../../dashboard/TopReels'
import { TagChip, TrendBadge } from '../../dashboard/TrendBadge'
import { ago, compact, percent, shortDay, signed } from '../../dashboard/format'

type Account = { handle: string; followers: number | null; followers_gain: number | null; reels_period: number; views_period: number; tracked: boolean }
type Data = Board & { model: ModelPerf; accounts: Account[] }

/** One model's Instagram: growth, views, her tag, each account, her best reels. */
export default function AnalyticsTab({ modelId }: { modelId: string }) {
  const [period, setPeriod] = useState<Period>(30)
  const [data, setData] = useState<Data | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setError(null)
    const response = await fetch(`/api/models/${modelId}/performance?days=${period}`).catch(() => null)
    if (!response?.ok) { setError('Their numbers did not load.'); return }
    setData(await response.json())
  }, [modelId, period])

  useEffect(() => { void load() }, [load])

  async function pin(value: string) {
    setSaving(true)
    const response = await fetch(`/api/models/${modelId}/performance`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tag: value || null }),
    })
    setSaving(false)
    if (response.ok) void load()
    else setError('The tag did not save.')
  }

  if (error) return <p className="dash-error" role="alert">{error}</p>
  if (!data) return <p className="dash-empty" aria-busy="true">Reading their accounts…</p>
  const m = data.model
  if (!m.handles.length) return <p className="dash-empty">No Instagram on file for them — add one in Profile and Scout starts reading it the next day.</p>

  return (
    <div className="dash dash-one">
      <div className="dash-one-top">
        <PeriodSwitch value={period} onChange={setPeriod} />
        <TrendBadge trend={m.trend} />
      </div>

      <section className="dash-stats dash-stats-tight" aria-label="Their totals">
        <article className="dash-stat"><h3>Followers</h3><p className="dash-stat-value">{compact(m.followers)}</p>
          <p className="dash-stat-note"><b data-sign={Math.sign(m.followers_gain ?? 0)}>{signed(m.followers_gain)}</b>
            {m.tracked_since ? ` since ${shortDay(m.tracked_since)}` : ''}{m.followers_pct !== null && ` · ${percent(m.followers_pct)}`}</p></article>
        <article className="dash-stat"><h3>Views</h3><p className="dash-stat-value">{compact(m.views_period)}</p>
          <p className="dash-stat-note">on {m.reels_period} reels · {compact(m.lifetime_views)} all time</p></article>
        <article className="dash-stat"><h3>Posting</h3><p className="dash-stat-value">{m.reels_per_week}<small> reels/wk</small></p>
          <p className="dash-stat-note">{m.posts_period} posts in all · last {ago(m.last_posted_at)}</p></article>
        <article className="dash-stat"><h3>Stories</h3><p className="dash-stat-value">{m.story_days_observed ? `${m.story_days}/${m.story_days_observed}` : '—'}</p>
          <p className="dash-stat-note">days with a story up</p></article>
      </section>

      <div className="dash-grid-main">
        <section className="dash-panel" aria-labelledby="one-growth-h">
          <header className="dash-panel-head"><h2 id="one-growth-h">Audience growth</h2><p>Followers across their accounts</p></header>
          <LineChart series={data.followers_series} previous={data.followers_prev} label="Their followers by day"
            emptyNote="Not enough readings yet — Scout reads their accounts once a day." />
        </section>
        <section className="dash-panel dash-details" aria-labelledby="one-details-h">
          <header className="dash-panel-head"><h2 id="one-details-h">Account details</h2></header>
          <label className="axis-name" htmlFor="one-tag">Tag</label>
          <select id="one-tag" className="field" disabled={saving} value={m.tag_pinned ? m.tag ?? '' : ''}
            onChange={(e) => void pin(e.target.value)}>
            <option value="">Automatic{m.auto_tag ? ` — ${TAG_LABEL[m.auto_tag]}` : ' — not enough data'}</option>
            {(Object.keys(TAG_LABEL) as TagKey[]).map((k) => <option key={k} value={k}>{TAG_LABEL[k]} (pinned)</option>)}
          </select>
          <p className="hint">
            <TagChip tag={m.tag} label={m.tag_label} pinned={m.tag_pinned} />{' '}
            {m.views_change !== null ? `Settled reels ${percent(m.views_change)} on the ten before.` : 'Too few settled reels to compare views.'}
          </p>
          <h3 className="axis-name">Accounts</h3>
          <ul className="dash-acc-list">
            {data.accounts.map((a) => (
              <li key={a.handle}>
                <a href={`https://www.instagram.com/${a.handle}/`} target="_blank" rel="noreferrer">@{a.handle}</a>
                <span>{a.tracked ? `${compact(a.followers)} · ${signed(a.followers_gain)}` : 'not read yet'}</span>
                <small>{a.reels_period} reels · {compact(a.views_period)} views</small>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <TopReels reels={data.top_reels} title="Their top reels" />
      <section className="dash-panel" aria-labelledby="one-views-h">
        <header className="dash-panel-head"><h2 id="one-views-h">Views by day posted</h2></header>
        <BarChart series={data.views_series} label="Their views by day posted" emptyNote="No reels posted in this period." />
      </section>
    </div>
  )
}
