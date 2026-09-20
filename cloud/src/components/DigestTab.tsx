'use client'

import { useEffect, useState } from 'react'
import { addDays, currentWeekOf, formatDate } from '@/lib/dates'
import { thumbUrl } from '@/lib/format'
import type { Count, Digest } from '@/lib/digest'
import WhyChips from './WhyChips'

const PATTERNS: { key: keyof Digest['common']; name: string }[] = [
  { key: 'reasons', name: 'What carried them' },
  { key: 'formats', name: 'Format' },
  { key: 'hooks', name: 'Opening' },
  { key: 'sounds', name: 'Sound' },
  { key: 'personas', name: 'Persona' },
  { key: 'creators', name: 'Who' },
]

/** The week's winners in the niche, and what the best of them had in common.
 *  Read-only; it is the library, grouped by the week the reels went up. */
export default function DigestTab({ onFilterTo }: { onFilterTo: (handle: string) => void }) {
  const thisWeek = currentWeekOf()
  const [week, setWeek] = useState(thisWeek)
  const [digest, setDigest] = useState<Digest | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let live = true
    setDigest(null)
    setFailed(false)
    void (async () => {
      const response = await fetch(`/api/digest?week=${week}`)
      if (!live) return
      if (!response.ok) return setFailed(true)
      setDigest(await response.json())
    })()
    return () => { live = false }
  }, [week])

  return (
    <section className="digest" aria-labelledby="digest-heading">
      <div className="section-head">
        <h2 id="digest-heading">The week</h2>
        <nav className="digest-nav" aria-label="Choose a week">
          <button className="pill" onClick={() => setWeek(addDays(week, -7))}>← Earlier</button>
          <span className="hint">
            {formatDate(week)} – {formatDate(addDays(week, 6))}
          </span>
          <button className="pill" disabled={week >= thisWeek} onClick={() => setWeek(addDays(week, 7))}>
            Later →
          </button>
        </nav>
      </div>

      {failed && <p className="hint" data-tone="bad">The digest could not be read. Try again in a moment.</p>}
      {!digest && !failed && <p className="hint">Reading the week…</p>}

      {digest && (
        <>
          <div className="digest-lede">
            {digest.headline.map((line) => <p key={line}>{line}</p>)}
            <p className="hint">
              {digest.posted} posted that week are in the library; a winner is 2× its creator&apos;s own
              median plays or better.
            </p>
          </div>

          {digest.basis > 0 && (
            <div className="digest-patterns">
              {PATTERNS.map(({ key, name }) => (
                <Pattern key={key} name={name} rows={digest.common[key]} of={digest.basis}
                  onPick={key === 'creators' ? (row) => onFilterTo(row.key) : undefined} />
              ))}
            </div>
          )}

          {digest.top.length > 0 && (
            <>
              <div className="section-head">
                <h2 style={{ fontSize: 'var(--sc-text-lg)' }}>Top {digest.top.length}</h2>
              </div>
              <ol className="ladder">
                {digest.top.map((item) => (
                  <li key={item.id} className="rung" data-hot="true">
                    {item.has_thumb
                      ? <img src={thumbUrl(item.id)} alt="" width={72} height={90} loading="lazy" />
                      : <span />}
                    <div>
                      <p className="rung-figure">
                        {times(item.why?.multiple ?? item.outperformance)}
                      </p>
                      <p className="rung-meta">
                        {[item.author ? `@${item.author}` : null, item.upload_date,
                          item.why?.multiple != null ? 'plays vs her median' : 'engagement vs her median']
                          .filter(Boolean).join(' · ')}
                        {item.webpage_url && (
                          <> · <a href={item.webpage_url} target="_blank" rel="noreferrer">open</a></>
                        )}
                      </p>
                      {item.preview && <p className="rung-line">{item.preview}</p>}
                      <WhyChips why={item.why} />
                    </div>
                  </li>
                ))}
              </ol>
            </>
          )}
        </>
      )}
    </section>
  )
}

/** 554.05 → 554×, 3.93 → 3.9× — a multiple is scanned, not read. */
function times(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—'
  return `${value >= 10 ? Math.round(value) : value.toFixed(1)}×`
}

function Pattern({
  name, rows, of, onPick,
}: {
  name: string
  rows: Count[]
  of: number
  onPick?: (row: Count) => void
}) {
  if (rows.length === 0) return null
  return (
    <div className="axis">
      <div className="axis-head"><span className="axis-name">{name}</span></div>
      <div className="chips">
        {rows.map((row) =>
          onPick ? (
            <button key={row.key} className="chip" onClick={() => onPick(row)} title="See them in the Library">
              {row.label} <b>{row.n}/{of}</b>
            </button>
          ) : (
            <span key={row.key} className="chip chip-static">{row.label} <b>{row.n}/{of}</b></span>
          ),
        )}
      </div>
    </div>
  )
}
