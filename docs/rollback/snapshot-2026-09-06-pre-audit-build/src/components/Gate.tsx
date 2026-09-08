'use client'

import { useState } from 'react'

export default function Gate() {
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
      body: JSON.stringify({ password }),
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
      <form onSubmit={submit}>
        <h1 className="wordmark">
          Transcriber<span className="dot">.</span>
        </h1>
        <input
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder="PASSWORD"
          aria-label="Password"
          autoFocus
        />
        <button className="btn" type="submit" disabled={busy || !password}>
          {busy ? 'Checking' : 'Enter'}
        </button>
        {error && <p className="hint" data-tone="bad">{error}</p>}
      </form>
    </main>
  )
}
