'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { Icon, type IconName } from './ConsoleIcons'

/** Settings — the rail's foot (Geno, 2026-10-13).
 *
 *  Redesigned (2026-10-13): the account reads as an identity card with the
 *  session's one action, and every workspace door says what it is for — the
 *  page used to be two bare lists floating on an empty page. */

type Me = { name: string | null; role: string; email: string }

const DOORS: { href: string; label: string; note: string; icon: IconName }[] = [
  { href: '/reddit-trends/settings', label: 'Reddit Trends settings', note: 'Budgets, cadence and cooldowns for the collector.', icon: 'reddit' },
  { href: '/app-accounts', label: 'App accounts', note: 'The app logins — invited, active or off — and the actions that keep them alive.', icon: 'checkCircle' },
  { href: '/invites', label: 'Invites', note: 'Send a model her invite to the app.', icon: 'mail' },
  { href: '/templates', label: 'Templates', note: 'Reusable card blanks — the plan editor reads this list.', icon: 'copy' },
]

/** Name (or email) → up to two letters for the monogram. */
function initialsOf(me: Me | null): string {
  const source = (me?.name || '').trim() || (me?.email || '').split('@')[0]
  const words = source.split(/[\s._-]+/).filter(Boolean)
  return words.slice(0, 2).map((word) => word[0]).join('').toUpperCase()
}

export default function SettingsTab() {
  const [me, setMe] = useState<Me | null>(null)
  const [failed, setFailed] = useState(false)
  const [leaving, setLeaving] = useState(false)

  useEffect(() => {
    fetch('/api/auth')
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error(String(response.status)))))
      .then((data) => setMe(data?.user ?? null))
      .catch(() => setFailed(true))
  }, [])

  async function signOut() {
    setLeaving(true)
    await fetch('/api/auth', { method: 'DELETE' }).catch(() => null)
    window.location.reload()
  }

  const role = me?.role
    ? (me.role === 'ceo' ? 'CEO' : me.role.replace(/^./, (letter) => letter.toUpperCase()))
    : null
  const loading = !me && !failed

  return (
    <div className="dash">
      <header className="dash-head">
        <div>
          <p className="dash-kicker">Console</p>
          <h2 className="dash-title">Settings</h2>
          <p className="dash-sub">Who is signed in, and the doors that run this console.</p>
        </div>
      </header>

      <div className="settings-grid">
        <section className="dash-panel" aria-label="Account" aria-busy={loading || undefined}>
          <div className="dash-panel-head">
            <h2>Account <span>team</span></h2>
            <p>The team account this browser is signed in with.</p>
          </div>

          <div className="set-id">
            <span className="set-monogram" data-loading={loading || undefined} aria-hidden>
              {loading ? '' : initialsOf(me) || '·'}
            </span>
            <div className="set-id-text">
              {loading ? (
                <>
                  <span className="set-skel set-skel-name" aria-hidden />
                  <span className="set-skel set-skel-mail" aria-hidden />
                </>
              ) : (
                <>
                  <p className="set-name">{me?.name ?? '—'}</p>
                  <p className="set-mail">{me?.email ?? '—'}</p>
                </>
              )}
            </div>
            {!loading && <span className="chip chip-static set-role">{role ?? '—'}</span>}
          </div>

          {failed && (
            <p className="hint" data-tone="bad" role="alert">Could not read the session — reload the page.</p>
          )}

          <div className="set-foot">
            <p className="hint">Signing out ends this session on this browser only.</p>
            <button type="button" className="btn btn-small btn-quiet" onClick={() => void signOut()} disabled={leaving}>
              {leaving ? 'Signing out…' : 'Sign out'}
            </button>
          </div>
        </section>

        <section className="dash-panel" aria-label="Workspace doors">
          <div className="dash-panel-head">
            <h2>Workspace <span>doors</span></h2>
            <p>Where the console's own plumbing lives.</p>
          </div>
          <nav className="set-doors">
            {DOORS.map((door) => (
              <Link key={door.href} href={door.href} className="set-door">
                <span className="set-door-icon" aria-hidden><Icon name={door.icon} size={16} /></span>
                <span className="set-door-text">
                  <span className="set-door-name">{door.label}</span>
                  <span className="set-door-note">{door.note}</span>
                </span>
                <span className="set-door-arrow" aria-hidden>→</span>
              </Link>
            ))}
          </nav>
        </section>
      </div>
    </div>
  )
}
