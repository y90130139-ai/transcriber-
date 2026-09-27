import type { ModelPerf } from '@/lib/performance/load'
import Avatar from './Avatar'

const GROUPS = [
  { key: 'up', title: 'Trending up', icon: '↑' },
  { key: 'flat', title: 'Steady', icon: '→' },
  { key: 'down', title: 'Trending down', icon: '↓' },
] as const

/** Who is moving which way, at a glance — faces, not a list to read. */
export default function Movement({ models, onOpen }: { models: ModelPerf[]; onOpen: (id: string) => void }) {
  const unknown = models.filter((m) => !m.trend).length
  return (
    <section className="dash-panel dash-movement" aria-labelledby="dash-move-h">
      <header className="dash-panel-head">
        <h2 id="dash-move-h">Movement</h2>
        <p>Views on settled reels and follower change</p>
      </header>
      <div className="dash-move-cols">
        {GROUPS.map((group) => {
          const members = models.filter((m) => m.trend === group.key)
          return (
            <div key={group.key} className="dash-move-col" data-trend={group.key}>
              <h3><b aria-hidden>{group.icon}</b> {group.title} <span>{members.length}</span></h3>
              <div className="dash-faces">
                {members.map((m) => (
                  <button key={m.id} className="dash-face" onClick={() => onOpen(m.id)} title={m.name}>
                    <Avatar name={m.name} src={m.photo_url} size={36} />
                    <span>{m.name.split(' ')[0]}</span>
                  </button>
                ))}
                {members.length === 0 && <p className="dash-empty">Nobody</p>}
              </div>
            </div>
          )
        })}
      </div>
      {unknown > 0 && <p className="dash-foot">{unknown} not tracked long enough to tell.</p>}
    </section>
  )
}
