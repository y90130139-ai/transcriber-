'use client'

import { useCallback, useEffect, useState } from 'react'
import type { Insights } from '@/lib/insights'

type Payload = Insights & {
  accepted: { verticals: { format: string; name: string; tier: string | null }[] | null; similar_creators: string[] | null; wont_do: string[] | null } | null
}

const BASIS: Record<Insights['matching']['basis'], string> = {
  'her-profile': 'the formats accepted for her',
  derived: 'the verticals her own winners point to',
  starter: "the manual's three starter verticals — she has no winners to derive from yet",
}

/**
 * Her brand, worked out from her accounts and offered for a tap.
 *
 * Nothing on this tab asks anyone to type. Each section is a proposal with its
 * evidence beside it: accept it and it becomes what the planner matches her on,
 * or leave it and the planner keeps working off the live proposal anyway —
 * derived values may drive planning, but only accepted ones are hers.
 */
export default function BrandTab({ modelId }: { modelId: string }) {
  const [data, setData] = useState<Payload | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  const load = useCallback(async () => {
    const response = await fetch(`/api/models/${modelId}/insights`)
    if (!response.ok) return setFailed(true)
    setData(await response.json())
  }, [modelId])

  useEffect(() => { void load() }, [load])

  async function accept(action: string, body: Record<string, unknown>) {
    setBusy(action)
    const response = await fetch(`/api/models/${modelId}/insights`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, ...body }),
    })
    setBusy(null)
    if (response.ok) void load()
    else setFailed(true)
  }

  if (failed) return <p className="hint" data-tone="bad">Her brand did not load. Try again in a moment.</p>
  if (!data) return <p className="hint">Working her out from her accounts…</p>

  const accepted = data.accepted
  const verticalsAccepted = Boolean(accepted?.verticals?.length)
  const similarAccepted = Boolean(accepted?.similar_creators?.length)

  return (
    <div className="brand">
      <section className="axis">
        <div className="axis-head">
          <span className="axis-name">Level · {data.level.level}</span>
        </div>
        <p>{data.level.route}</p>
        <span className="hint">{data.level.reasons.join(' · ')}</span>
      </section>

      <section className="axis">
        <div className="axis-head">
          <span className="axis-name">Verticals</span>
          {verticalsAccepted
            ? <span className="hint">accepted</span>
            : (
              <button
                className="axis-confirm"
                disabled={busy !== null}
                onClick={() => accept('verticals', { verticals: data.verticals })}
              >
                {busy === 'verticals' ? 'Saving…' : 'Use these'}
              </button>
            )}
        </div>
        <ol className="brand-list">
          {data.verticals.map((vertical) => (
            <li key={vertical.format}>
              <b>{vertical.tier ?? '·'}</b> {vertical.name}
              <span className="hint">
                {vertical.source === 'starter'
                  ? ' — starter vertical, no winners of hers in it yet'
                  : ` — ${vertical.posts} of her graded reels, best ${vertical.best_multiple}×`}
              </span>
            </li>
          ))}
        </ol>
        <span className="hint">Matching her on {BASIS[data.matching.basis]}.</span>
      </section>

      <section className="axis">
        <div className="axis-head">
          <span className="axis-name">Her three creators</span>
          {data.similar.length > 0 && !similarAccepted && (
            <button
              className="axis-confirm"
              disabled={busy !== null}
              onClick={() => accept('similar', { handles: data.similar.map((s) => s.handle) })}
            >
              {busy === 'similar' ? 'Saving…' : 'Confirm'}
            </button>
          )}
          {similarAccepted && <span className="hint">confirmed</span>}
        </div>
        {data.similar.length === 0 ? (
          <span className="hint">Nobody on the watchlist shares enough of her formats yet.</span>
        ) : (
          <ol className="brand-list">
            {data.similar.map((creator) => (
              <li key={creator.handle}>
                <a href={`https://www.instagram.com/${creator.handle}/`} target="_blank" rel="noreferrer">
                  @{creator.handle}
                </a>
                <span className="hint">
                  {' '}— shares {[...creator.shared_persona, ...creator.shared_formats].join(', ')} ·{' '}
                  {creator.winners} winners in the library
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="axis">
        <div className="axis-head"><span className="axis-name">Won&apos;t do</span></div>
        {data.wont_do.length === 0 ? (
          <span className="hint">
            Nothing to propose. Two &ldquo;not comfortable&rdquo; declines on one format will show up here.
          </span>
        ) : (
          <ul className="brand-list">
            {data.wont_do.map((item) => (
              <li key={item.format}>
                {item.label}
                <span className="hint"> — declined {item.declines}× as not comfortable </span>
                <button
                  className="axis-confirm"
                  disabled={busy !== null}
                  onClick={() => accept('wont_do', { format: item.format })}
                >
                  Never send
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
