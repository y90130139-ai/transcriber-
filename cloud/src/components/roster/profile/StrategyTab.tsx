'use client'

/**
 * Strategy — her Creator Intelligence report (Geno's template, 2026-10-06).
 *
 * One generation reads everything on file — profile, questionnaire, intake
 * dumps, her winners, transcripts of her own videos, her feedback — plus
 * anything pasted for the run (meeting notes), and writes the 24-section
 * report. What the sources cannot answer comes back as the questions to
 * ask her, not as filler.
 *
 * Corrections are the template's permanent layer: added here, they survive
 * every regeneration and override the other evidence. The report text
 * itself is never hand-edited — correct it, then regenerate.
 */
import { useCallback, useEffect, useState } from 'react'
import type { AboutDoc } from '@/lib/report/spec'

const ENGINE_NOTE: Record<AboutDoc['engine'], string | null> = {
  anthropic: null,
  workers: 'Drafted on the fallback model — add ANTHROPIC_API_KEY on Vercel for the strong one, then regenerate.',
}

export default function StrategyTab({ modelId, name }: { modelId: string; name: string }) {
  const [about, setAbout] = useState<AboutDoc | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [paste, setPaste] = useState('')
  const [pasteOpen, setPasteOpen] = useState(false)
  const [working, setWorking] = useState(false)
  const [note, setNote] = useState('')
  const [savingNote, setSavingNote] = useState(false)

  const load = useCallback(async () => {
    const response = await fetch(`/api/models/${modelId}/report`).catch(() => null)
    if (response?.ok) setAbout((await response.json()).about ?? null)
    setLoaded(true)
  }, [modelId])

  useEffect(() => { void load() }, [load])

  async function generate() {
    setWorking(true)
    setError(null)
    const response = await fetch(`/api/models/${modelId}/report`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paste: paste.trim() || undefined }),
    }).catch(() => null)
    const body = await response?.json().catch(() => null)
    if (response?.ok && body?.about) {
      setAbout(body.about)
      setPaste('')
      setPasteOpen(false)
    } else {
      setError(body?.error ?? 'The report did not come back — try again.')
    }
    setWorking(false)
  }

  async function correct() {
    const text = note.trim()
    if (!text) return
    setSavingNote(true)
    const response = await fetch(`/api/models/${modelId}/report`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ note: text }),
    }).catch(() => null)
    const body = await response?.json().catch(() => null)
    if (response?.ok && body?.about) {
      setAbout(body.about)
      setNote('')
    } else {
      setError(body?.error ?? 'The correction did not save.')
    }
    setSavingNote(false)
  }

  if (!loaded) return <p className="dash-empty" aria-busy="true">Reading…</p>

  return (
    <div className="strategy">
      {!about && (
        <section className="strategy-start">
          <p className="strategy-lede">
            No report yet. One run reads everything on file for {name} — profile, questionnaire,
            intake dumps, her winners, transcripts of her own videos, her feedback — and writes
            the full creative strategy. Anything the sources cannot answer comes back as the
            questions to ask her.
          </p>
          <textarea
            value={paste}
            onChange={(event) => setPaste(event.target.value)}
            placeholder="Optional: paste meeting notes, a call transcript, or anything else worth reading for this run…"
            rows={6}
          />
          <button type="button" className="strategy-go" onClick={() => void generate()} disabled={working}>
            {working ? 'Writing the report — this takes a minute or two…' : 'Build her report'}
          </button>
          {error && <p className="dash-error" role="alert">{error}</p>}
        </section>
      )}

      {about && (
        <>
          <header className="strategy-head">
            <p className="strategy-meta">
              Generated {about.generated_at.slice(0, 10)}
              {Object.keys(about.sources).length > 0 && <> · read {Object.keys(about.sources).length} sources</>}
            </p>
            <div className="strategy-tools">
              <button type="button" className="chip" onClick={() => setPasteOpen((open) => !open)}>
                {pasteOpen ? 'Close' : 'Regenerate…'}
              </button>
            </div>
          </header>
          {ENGINE_NOTE[about.engine] && <p className="strategy-engine">{ENGINE_NOTE[about.engine]}</p>}

          {pasteOpen && (
            <section className="strategy-start">
              <textarea
                value={paste}
                onChange={(event) => setPaste(event.target.value)}
                placeholder="Optional: paste anything new worth reading — meeting notes, a call transcript…"
                rows={5}
              />
              <button type="button" className="strategy-go" onClick={() => void generate()} disabled={working}>
                {working ? 'Writing the report — this takes a minute or two…' : 'Regenerate the report'}
              </button>
            </section>
          )}
          {error && <p className="dash-error" role="alert">{error}</p>}

          {about.report.gaps.length > 0 && (
            <section className="strategy-gaps" aria-label="Questions to ask her">
              <p className="strategy-label">Ask her — the report would sharpen with these</p>
              <ul>
                {about.report.gaps.map((gap, index) => (
                  <li key={index}><b>{gap.about}</b> — {gap.question}</li>
                ))}
              </ul>
            </section>
          )}

          <div className="strategy-sections">
            {about.report.sections.map((section, index) => (
              <details key={section.id} className="strategy-section" open={index < 4}>
                <summary>
                  <span className="strategy-no">{String(index + 1).padStart(2, '0')}</span>
                  {section.title}
                </summary>
                <p>{section.body}</p>
              </details>
            ))}
          </div>

          <section className="strategy-correct" aria-label="Corrections">
            <p className="strategy-label">Corrections — permanent, folded into every regeneration</p>
            {about.corrections.length > 0 && (
              <ul className="strategy-notes">
                {about.corrections.map((c, index) => (
                  <li key={index}><span>{c.at.slice(0, 10)}</span> {c.note}</li>
                ))}
              </ul>
            )}
            <div className="strategy-correct-row">
              <input
                type="text"
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="e.g. too anti-men; she never swears; stop leaning on car content…"
                maxLength={600}
                onKeyDown={(event) => { if (event.key === 'Enter') void correct() }}
              />
              <button type="button" className="chip" onClick={() => void correct()} disabled={savingNote || !note.trim()}>
                {savingNote ? 'Saving…' : 'Add'}
              </button>
            </div>
          </section>
        </>
      )}
    </div>
  )
}
