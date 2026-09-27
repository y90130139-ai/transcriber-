import type { ModelPerf } from '@/lib/performance/load'
import Avatar from './Avatar'
import { signed } from './format'
import Sparkline from './Sparkline'

/** The five gaining the most followers in the period. */
export default function LeadingAccounts({ models, onOpen, onAll }: {
  models: ModelPerf[]
  onOpen: (id: string) => void
  onAll: () => void
}) {
  const leading = models
    .filter((m) => m.followers_gain !== null)
    .sort((a, b) => (b.followers_gain ?? 0) - (a.followers_gain ?? 0))
    .slice(0, 5)
  return (
    <section className="dash-panel dash-leading" aria-labelledby="dash-leading-h">
      <header className="dash-panel-head">
        <h2 id="dash-leading-h">Leading accounts</h2>
        <p>By follower growth</p>
      </header>
      {leading.length === 0 ? <p className="dash-empty">No follower readings yet.</p> : (
        <ol className="dash-rank">
          {leading.map((m, i) => (
            <li key={m.id}>
              <button className="dash-rank-row" onClick={() => onOpen(m.id)}>
                <span className="dash-rank-n">{String(i + 1).padStart(2, '0')}</span>
                <Avatar name={m.name} src={m.photo_url} />
                <span className="dash-rank-name"><b>{m.name}</b><small>@{m.handles[0]}</small></span>
                <Sparkline values={m.followers_spark} width={64} height={22} />
                <span className="dash-rank-gain" data-sign={Math.sign(m.followers_gain ?? 0)}>{signed(m.followers_gain)}</span>
              </button>
            </li>
          ))}
        </ol>
      )}
      <button className="dash-link" onClick={onAll}>View all accounts →</button>
    </section>
  )
}
