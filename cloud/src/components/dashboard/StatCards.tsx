import type { Board } from '@/lib/performance/load'
import { compact, percent, shortDay, signed } from './format'
import MicroBars from './MicroBars'
import Sparkline from './Sparkline'

/** Fifteen dots, one per observed day: green means a story was up. */
function StoryDots({ rate }: { rate: number }) {
  const filled = Math.round(rate * 15)
  return (
    <div className="dash-dots" aria-hidden>
      {Array.from({ length: 15 }, (_, index) => <i key={index} data-on={index < filled} />)}
    </div>
  )
}

/** The headline row. Each card is one number, what it covers, and which way. */
export default function StatCards({ board, onAttention }: { board: Board; onAttention?: () => void }) {
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
        <h3>Total followers · {board.days}d</h3>
        <p className="dash-stat-value">{compact(followers)}</p>
        <p className="dash-stat-note">
          <b data-sign={Math.sign(gain ?? 0)}>{signed(gain)}</b>
          {since ? ` since ${shortDay(since)}` : ' — no readings yet'}
        </p>
        <Sparkline values={fs.map((p) => p.value)} width={520} height={90} area
          format={(v, i) => `${fs[i] ? `${shortDay(fs[i].day)} · ` : ''}${compact(v)} followers`} />
      </article>
      <article className="dash-stat">
        <h3>Views · {board.days}d</h3>
        <p className="dash-stat-value">{compact(views)}</p>
        <MicroBars values={board.views_series.map((p) => p.value)} tone="amber" />
        {viewsPrev > 0 && (
          <p className="dash-pill" data-tone={views >= viewsPrev ? 'up' : 'down'}>
            {percent((views - viewsPrev) / viewsPrev)}
          </p>
        )}
      </article>
      <article className="dash-stat">
        <h3>Models</h3>
        <p className="dash-stat-value">{board.models.length}</p>
        <p className="dash-stat-note">{tracked.length} tracked on Instagram</p>
        {attention > 0 && (
          <button type="button" className="dash-stat-link" onClick={onAttention}>
            {attention} need attention →
          </button>
        )}
      </article>
      <article className="dash-stat">
        <h3>Reels posted · {board.days}d</h3>
        <p className="dash-stat-value">{compact(reels)}</p>
        <MicroBars values={board.reels_series.map((p) => p.value)} />
        {tracked.length > 0 && (
          <p className="dash-pill">{(reels / tracked.length / board.days * 7).toFixed(1)} / wk per model</p>
        )}
      </article>
      <article className="dash-stat">
        <h3>Stories · {board.days}d</h3>
        <p className="dash-stat-value">{storyRate === null ? '—' : `${Math.round(storyRate * 100)}%`}</p>
        {storyRate !== null && <StoryDots rate={storyRate} />}
        {storyRate !== null && <p className="dash-pill">of days with a story</p>}
      </article>
    </section>
  )
}
