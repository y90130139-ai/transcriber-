'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { compact } from '@/lib/format'
import { canView, firstAllowedPath, levelOf, pageForPath, type AccessLevel } from '@/lib/permissions'
import PlatformIcon from '../roster/PlatformIcon'
import ItemView from '../ItemView'
import { useConsole } from './ConsoleProvider'
import { Icon } from './ConsoleIcons'
import NavSearch from './NavSearch'
import { LABELS, SETTINGS_LEAF, TABS, isOn, tabOf, type NavTab, type NavTabId } from './nav'

/** Which side of the rail the reader last chose, for the pages outside both
 *  (Settings). The route itself outranks this whenever it belongs to a side. */
const SIDE_KEY = 'sinaura-console-side'

/** The switcher menu's width, mirrored in shell.css �?" keep them in step. */
const MENU_W = 280

/** The rail a member actually owns (Geno, 2026-10-18): pages they cannot view
 *  are not offered — not in the rail, not in the switcher, not in search. */
function visibleTabs(permissions: Record<string, AccessLevel>): NavTab[] {
  return TABS
    .map((tab) => ({
      ...tab,
      sections: tab.sections
        .map((section) => ({
          ...section,
          items: section.items.filter((item) => canView(permissions, pageForPath(item.href))),
        }))
        .filter((section) => section.items.length > 0),
    }))
    .filter((tab) => tab.sections.length > 0)
}

/** The console chrome — rail, top bar, reader — around every page. Phase 6:
 *  every console rule that differs from the maison default hangs off the one
 *  `console` class below, so it can never reach her plan page. The frame itself
 *  is shell.css's. */
