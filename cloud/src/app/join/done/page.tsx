import type { Metadata } from 'next'

export const metadata: Metadata = { title: "You're in · Gosian" }

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
const inner: React.CSSProperties = { padding: '34px 32px 30px', display: 'flex', flexDirection: 'column', gap: 16 }
const hint: React.CSSProperties = { fontSize: 14, lineHeight: 1.6, color: '#a3a3a3', margin: 0 }

/** Where the join form lands on the web. The app itself is the destination —
 *  this page is the short bridge between the link and her phone. */
export default function JoinDonePage() {
  return (
    <main style={page}>
      <div style={card}>
        <div style={{ height: 3, background: 'linear-gradient(90deg,#ed6d3a,#f25623,#faaa8b)' }} />
        <div style={inner}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/gosian-logo.png" alt="Gosian Media" width={124} style={{ display: 'block' }} />
          <h1 style={{ margin: 0, fontSize: 23, color: '#fafafa', letterSpacing: '-0.02em' }}>You&apos;re in</h1>
          <p style={hint}>Open the Gosian app and sign in with your email and the password you just set — your week is waiting.</p>
          <p style={{ ...hint, fontSize: 12, color: '#767676' }}>
            Lost the app? Ask the team for the download link — the same email and password work on any phone.
          </p>
        </div>
      </div>
    </main>
  )
}
