'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect } from 'react'
import ItemView from '../ItemView'
import { useConsole } from './ConsoleProvider'

const TABS: { href: string; label: string }[] = [
  // First and where the console opens: where every model stands before
  // anything else. The queue sits at the far end.
  { href: '/', label: 'Dashboard' },
  { href: '/library', label: 'Library' },
  { href: '/creators', label: 'Creators' },
  { href: '/watchlist', label: 'Watchlist' },
  { href: '/models', label: 'Models' },
  // Appended rather than slotted in front, so four tabs of muscle memory keep
  // pointing at what they always did.
  { href: '/today', label: 'Today' },
  { href: '/week', label: 'Week' },
  // Discovery (2026-10-06): the restructure to routes dropped this one —
  // the whole Trends build (live Google list, Trends AI) was unreachable.
  { href: '/trends', label: 'Trends' },
  { href: '/sounds', label: 'Sounds' },
  { href: '/queue', label: 'Queue' },
]

/** The console chrome — masthead, nav, reader — around every page. Phase 6:
 *  every console rule that differs from the maison default hangs off the one
 *  `console` class below, so it can never reach her plan page. */
export default function ConsoleShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const { counts, worker, openItem, setOpenItem, reload } = useConsole()

  // The console is dark, always. Her plan page is the only writer of
  // `data-theme`; if a stray poke ever leaves one on <html>, the ground
  // silently stops matching. Strip it on mount.
  useEffect(() => { document.documentElement.removeAttribute('data-theme') }, [])

  return (
    <div className="console">
      <header className="masthead">
        <h1 className="brand">
          <img src="/gosian-logo.png" alt="Gosian Media" width={76} height={30} />
        </h1>

        <nav className="tabs" aria-label="Sections">
          {TABS.map((entry) => {
            const on = pathname === entry.href
            return (
              <Link key={entry.href} href={entry.href} className="tab"
                data-on={on} aria-current={on ? 'page' : undefined}>
                {entry.label}
                {entry.href === '/queue' && counts.queued + counts.running > 0 && (
                  <b> {counts.queued + counts.running}</b>
                )}
              </Link>
            )
          })}
        </nav>

        <div className="masthead-meta">
          <span className="tally">
            <b>{counts.done}</b> held
            {(counts.waiting ?? 0) > 0 && <> · <b>{counts.waiting}</b> waiting</>}
            {counts.failed - (counts.waiting ?? 0) > 0 && <> · <b>{counts.failed - (counts.waiting ?? 0)}</b> need you</>}
          </span>
          <span className="status" data-online={worker.online}>
            <span className="beacon" aria-hidden />
            {worker.online ? (worker.video ? 'Mac live' : 'Mac listening') : 'Mac asleep'}
          </span>
        </div>
      </header>

      <main className="page">
        {children}
      </main>

      {openItem && <ItemView item={openItem} onClose={() => setOpenItem(null)} onChanged={reload} />}
    </div>
  )
}
