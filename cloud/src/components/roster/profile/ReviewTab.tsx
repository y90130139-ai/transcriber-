'use client'

import { useEffect, useState } from 'react'
import { addDays, currentWeekOf, formatDate } from '@/lib/dates'
import type { Review } from '@/lib/review'
import type { Attribution } from '@/lib/attribution'
import type { QualityCheck } from '@/lib/quality'

type Payload = Review & { attribution: Attribution }

/** Her week, reviewed: every post graded against her own median, the action
 *  for each, and the Sunday call sheet in the order to say it. */
export default function ReviewTab({ modelId }: { modelId: string }) {
  const thisWeek = currentWeekOf()
  const [week, setWeek] = useState(thisWeek)
  const [data, setData] = useState<Payload | null>(null)
  const [copied, setCopied] = useState(false)
  const [checks, setChecks] = useState<QualityCheck[] | null>(null)
  const [scanning, setScanning] = useState(false)

  useEffect(() => {
    void (async () => {
      const response = await fetch(`/api/models/${modelId}/quality`)
      if (response.ok) setChecks((await response.json()).checks)
    })()
  }, [modelId])

  async function scan() {
    setScanning(true)
    const response = await fetch(`/api/models/${modelId}/quality`, { method: 'POST' })
    if (response.ok) setChecks((await response.json()).checks)
    setScanning(false)
  }

  useEffect(() => {
    let live = true
    setData(null)
    void (async () => {
      const response = await fetch(`/api/models/${modelId}/review?week=${week}`)
      if (live && response.ok) setData(await response.json())
    })()
    return () => { live = false }
  }, [modelId, week])

  async function copyCall() {
    if (!data) return
    await navigator.clipboard.writeText(data.call.join('\n\n'))
    setCopied(true)
    setTimeout(() => setCopied(false), 1600)
  }

  return (
    <div className="brand">
      <div className="axis-head">
        <button className="pill" onClick={() => setWeek(addDays(week, -7))}>← Earlier</button>
        <span className="hint">{formatDate(week)} – {formatDate(addDays(week, 6))}</span>
        <button className="pill" disabled={week >= thisWeek} onClick={() => setWeek(addDays(week, 7))}>Later →</button>
      </div>

      {!data ? <p className="hint">Reviewing her week…</p> : (
        <>
          <section className="axis">
            <div className="axis-head">
              <span className="axis-name">Sunday call</span>
              <button className="axis-confirm" onClick={copyCall}>{copied ? 'Copied' : 'Copy'}</button>
            </div>
            <ol className="brand-list">{data.call.map((line) => <li key={line}>{line}</li>)}</ol>
          </section>

          <section className="axis">
            <div className="axis-head">
              <span className="axis-name">What she posted</span>
              <span className="hint">
                {data.counts.reels} reels · {data.counts.carousels} carousels · {data.mix.winners} winners · {data.mix.good} good
              </span>
            </div>
            {data.posts.length === 0 ? <span className="hint">Nothing swept for this week.</span> : (
              <ul className="brand-list">
                {data.posts.filter((post) => post.kind === 'reel').map((post) => (
                  <li key={post.post_id}>
                    <b>{post.grade ?? '—'}</b>
                    <a href={post.url} target="_blank" rel="noreferrer">
                      {formatDate(post.posted_at.slice(0, 10))} · @{post.handle}
                    </a>
                    <span className="hint">
                      {' '}{post.multiple !== null ? `${post.multiple}× her normal` : 'no baseline'}
                      {post.action ? ` → ${post.action}` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="axis">
            <div className="axis-head">
              <span className="axis-name">Quality check</span>
              <button className="axis-confirm" disabled={scanning} onClick={scan}>
                {scanning ? 'Checking…' : 'Check her latest reels'}
              </button>
            </div>
            {!checks || checks.length === 0 ? (
              <span className="hint">Nothing checked yet. Each run looks at her three newest unchecked reels.</span>
            ) : (
              <ul className="brand-list">
                {checks.map((check) => (
                  <li key={check.post_id}>
                    <b>{check.verdict}</b>
                    <a href={`https://www.instagram.com/reel/${check.post_id}/`} target="_blank" rel="noreferrer">
                      {check.composite}/10
                    </a>
                    <span className="hint"> — {check.notes || 'no fixes needed'}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="axis">
            <div className="axis-head"><span className="axis-name">What her ladders have taught</span></div>
            {data.attribution.axes.length === 0 ? (
              <span className="hint">
                No finished batches yet.
                {data.attribution.unbound > 0
                  ? ` ${data.attribution.unbound} ladder card${data.attribution.unbound === 1 ? ' is' : 's are'} waiting to be matched to the reel she posted.`
                  : ''}
              </span>
            ) : (
              <ul className="brand-list">
                {data.attribution.axes.map((axis) => (
                  <li key={axis.axis}>{axis.verdict}<span className="hint"> — {axis.batches} batch{axis.batches === 1 ? '' : 'es'}</span></li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  )
}
