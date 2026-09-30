'use client'

import { useEffect, useState } from 'react'
import EarningsBoard from '../earnings/EarningsBoard'
import Dashboard from './Dashboard'

type View = 'instagram' | 'earnings'
const VIEW_KEY = 'sinaura-dash-view'

/** The Dashboard tab: Instagram reach, or OnlyFans earnings (2026-09-30). */
export default function DashboardHome({ onOpenModel }: { onOpenModel: (id: string) => void }) {
  const [view, setView] = useState<View>('instagram')

  useEffect(() => {
    try {
      if (localStorage.getItem(VIEW_KEY) === 'earnings') setView('earnings')
    } catch { /* storage blocked: Instagram first */ }
  }, [])

  function choose(next: View) {
    setView(next)
    try { localStorage.setItem(VIEW_KEY, next) } catch { /* private window: fine */ }
  }

  return (
    <>
      <div className="dash-views" role="group" aria-label="Dashboard view">
        <button className="chip" data-on={view === 'instagram'} aria-pressed={view === 'instagram'} onClick={() => choose('instagram')}>Instagram</button>
        <button className="chip" data-on={view === 'earnings'} aria-pressed={view === 'earnings'} onClick={() => choose('earnings')}>Earnings</button>
      </div>
      {view === 'instagram' ? <Dashboard onOpenModel={onOpenModel} /> : <EarningsBoard onOpenModel={onOpenModel} />}
    </>
  )
}
