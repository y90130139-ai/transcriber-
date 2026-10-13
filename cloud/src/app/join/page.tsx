import type { Metadata } from 'next'
import { validateResetToken, validateSetupToken } from '@/lib/model-accounts'

// The token in the URL is the auth: no session, never cached.
export const dynamic = 'force-dynamic'
export const revalidate = 0

export const metadata: Metadata = { title: 'Set your password · Gosian' }

/** What each ?error= code from POST /api/app/join means to her. */
const ERROR_COPY: Record<string, string> = {
  mismatch: 'Those passwords did not match — try again.',
  bad: 'Your password needs at least 8 characters.',
  exists: 'This account has already been set up — open the app and sign in.',
  server: 'Something went wrong on our side — try again.',
  invalid: 'This link is invalid or has expired.',
}

const page: React.CSSProperties = {
  minHeight: '100vh',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: '#171717',
  padding: '40px 16px',
  fontFamily: 'var(--sc-font-text)',
}
const card: React.CSSProperties = {
  width: '100%',
  maxWidth: 440,
  background: '#1e1e1e',
  border: '1px solid #2c2c2c',
  borderRadius: 18,
  overflow: 'hidden',
}
const inner: React.CSSProperties = { padding: '34px 32px 30px', display: 'flex', flexDirection: 'column', gap: 18 }
const label: React.CSSProperties = {
  fontSize: 11,
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  color: '#767676',
  fontWeight: 700,
}
const field: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  background: '#171717',
  border: '1px solid #333',
  borderRadius: 12,
  color: '#fafafa',
  fontSize: 15,
  padding: '13px 14px',
  outline: 'none',
}
const button: React.CSSProperties = {
  display: 'block',
  width: '100%',
  textAlign: 'center',
  background: 'linear-gradient(135deg,#faaa8b,#ed6d3a)',
  color: '#fff',
  border: 0,
  borderRadius: 12,
  fontSize: 15,
  fontWeight: 700,
  padding: '14px 20px',
  cursor: 'pointer',
}
const hint: React.CSSProperties = { fontSize: 13, lineHeight: 1.55, color: '#8a8a8a', margin: 0 }

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <main style={page}>
      <div style={card}>
        <div style={{ height: 3, background: 'linear-gradient(90deg,#ed6d3a,#f25623,#faaa8b)' }} />
        <div style={inner}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/gosian-logo.png" alt="Gosian Media" width={124} style={{ display: 'block' }} />
          {children}
        </div>
      </div>
    </main>
  )
}

export default async function JoinPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; error?: string }>
}) {
  const { token = '', error = '' } = await searchParams

  const [setup, reset] = await Promise.all([
    validateSetupToken(token).catch(() => null),
    validateResetToken(token).catch(() => null),
  ])
  const errorCopy = error ? ERROR_COPY[error] ?? ERROR_COPY.invalid : ''

  // Already set up: the invite link still resolves, so say so plainly.
  if (setup?.alreadyActive) {
    return (
      <Frame>
        <h1 style={{ margin: 0, fontSize: 23, color: '#fafafa', letterSpacing: '-0.02em' }}>You&apos;re already set up</h1>
        <p style={hint}>Open the Gosian app and sign in with your email and password — or reset it below if you&apos;ve forgotten it.</p>
      </Frame>
    )
  }

  if (!setup && !reset) {
    return (
      <Frame>
        <h1 style={{ margin: 0, fontSize: 23, color: '#fafafa', letterSpacing: '-0.02em' }}>This link has expired</h1>
        <p style={hint}>Ask the team to send you a new one — it takes them a second.</p>
      </Frame>
    )
  }

  const account = setup?.account ?? reset!
  const heading = setup ? `Set your password, ${account.name ?? account.email.split('@')[0]}` : 'Set a new password'

  return (
    <Frame>
      <h1 style={{ margin: 0, fontSize: 23, color: '#fafafa', letterSpacing: '-0.02em' }}>{heading}</h1>
      <p style={hint}>
        {setup
          ? 'Your week is already built — this opens it on your phone. Your sign-in email is below.'
          : 'Pick a new password for your Gosian app account.'}
      </p>
      {errorCopy ? (
        <p style={{ ...hint, color: '#ff9a66', border: '1px solid rgba(242,86,35,0.35)', background: 'rgba(242,86,35,0.12)', borderRadius: 10, padding: '10px 12px' }}>
          {errorCopy}
        </p>
      ) : null}
      <form action="/api/app/join" method="post" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <input type="hidden" name="token" value={token} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
          <span style={label}>Your email</span>
          <div style={{ ...field, color: '#a3a3a3' }}>{account.email}</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
          <label style={label} htmlFor="password">New password</label>
          <input style={field} id="password" name="password" type="password" minLength={8} autoComplete="new-password" required placeholder="At least 8 characters" />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
          <label style={label} htmlFor="password2">Confirm password</label>
          <input style={field} id="password2" name="password2" type="password" minLength={8} autoComplete="new-password" required placeholder="Same again" />
        </div>
        <button style={button} type="submit">{setup ? 'Set my password' : 'Save my new password'}</button>
      </form>
      <p style={{ ...hint, fontSize: 12, color: '#767676' }}>
        This link works once and then stops — your password becomes the only way in.
      </p>
    </Frame>
  )
}
