'use client'

import { useState } from 'react'

/** Team sign-in (Geno, 2026-10-12): the same email and password as the
 *  ai-invoice dashboard. CEO and admin are in; a member needs the
 *  transcriber permission switched on for their account. */
export default function Gate() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError('')
    const response = await fetch('/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    })
    if (response.ok) {
      window.location.reload()
      return
    }
    const body = await response.json().catch(() => ({}))
    setError(body.error ?? 'Could not sign in.')
    setBusy(false)
  }

  return (
    <main className="gate console">
      <div className="gate-aurora" aria-hidden />

      <section className="gate-top">
        <span className="gate-mark">Gosian Media</span>
        <h1 className="gate-display">
          Transcriber<span className="gate-dot">.</span>
        </h1>
        <p className="gate-line">The roster&rsquo;s week — planned, then filmed.</p>
      </section>

      <section className="gate-panel">
        <form onSubmit={submit}>
          <header className="gate-head">
            <h2 className="gate-title">Sign in</h2>
            <p className="gate-sub">Use your Gosian dashboard account.</p>
          </header>

          <label className="gate-field">
            <span className="gate-label">Email</span>
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@gosianmedia.com"
              autoComplete="email"
              autoFocus
            />
          </label>

          <label className="gate-field">
            <span className="gate-label">Password</span>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="••••••••"
              autoComplete="current-password"
            />
          </label>

          {error && (
            <p className="gate-error" role="alert">
              {error}
            </p>
          )}

          <button className="btn gate-submit" type="submit" disabled={busy || !email || !password}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </section>

      <p className="gate-foot">Gosian Media · Console</p>
    </main>
  )
}
