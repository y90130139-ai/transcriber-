import type { Board } from '@/lib/performance/load'
import { compact, percent, shortDay, signed } from './format'
import Sparkline from './Sparkline'

/** The headline row. Each card is one number, what it covers, and which way. */
export default function StatCards({ board }: { board: Board }) {
  const tracked = board.models.filter((m) => m.followers !== null)
  const fs = board.followers_series
  const followers = fs.length ? fs[fs.length - 1].value : null
  const gain = fs.length > 1 ? fs[fs.length - 1].value - fs[0].value : null
  const views = board.models.reduce((t, m) => t + m.views_period, 0)
  const viewsPrev = board.models.reduce((t, m) => t + m.views_prev, 0)
  const reels = board.models.reduce((t, m) => t + m.reels_period, 0)
  const attention = board.models.filter((m) => m.tag === 'attention').length
  const storyRate = tracked.length
    ? tracked.reduce((t, m) => t + (m.story_days_observed ? m.story_days / m.story_days_observed : 0), 0) / tracked.length
    : null
  const since = fs[0]?.day

  return (
    <section className="dash-stats" aria-label="Totals">
      <article className="dash-stat dash-stat-lead">
        <h3>Total followers</h3>
        <p className="dash-stat-value">{compact(followers)}</p>
        <p className="dash-stat-note">
          <b data-sign={Math.sign(gain ?? 0)}>{signed(gain)}</b>
          {since ? ` since ${shortDay(since)}` : ' — no readings yet'}
        </p>
        <Sparkline values={fs.map((p) => p.value)} width={120} />
      </article>
      <article className="dash-stat">
        <h3>Views</h3>
        <p className="dash-stat-value">{compact(views)}</p>
        <p className="dash-stat-note">
          on reels posted in {board.days} days
          {viewsPrev > 0 && <> · <b data-sign={Math.sign(views - viewsPrev)}>{percent((views - viewsPrev) / viewsPrev)}</b></>}
        </p>
      </article>
      <article className="dash-stat">
        <h3>Models</h3>
        <p className="dash-stat-value">{board.models.length}</p>
        <p className="dash-stat-note">
          {tracked.length} tracked on Instagram{attention > 0 && <> · <b data-sign="-1">{attention} need attention</b></>}
        </p>
      </article>
      <article className="dash-stat">
        <h3>Reels posted</h3>
        <p className="dash-stat-value">{compact(reels)}</p>
        <p className="dash-stat-note">
          {tracked.length ? `${(reels / tracked.length / board.days * 7).toFixed(1)} a week per model` : '—'}
        </p>
      </article>
      <article className="dash-stat">
        <h3>Stories</h3>
        <p className="dash-stat-value">{storyRate === null ? '—' : `${Math.round(storyRate * 100)}%`}</p>
        <p className="dash-stat-note">of days with a story up, on average</p>
      </article>
    </section>
  )
}
