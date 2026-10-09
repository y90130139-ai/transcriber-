'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import { compact } from '@/lib/format'
import type { Platform } from '@/lib/socials'
import PlatformIcon from '../roster/PlatformIcon'
import ItemView from '../ItemView'
import { useConsole } from './ConsoleProvider'
import { Icon, type IconName } from './ConsoleIcons'

/** The console's navigation, as the rail lays it out (2026-10-07). Home stands
 *  on its own; everything else lives under a group that opens on the page it
 *  contains — the disclosure the reference's platform list uses. */
type NavLeaf = { href: string; label: string; icon: IconName }
type NavGroup = { id: string; label: string; icon: IconName; mark?: Platform; items: NavLeaf[] }

const GROUPS: NavGroup[] = [
  {
    id: 'content', label: 'Content', icon: 'layers',
    items: [
      { href: '/library', label: 'Library', icon: 'layers' },
      { href: '/queue', label: 'Queue', icon: 'list' },
    ],
  },
  {
    id: 'research', label: 'Research', icon: 'trending',
    items: [
      { href: '/trends', label: 'Trends', icon: 'trending' },
      { href: '/reddit-trends', label: 'Reddit Trends', icon: 'reddit' },
      { href: '/sounds', label: 'Sounds', icon: 'music' },
    ],
  },
  /* The platform rail (Geno, 2026-10-07): each platform opens the way the
     reference's list does, holding its own pages. Instagram ships with the
     imported media feed; TikTok and X are the same shell, waiting on data. */
  {
    id: 'instagram', label: 'Instagram', icon: 'layers', mark: 'instagram',
    items: [{ href: '/instagram', label: 'Media', icon: 'layers' }],
  },
  {
    id: 'tiktok', label: 'TikTok', icon: 'music', mark: 'tiktok',
    items: [{ href: '/tiktok', label: 'Media', icon: 'music' }],
  },
  {
    id: 'twitter', label: 'Twitter / X', icon: 'trending', mark: 'x',
    items: [{ href: '/twitter', label: 'Media', icon: 'trending' }],
  },
  {
    id: 'roster', label: 'Roster', icon: 'users',
    items: [
      { href: '/models', label: 'Models', icon: 'userCheck' },
      { href: '/creators', label: 'Creators', icon: 'users' },
      { href: '/watchlist', label: 'Watchlist', icon: 'eye' },
    ],
  },
  {
    id: 'standup', label: 'Standup', icon: 'calendarCheck',
    items: [
      { href: '/today', label: 'Today', icon: 'calendarCheck' },
      { href: '/week', label: 'Week', icon: 'calendar' },
    ],
  },
]

/** The label the top bar's crumb wears for each route. */
const LABELS: Record<string, string> = { '/': 'Home' }
for (const group of GROUPS) for (const item of group.items) LABELS[item.href] = item.label
// A platform's crumb is the platform, not the sub-item every platform repeats.
LABELS['/instagram'] = 'Instagram'
LABELS['/tiktok'] = 'TikTok'
LABELS['/twitter'] = 'Twitter / X'

/** Which groups start open: the ones holding the page being looked at. */
function groupsFor(pathname: string): Record<string, boolean> {
  const open: Record<string, boolean> = {}
  for (const group of GROUPS) open[group.id] = group.items.some((item) => item.href === pathname)
  return open
}

/** The console chrome — rail, top bar, reader — around every page. Phase 6:
 *  every console rule that differs from the maison default hangs off the one
 *  `console` class below, so it can never reach her plan page. The frame itself
 *  is shell.css's. */
