'use client'

import { useEffect, useState } from 'react'
import type { Blueprint } from '@/lib/blueprint'

/** Her Blueprint, in the manual's order. Read-only: every section comes from
 *  something already measured, and the Brand tab is where proposals are
 *  accepted. */
export default function BlueprintTab({ modelId }: { modelId: string }) {
  const [data, setData] = useState<Blueprint | null>(null)

  useEffect(() => {
    let live = true
    void (async () => {
      const response = await fetch(`/api/models/${modelId}/blueprint`)
      if (live && response.ok) setData(await response.json())
    })()
    return () => { live = false }
  }, [modelId])

  if (!data) return <p className="hint">Assembling their blueprint…</p>

  return (
    <div className="brand">
      <section className="axis">
        <div className="axis-head"><span className="axis-name">The split</span></div>
        <p>
          {data.split.total} reels a week — <b>{data.split.reskin}</b> reskins of their winners,{' '}
          <b>{data.split.iteration}</b> iterations, <b>{data.split.test}</b> new tests.
        </p>
      </section>

      <section className="axis">
        <div className="axis-head"><span className="axis-name">Brand pillars</span></div>
        {data.pillars.map((pillar) => (
          <div key={pillar.format} className="blueprint-pillar">
            <p><b>{pillar.tier ?? '·'}</b> {pillar.name} <span className="hint">— about {pillar.volume} a week{pillar.starter ? ' · starter' : ''}</span></p>
            {pillar.ideas.length === 0 ? (
              <span className="hint">No unused references in this format yet.</span>
            ) : (
              <ul className="brand-list">
                {pillar.ideas.map((idea) => (
                  <li key={idea.job_id}>
                    {idea.url ? <a href={idea.url} target="_blank" rel="noreferrer">reference</a> : 'reference'}
                    <span className="hint"> — {idea.preview || '(no words)'}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </section>

      <section className="axis">
        <div className="axis-head"><span className="axis-name">What is working — double down</span></div>
        {data.working.length === 0 ? <span className="hint">No reel past 10× their normal yet.</span> : (
          <ul className="brand-list">
            {data.working.map((post) => (
              <li key={post.post_id}><b>{Math.round(post.multiple)}×</b><a href={post.url} target="_blank" rel="noreferrer">their reel</a></li>
            ))}
          </ul>
        )}
        {data.learned.length > 0 && <ul className="brand-list">{data.learned.map((line) => <li key={line}>{line}</li>)}</ul>}
      </section>

      <section className="axis">
        <div className="axis-head"><span className="axis-name">Reduce or cut</span></div>
        {data.cut.length === 0 ? <span className="hint">Nothing to cut yet.</span> : (
          <ul className="brand-list">{data.cut.map((line) => <li key={line}>{line}</li>)}</ul>
        )}
      </section>

      <section className="axis">
        <div className="axis-head"><span className="axis-name">Their creators</span></div>
        <span className="hint">{data.similar.length ? data.similar.map((h) => `@${h}`).join(' · ') : 'None proposed yet.'}</span>
      </section>

      <section className="axis">
        <div className="axis-head"><span className="axis-name">How the week runs</span></div>
        <ol className="brand-list">{data.steps.map((step) => <li key={step}>{step}</li>)}</ol>
        <div className="axis-head"><span className="axis-name">Shoot day</span></div>
        <ul className="brand-list">{data.shoot_day.map((line) => <li key={line}>{line}</li>)}</ul>
      </section>
    </div>
  )
}