export default function ConsoleShell({ children, permissions }: { children: React.ReactNode; permissions: Record<string, AccessLevel> }) {
  const pathname = usePathname()
  const router = useRouter()
  const { counts, creators, openItem, setOpenItem, reload } = useConsole()
  const [navOpen, setNavOpen] = useState(true)
  const [mobileNav, setMobileNav] = useState(false)
  const [narrow, setNarrow] = useState(false)
  /** The side the reader picked by hand; the route wins wherever it can. */
  const [side, setSide] = useState<NavTabId>('marketing')
  /** The switcher menu under the mark, open while picking a side. */
  const [sideMenu, setSideMenu] = useState(false)
  /** The menu outlives its own close so the fade runs both ways. */
  const [menuMounted, setMenuMounted] = useState(false)
  /** Where the menu sits — measured off the button, since the rail clips and
   *  the menu drops below it, extending right over the page. */
  const [menuPos, setMenuPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 })
  const triggerRef = useRef<HTMLButtonElement>(null)

  const updateMenuPos = useCallback(() => {
    const trigger = triggerRef.current
    if (!trigger) return
    const t = trigger.getBoundingClientRect()
    setMenuPos({
      top: t.bottom + 6,
      left: Math.max(8, Math.min(t.left - 10, window.innerWidth - MENU_W - 8)),
    })
  }, [])
  /** The signed-in teammate, for the foot of the rail. */
  const [me, setMe] = useState<{ name: string | null; role: string; email: string } | null>(null)
  useEffect(() => {
    fetch('/api/auth')
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => setMe(data?.user ?? null))
      .catch(() => null)
  }, [])

  // The stored pick seeds the pages outside every side (Settings). Read on
  // mount, never during render, so the first paint is deterministic.
  useEffect(() => {
    try {
      const stored = localStorage.getItem(SIDE_KEY)
      if (stored === 'marketing' || stored === 'client' || stored === 'scheduler') setSide(stored)
    } catch { /* private window: marketing is the default anyway */ }
  }, [])

  /** The side the rail draws: whichever side owns the page you are on, else
   *  the side you last chose. Only sides with pages the member can open. */
  const tabs = useMemo(() => visibleTabs(permissions), [permissions])
  const routeSide = tabOf(pathname)
  const shownSide = (routeSide && tabs.some((tab) => tab.id === routeSide) ? routeSide : null)
    ?? (tabs.some((tab) => tab.id === side) ? side : tabs[0]?.id)
    ?? 'marketing'
  const shownTab = tabs.find((tab) => tab.id === shownSide) ?? tabs[0]

  /** The permissions page gate (Geno, 2026-10-18): the APIs refuse regardless
   *  — this is the face of that, and it bounces to the first page they own. */
  const pageKey = pageForPath(pathname)
  const allowedHere = !pageKey || canView(permissions, pageKey)
  const fallbackPath = firstAllowedPath(permissions)
  useEffect(() => {
    if (allowedHere || !fallbackPath) return
    if (fallbackPath === pathname) return
    router.replace(fallbackPath)
  }, [allowedHere, fallbackPath, pathname, router])
  /** View-only pages wear it in the top bar, so a refused save has a reason. */
  const pageLevel = pageKey ? levelOf(permissions, pageKey) : 'edit'

  function chooseSide(next: NavTabId) {
    setSideMenu(false)
    setSide(next)
    try { localStorage.setItem(SIDE_KEY, next) } catch { /* storage blocked: this visit still switches */ }
    // A switch is also a move: picking a side your current page is not on —
    // the other side, or Settings — lands on that side's first page instead
    // of leaving you on a page the rail cannot show.
    if (tabOf(pathname) !== next) router.push(TABS.find((tab) => tab.id === next)?.home ?? '/')
  }

  function toggleMenu() {
    if (!sideMenu) {
      updateMenuPos()
      setMenuMounted(true)
    }
    setSideMenu((open) => !open)
  }

  // The switcher menu closes on Escape and on any click that is not the
  // switch or the menu itself — the menu is detached from the rail, so both
  // count as "inside".
  useEffect(() => {
    if (!sideMenu) return undefined
    const onDown = (event: MouseEvent) => {
      if (!(event.target as Element | null)?.closest('.side-switch, .side-switch-menu')) setSideMenu(false)
    }
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setSideMenu(false) }
    window.addEventListener('resize', updateMenuPos)
    document.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('resize', updateMenuPos)
      document.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [sideMenu, updateMenuPos])

  // The console is dark, always. Her plan page is the only writer of
  // `data-theme`; if a stray poke ever leaves one on <html>, the ground
  // silently stops matching. Strip it on mount.
  useEffect(() => { document.documentElement.removeAttribute('data-theme') }, [])

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
  useEffect(() => { setMobileNav(false); setSideMenu(false) }, [pathname])
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
const crumb = pathname.startsWith('/reddit-trends')
  ? 'Reddit Trends'
  // App Content is one section of six document pages; the crumb names the
  // section, and the page title names the document.
  : pathname.startsWith('/app-content')
    ? 'App Content'
    : LABELS[pathname] ?? 'Console'

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
    <div className="console shell" data-nav={navOpen} data-mnav={mobileNav} data-side={shownSide} data-flush={pathname === '/inbox' || undefined} data-cal={pathname === '/scheduler' || undefined}>
      <aside className="side" id="console-nav">
        <div className="side-inner">
          <div className="side-top">
            <Link href="/" className="side-brand" aria-label="Gosian Media — console home">
              <img src="/gosian-logo.png" alt="Gosian Media" width={76} height={30} />
            </Link>

            <div className="side-switch" data-open={sideMenu || undefined}>
              <button type="button" className="side-switch-trigger" ref={triggerRef}
                aria-haspopup="menu" aria-expanded={sideMenu}
                onClick={toggleMenu}>
                <span>Switch</span>
                <span className="side-switch-chev"><Icon name="swap" size={13} /></span>
              </button>
            </div>
          </div>

          <div className="side-find">
            <NavSearch permissions={permissions} />
          </div>

          <nav className="side-nav" aria-label="Sections">
            {shownTab?.sections.map((section) => (
              <div className="side-sect" key={section.id}>
                <span className="side-sect-label">{section.label}</span>
                {section.items.map((item) => {
                  const on = isOn(item.href, pathname)
                  return (
                    <Link key={item.href} href={item.href} className="nav-row"
                      data-on={on} aria-current={on ? 'page' : undefined}
                      onClick={() => setMobileNav(false)}>
                      <span className="nav-icon">
                        {item.mark
                          ? <PlatformIcon platform={item.mark} size={15} />
                          : item.icon ? <Icon name={item.icon} size={16} /> : null}
                      </span>
                      <span className="nav-label">{item.label}</span>
                      {item.href === '/queue' && queued > 0 && <b className="nav-badge">{queued}</b>}
                    </Link>
                  )
                })}
              </div>
            ))}

            {canView(permissions, 'settings') && (
              <div className="side-sect side-sect-tail">
                <Link href={SETTINGS_LEAF.href} className="nav-row"
                  data-on={pathname === SETTINGS_LEAF.href}
                  aria-current={pathname === SETTINGS_LEAF.href ? 'page' : undefined}
                  onClick={() => setMobileNav(false)}>
                  <span className="nav-icon"><Icon name={SETTINGS_LEAF.icon ?? 'settings'} size={16} /></span>
                  <span className="nav-label">{SETTINGS_LEAF.label}</span>
                </Link>
              </div>
            )}
          </nav>

          <div className="side-foot">
            <div className="side-user">
              <span className="side-user-avatar" aria-hidden>
                {(me?.name ?? me?.email ?? 'GM').slice(0, 2).toUpperCase()}
              </span>
              <span className="side-user-copy">
                <span className="side-user-name">{me?.name ?? me?.email ?? 'Gosian'}</span>
                <span className="side-user-role">
                  {me?.role ? (me.role === 'ceo' ? 'CEO' : me.role.replace(/^./, (letter) => letter.toUpperCase())) : 'Console'}
                </span>
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

      {/* The switcher menu lives outside the rail (Geno, 2026-10-13): the
          rail clips its children, and this one drops below the button,
          extending right over the page. Kept mounted after the first open so
          the close fade can run; position is measured off the button. */}
      {menuMounted && (
        <div className="side-switch-menu" role="menu" aria-label="Switch workspace"
          data-open={sideMenu || undefined}
          style={{ top: menuPos.top, left: menuPos.left }}>
          <div className="side-switch-menu-head" role="presentation">
            <span className="side-switch-menu-heading">
              <span className="side-switch-menu-kicker">Workspace</span>
              <span className="side-switch-menu-title">Choose a workspace</span>
            </span>
          </div>
          <div className="side-switch-menu-rule" role="separator" />
          {tabs.map((tab) => (
            <button key={tab.id} type="button" role="menuitem"
              className="side-switch-option" data-on={tab.id === shownSide || undefined}
              onClick={() => chooseSide(tab.id)}>
              <span className="side-switch-logo-box">
                <img src="/gosian-logo.png" alt="" className="side-switch-logo" />
              </span>
              <span className="side-switch-body">
                <span className="side-switch-heading-row">
                  <span className="side-switch-tag">{tab.label}</span>
                  {tab.id === shownSide && (
                    <span className="side-switch-current">
                      <span className="side-switch-current-dot" aria-hidden="true" />
                      Current
                    </span>
                  )}
                </span>
                <span className="side-switch-note">{tab.note}</span>
              </span>
            </button>
          ))}
        </div>
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

            {pageLevel === 'read' && (
              <span className="topbar-viewonly" title="View only — ask an admin for edit access in Team settings">
                <Icon name="eye" size={13} />
                View only
              </span>
            )}

            <span className="topbar-account" aria-hidden>GM</span>
          </div>
        </header>

        {/* Keyed to the route so the page-in animation runs on navigation —
            the element remounts, everything inside it is the new page anyway
            (2026-10-13). The Video Batcher's tools share one key: its layout
            must stay mounted between them, or the loaded files and the queue
            would die with every tool switch (2026-10-13). */}
        <main
          key={pathname.startsWith('/video-batcher') ? 'video-batcher' : pathname}
          className={pathname === '/inbox' || pathname === '/scheduler' ? 'page page-flush' : 'page'}>
          {allowedHere ? children : (
            <div className="noaccess" role="alert">
              <span className="noaccess-mark" aria-hidden>
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                  <rect x="5" y="10.5" width="14" height="9.5" rx="2" />
                  <path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" />
                </svg>
              </span>
              <h2>No access to this page</h2>
              <p>
                Your account does not have it. An admin can grant it in the
                ai-invoice dashboard — Team settings, your name, Transcriber.
              </p>
              {fallbackPath && <Link href={fallbackPath} className="noaccess-go">Go to my first page</Link>}
            </div>
          )}
        </main>
      </div>

      {openItem && allowedHere && <ItemView item={openItem} onClose={() => setOpenItem(null)} onChanged={reload} />}
    </div>
  )
}
