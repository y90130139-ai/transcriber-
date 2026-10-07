'use client'

import { useEffect, useState } from 'react'
import EarningsBoard from '../earnings/EarningsBoard'
import Dashboard from './Dashboard'
import type { DashView } from './ViewSwitch'

const VIEW_KEY = 'sinaura-dash-view'

/** The Dashboard tab: Instagram reach, or OnlyFans earnings (2026-09-30). */
export default function DashboardHome({ onOpenModel }: { onOpenModel: (id: string) => void }) {
  const [view, setView] = useState<DashView>('instagram')

  useEffect(() => {
    try {
      if (localStorage.getItem(VIEW_KEY) === 'earnings') setView('earnings')
    } catch { /* storage blocked: Instagram first */ }
  }, [])

  function choose(next: DashView) {
    setView(next)
    try { localStorage.setItem(VIEW_KEY, next) } catch { /* private window: fine */ }
  }

  return view === 'instagram'
    ? <Dashboard onOpenModel={onOpenModel} view={view} onView={choose} />
    : <EarningsBoard onOpenModel={onOpenModel} view={view} onView={choose} />
}
