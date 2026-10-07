'use client'

import { useCallback, useEffect, useState } from 'react'
import type { Insights } from '@/lib/insights'
import type { Niche } from '@/lib/niches'
import { labelOf } from '@/lib/taxonomy'
import CreatorFace, { type Face } from '../../dashboard/CreatorFace'

type Faces = { handles: Record<string, Face>; formats: Record<string, { thumb: string; author: string | null }> }

type Payload = Insights & {
  accepted: { verticals: { format: string; name: string; tier: string | null }[] | null; similar_creators: string[] | null; wont_do: string[] | null } | null
  /** The tags of reels she said yes to — 👍 or "I'll do this" — counted. */
  her_picks?: { axis: string; tag: string; n: number }[]
}

const BASIS: Record<Insights['matching']['basis'], string> = {
  'her-profile': 'the formats accepted for them',
  derived: 'the verticals their own winners point to',
  starter: "the manual's three starter verticals — they have no winners to derive from yet",
}

/** T0's bands in words that describe what we watch, not a ruling on the
 *  niche: a thin count is as often thin coverage as a thin niche. */
const BAND: Record<Niche['band'], string> = {
  carries: 'carries winners',
  thin: 'thin',
  few: 'few winners in what we watch',
}

function NicheRow({ niche, faces }: { niche: Niche; faces: Faces | null }) {
  return (
    <li className="niche-row">
      <div className="niche-row-head">
        <b>{niche.label}</b>
        <span className="hint">{niche.winning} of {niche.watched} creators winning · {BAND[niche.band]}</span>
      </div>
      {niche.top.length > 0 && (
        <div className="face-row">
          {niche.top.map((c) => (
            <CreatorFace key={c.handle} handle={c.handle} face={faces?.handles[c.handle.toLowerCase()]} line={`${c.multiple}× their usual`} />
          ))}
        </div>
      )}
    </li>
  )
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
  const [faces, setFaces] = useState<Faces | null>(null)

  const load = useCallback(async () => {
    const response = await fetch(`/api/models/${modelId}/insights`)
    if (!response.ok) return setFailed(true)
    setData(await response.json())
  }, [modelId])

  useEffect(() => { void load() }, [load])

  // Pictures for every creator and vertical named, fetched once the brand is in.
  useEffect(() => {
    if (!data) return
    const handles = [
      ...data.similar.map((c) => c.handle),
      ...[...data.niches.hers, ...data.niches.strongest].flatMap((n) => n.top.map((c) => c.handle)),
    ]
    const formats = data.verticals.map((v) => v.format)
    fetch(`/api/creators/faces?handles=${encodeURIComponent(handles.join(','))}&formats=${encodeURIComponent(formats.join(','))}`)
      .then((r) => (r.ok ? r.json() : null)).then((body) => body && setFaces(body)).catch(() => null)
  }, [data])

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

  if (failed) return <p className="hint" data-tone="bad">Their brand did not load. Try again in a moment.</p>
  if (!data) return <p className="hint">Working them out from their accounts…</p>

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

      {/* Her niche as she votes it (2026-10-07): what she thumbs-up and
          takes on, counted — the read to weigh her verticals against. */}
      {(data.her_picks?.length ?? 0) > 0 && (
        <section className="axis">
          <div className="axis-head">
            <span className="axis-name">What she says yes to</span>
            <span className="hint">from her 👍 and “I’ll do this” taps</span>
          </div>
          <p className="brand-picks">
            {data.her_picks!.map((pick) => (
              <span key={`${pick.axis}-${pick.tag}`} className="brand-pick">
                {labelOf(pick.axis as 'topic' | 'format', pick.tag)} ×{pick.n}
              </span>
            ))}
          </p>
        </section>
      )}

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
        <ol className="vertical-cards">
          {data.verticals.map((vertical) => {
            const example = faces?.formats[vertical.format]
            return (
              <li key={vertical.format} className="vertical-card">
                <span className="vertical-pic" aria-hidden>
                  {example ? <img src={example.thumb} alt="" loading="lazy" /> : null}
                  <b className="vertical-tier">{vertical.tier ?? '·'}</b>
                </span>
                <b>{vertical.name}</b>
                <small>
                  {vertical.source === 'starter'
                    ? 'Starter — no winners of theirs yet'
                    : `${vertical.posts} of their reels · best ${vertical.best_multiple}×`}
                </small>
              </li>
            )
          })}
        </ol>
        <span className="hint">Matching them on {BASIS[data.matching.basis]}.</span>
      </section>

      <section className="axis">
        <div className="axis-head">
          <span className="axis-name">Niche strength</span>
        </div>
        {data.niches.hers.length > 0 ? (
          <ol className="brand-list">
            {data.niches.hers.map((niche) => <NicheRow key={niche.topic} niche={niche} faces={faces} />)}
          </ol>
        ) : (
          <span className="hint">No niche read off their reels yet — they are relatable or untagged.</span>
        )}
        {data.niches.strongest.length > 0 && (
          <>
            <span className="hint">{data.niches.hers.length > 0 ? 'Strongest other niches' : 'Strongest niches'} in what we watch:</span>
            <ol className="brand-list">
              {data.niches.strongest.map((niche) => <NicheRow key={niche.topic} niche={niche} faces={faces} />)}
            </ol>
          </>
        )}
        <span className="hint">
          Winning = a reel at 5× or more its creator&apos;s usual views in the last 90 days. Counts what we
          watch, not the whole niche — a low number can mean we follow few creators in it.
        </span>
      </section>

      <section className="axis">
        <div className="axis-head">
          <span className="axis-name">Their three creators</span>
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
          <span className="hint">Nobody on the watchlist shares enough of their formats yet.</span>
        ) : (
          <div className="face-row face-row-large">
            {data.similar.map((creator) => (
              <CreatorFace
                key={creator.handle}
                size="large"
                handle={creator.handle}
                face={faces?.handles[creator.handle.toLowerCase()]}
                line={`${creator.winners} winners · shares ${[...creator.shared_persona, ...creator.shared_formats].slice(0, 3).join(', ')}`}
              />
            ))}
          </div>
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