export default function ConsoleShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const { counts, creators, openItem, setOpenItem, reload } = useConsole()
  const [navOpen, setNavOpen] = useState(true)
  const [mobileNav, setMobileNav] = useState(false)
  const [narrow, setNarrow] = useState(false)
  const [openGroups, setOpenGroups] = useState(() => groupsFor(pathname))

  // The console is dark, always. Her plan page is the only writer of
  // `data-theme`; if a stray poke ever leaves one on <html>, the ground
  // silently stops matching. Strip it on mount.
  useEffect(() => { document.documentElement.removeAttribute('data-theme') }, [])

  // Landing on a page in a closed group opens that group, so the page being
  // looked at is never hidden from the rail that led to it.
  useEffect(() => {
    setOpenGroups((current) => {
      const active = GROUPS.find((group) => group.items.some((item) => item.href === pathname))
      if (!active || current[active.id]) return current
      return { ...current, [active.id]: true }
    })
  }, [pathname])

  // Below the rail's breakpoint it is a drawer. Tracked here, not read in the
  // click handler, so the menu can describe what it is toggling — and so
  // widening the window closes the drawer instead of stranding it.
  useEffect(() => {
    const query = window.matchMedia('(max-width: 1023px)')
    const update = () => {
      setNarrow(query.matches)
      if (!query.matches) setMobileNav(false)
    }
    update()
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])

  // The drawer closes with the page it led to, and with Escape.
  useEffect(() => { setMobileNav(false) }, [pathname])
  useEffect(() => {
    if (!mobileNav) return
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setMobileNav(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [mobileNav])

  const queued = counts.queued + counts.running
  const needYou = Math.max(0, counts.failed - (counts.waiting ?? 0))
  const navShown = narrow ? mobileNav : navOpen
  // Reddit Trends is one rail item with nine of its own pages; the crumb is
  // the section, the way a platform's crumb is the platform.
  const crumb = pathname.startsWith('/reddit-trends') ? 'Reddit Trends' : LABELS[pathname] ?? 'Console'

  function toggleNav() {
    // One button, two behaviours: a drawer below the rail's breakpoint, a
    // collapse above it.
    if (narrow) setMobileNav((open) => !open)
    else setNavOpen((open) => !open)
  }

  async function signOut() {
    await fetch('/api/auth', { method: 'DELETE' }).catch(() => null)
    window.location.reload()
  }

  return (
    <div className="console shell" data-nav={navOpen} data-mnav={mobileNav}>
      <aside className="side" id="console-nav">
        <div className="side-inner">
          <Link href="/" className="side-brand" aria-label="Gosian Media — console home">
            <img src="/gosian-logo.png" alt="Gosian Media" width={76} height={30} />
          </Link>

          <nav className="side-nav" aria-label="Sections">
            <Link href="/" className="nav-row" data-on={pathname === '/'}
              aria-current={pathname === '/' ? 'page' : undefined}
              onClick={() => setMobileNav(false)}>
              <span className="nav-icon"><Icon name="home" /></span>
              <span className="nav-label">Home</span>
            </Link>

            {GROUPS.map((group) => {
              const open = openGroups[group.id] === true
              const on = group.items.some((item) => item.href === pathname)
              return (
                <div className="nav-group" data-open={open} key={group.id}>
                  <button type="button" className="nav-row nav-group-head" data-on={on}
                    aria-expanded={open}
                    onClick={() => setOpenGroups((current) => ({ ...current, [group.id]: !open }))}>
                    <span className="nav-icon">
                      {group.mark ? <PlatformIcon platform={group.mark} size={17} /> : <Icon name={group.icon} />}
                    </span>
                    <span className="nav-label">{group.label}</span>
                    <span className="nav-chev"><Icon name="chevron" size={14} /></span>
                  </button>

                  {open && (
                    <div className="nav-sub">
                      {group.items.map((item) => {
                        const itemOn = item.href === pathname
                        return (
                          <Link key={item.href} href={item.href} className="nav-row nav-sub-row"
                            data-on={itemOn} aria-current={itemOn ? 'page' : undefined}
                            onClick={() => setMobileNav(false)}>
                            <span className="nav-icon"><Icon name={item.icon} size={16} /></span>
                            <span className="nav-label">{item.label}</span>
                            {item.href === '/queue' && queued > 0 && <b className="nav-badge">{queued}</b>}
                          </Link>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })}
          </nav>

          <div className="side-foot">
            <div className="side-user">
              <span className="side-user-avatar" aria-hidden>GM</span>
              <span className="side-user-copy">
                <span className="side-user-name">Gosian</span>
                <span className="side-user-role">Console</span>
              </span>
            </div>

            <button type="button" className="side-signout" onClick={signOut}>
              <Icon name="logout" size={16} />
              <span>Sign out</span>
            </button>
          </div>
        </div>
      </aside>

      {mobileNav && (
        <button type="button" className="side-scrim" aria-label="Close navigation"
          onClick={() => setMobileNav(false)} />
      )}

      <div className="shell-main">
        <header className="topbar">
          <div className="topbar-inner">
            <button type="button" className="topbar-menu" onClick={toggleNav}
              aria-label={navShown ? 'Hide navigation' : 'Show navigation'}
              aria-expanded={navShown} aria-controls="console-nav">
              <Icon name="menu" />
            </button>

            <Link href="/" className="topbar-crumb">{crumb}</Link>

            <div className="topbar-stats">
              <Link href="/library" className="topbar-stat" data-wide
                title={`${counts.done.toLocaleString()} videos in the library`}>
                <Icon name="layers" size={15} />
                <b>{compact(counts.done)}</b>
                <span className="topbar-stat-word">videos</span>
              </Link>
              <Link href="/creators" className="topbar-stat" data-wide
                title={`${creators.length} creators in the library`}>
                <Icon name="users" size={15} />
                <b>{creators.length}</b>
                <span className="topbar-stat-word">creators</span>
              </Link>
              <Link href="/queue" className="topbar-stat"
                title={`${queued} in the queue right now`}>
                <Icon name="list" size={15} />
                <b>{queued}</b>
                <span className="topbar-stat-word">in queue</span>
              </Link>
              <Link href="/queue" className="topbar-stat"
                data-tone={needYou > 0 ? 'alert' : undefined}
                title={needYou > 0 ? `${needYou} stuck — they need a person` : 'Nothing stuck'}>
                <Icon name="alert" size={15} />
                <b>{needYou}</b>
                <span className="topbar-stat-word">stuck</span>
              </Link>
            </div>

            <Link href="/queue" className="topbar-bell"
              aria-label={needYou > 0 ? `Queue — ${needYou} stuck` : 'Queue'}>
              <Icon name="bell" />
              {needYou > 0 && <b className="topbar-bell-count">{needYou}</b>}
            </Link>

            <span className="topbar-account" aria-hidden>GM</span>
          </div>
        </header>

        <main className="page">
          {children}
        </main>
      </div>

      {openItem && <ItemView item={openItem} onClose={() => setOpenItem(null)} onChanged={reload} />}
    </div>
  )
}
