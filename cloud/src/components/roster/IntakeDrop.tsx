'use client'

import { useEffect, useState } from 'react'
import { upload } from '@vercel/blob/client'
import { DAY_SHORT } from '@/lib/dates'
import type { IntakeFields, IntakeProposal, Mapped } from '@/lib/intake'

/** What the operator ticked, on its way back into the sheet's own form state. */
export type IntakePick = {
  intakeId: string
  persona: string[]
  formats: string[]
  hooks: string[]
  wont_do: string[]
  fields: IntakeFields
}

type Stored = {
  id: string
  source_url: string | null
  filename: string | null
  parsed: IntakeProposal
  applied_at: string | null
  created_at: string
}

const AXIS_TITLE: Record<keyof Omit<IntakePick, 'intakeId' | 'fields'>, string> = {
  persona: 'Persona',
  formats: 'Formats she does',
  hooks: 'Hooks',
  wont_do: "Won't do",
}

const FIELD_TITLE: Record<keyof IntakeFields, string> = {
  name: 'Name',
  handle: 'Handle',
  place: 'Where she is',
  timezone: 'Timezone',
  filming_days: 'Filming days',
  weekly_target: 'Weekly target',
  ig_account_type: 'Instagram account',
  drive_url: 'Drive folder',
  standing_rules: 'Standing rules',
}

/** `timezone` rides along with `place` and is never ticked on its own — the
 *  zone is derived from the place, and offering both invites them to disagree. */
const HIDDEN_FIELDS = new Set<keyof IntakeFields>(['timezone'])

function showValue(key: keyof IntakeFields, value: unknown): string {
  if (key === 'filming_days' && Array.isArray(value)) {
    return value.length === 0 ? 'none' : value.map((day) => DAY_SHORT[Number(day)]).join(' ')
  }
  return String(value)
}

/**
 * Her intake form, read into the profile beside it.
 *
 * The mapping is rule-based and it proposes rather than saves — see
 * `lib/intake.ts`. Everything it is sure of is ticked; everything it inferred
 * is offered dashed and unticked, because an inference about a person is a
 * claim. Applying only fills the form above; nothing reaches the database
 * until the sheet's own Save.
 */
export default function IntakeDrop({
  modelId,
  onApply,
}: {
  modelId: string | null
  onApply: (picked: IntakePick) => void
}) {
  const [stored, setStored] = useState<Stored | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [paste, setPaste] = useState('')
  const [pasting, setPasting] = useState(false)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<{ text: string; bad?: boolean } | null>(null)

  useEffect(() => {
    if (!modelId) return
    fetch(`/api/models/${modelId}/intake`)
      .then((response) => (response.ok ? response.json() : { intake: null }))
      .then((body) => take(body.intake ?? null))
      .catch(() => setStored(null))
    // `take` is stable for one mount and re-running on it would clear the pick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelId])

  /** Hold a proposal and pre-tick everything it is sure of. */
  function take(intake: Stored | null) {
    setStored(intake)
    if (!intake) { setPicked(new Set()); return }
    const sure = new Set<string>()
    for (const [group, tags] of Object.entries(intake.parsed) as [string, Mapped[]][]) {
      if (!Array.isArray(tags)) continue
      for (const tag of tags) if (tag?.why === 'label') sure.add(`${group}:${tag.tag}`)
    }
    const unsure = new Set(intake.parsed.unsure ?? [])
    for (const key of Object.keys(intake.parsed.fields ?? {})) {
      if (!unsure.has(key)) sure.add(`field:${key}`)
    }
    setPicked(sure)
  }

  const toggle = (key: string) =>
    setPicked((current) => {
      const next = new Set(current)
      if (!next.delete(key)) next.add(key)
      return next
    })

  async function send(payload: { text?: string; url?: string; filename?: string }) {
    if (!modelId) return
    setBusy(true)
    setNote(null)
    const response = await fetch(`/api/models/${modelId}/intake`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const body = await response.json().catch(() => ({}))
    setBusy(false)

    if (!response.ok || body.error) {
      setNote({ text: body.error ?? 'Could not read that form.', bad: true })
      if (body.readable === false) setPasting(true)
      return
    }
    take(body.intake)
    setPaste('')
    setPasting(false)
    const read = body.intake?.parsed?.answers ?? 0
    setNote({ text: read > 0 ? `Read ${read} answer${read === 1 ? '' : 's'}.` : 'Nothing readable in that.' })
  }

  async function takeFile(file: File | undefined) {
    if (!file || !modelId) return
    setBusy(true)
    setNote({ text: 'Uploading the form…' })
    try {
      // Straight to Blob from the browser, the same path the phone uploads and
      // her photo take. The file is kept: it is the record of what she sent.
      const blob = await upload(file.name, file, {
        access: 'public',
        handleUploadUrl: '/api/uploads/intake',
      })
      await send({ url: blob.url, filename: file.name })
    } catch (error) {
      setNote({ text: error instanceof Error ? error.message : 'Upload failed.', bad: true })
      setBusy(false)
    }
  }

  function apply() {
    if (!stored) return
    const chosen = (group: 'persona' | 'formats' | 'hooks' | 'wont_do') =>
      (stored.parsed[group] ?? []).filter((tag) => picked.has(`${group}:${tag.tag}`)).map((tag) => tag.tag)

    const fields: IntakeFields = {}
    for (const [key, value] of Object.entries(stored.parsed.fields ?? {})) {
      // The zone is carried by the place it was derived from, never on its own.
      if (key === 'timezone' ? picked.has('field:place') : picked.has(`field:${key}`)) {
        Object.assign(fields, { [key]: value })
      }
    }

    onApply({
      intakeId: stored.id,
      persona: chosen('persona'),
      formats: chosen('formats'),
      hooks: chosen('hooks'),
      wont_do: chosen('wont_do'),
      fields,
    })
    setNote({ text: 'Filled in above. Nothing is saved until you hit Save.' })
  }

  if (!modelId) {
    return (
      <div className="axis">
        <div className="axis-head"><span className="axis-name">Her intake form</span></div>
        <span className="hint">Save her first, then drop the form in and it fills this sheet.</span>
      </div>
    )
  }

  const proposal = stored?.parsed
  const fields = Object.entries(proposal?.fields ?? {})
    .filter(([key]) => !HIDDEN_FIELDS.has(key as keyof IntakeFields))

  return (
    <div className="axis intake">
      <div className="axis-head">
        <span className="axis-name">Her intake form</span>
        <span className="hint">
          {stored
            ? `${stored.filename ?? 'Pasted'} · ${stored.applied_at ? 'applied' : 'not applied yet'}`
            : 'None on file'}
        </span>
      </div>

      <div className="chips">
        <label className="btn btn-quiet" style={{ display: 'inline-block', cursor: 'pointer' }}>
          {stored ? 'Read another form' : 'Read her form'}
          <input
            type="file"
            accept=".txt,.md,.csv,.json,.pdf,.doc,.docx,.rtf,text/plain,text/markdown,text/csv,application/json,application/pdf"
            hidden
            disabled={busy}
            onChange={(event) => void takeFile(event.target.files?.[0])}
          />
        </label>
        <button className="axis-confirm" onClick={() => setPasting((open) => !open)}>
          {pasting ? 'Cancel' : 'Paste answers'}
        </button>
      </div>

      {pasting && (
        <div className="form-row" style={{ marginTop: 'var(--sc-space-3)' }}>
          <textarea
            className="field"
            rows={6}
            value={paste}
            onChange={(event) => setPaste(event.target.value)}
            placeholder={'What content do you make? GRWM, storytime\nWhat will you not do? gym, anything with my face'}
          />
          <button className="btn btn-quiet" disabled={busy || !paste.trim()} onClick={() => void send({ text: paste })}>
            Read it
          </button>
        </div>
      )}

      {note && <p className="hint" data-tone={note.bad ? 'bad' : undefined}>{note.text}</p>}

      {proposal && (
        <div className="intake-proposal">
          {fields.length > 0 && (
            <div className="intake-group">
              <span className="axis-name">Facts</span>
              <div className="chips">
                {fields.map(([key, value]) => (
                  <button
                    key={key}
                    className="chip"
                    data-on={picked.has(`field:${key}`)}
                    onClick={() => toggle(`field:${key}`)}
                    data-origin={
                      proposal.unsure?.includes(key) && !picked.has(`field:${key}`) ? 'auto' : undefined
                    }
                    title={
                      proposal.unsure?.includes(key)
                        ? `More than one place answers to that — check the clock. From: ${proposal.fieldSources?.[key] ?? ''}`
                        : proposal.fieldSources?.[key] ?? undefined
                    }
                  >
                    {FIELD_TITLE[key as keyof IntakeFields] ?? key} · {showValue(key as keyof IntakeFields, value)}
                  </button>
                ))}
              </div>
            </div>
          )}

          {(['persona', 'formats', 'hooks', 'wont_do'] as const).map((group) => {
            const tags = proposal[group] ?? []
            if (tags.length === 0) return null
            return (
              <div className="intake-group" key={group}>
                <span className="axis-name">{AXIS_TITLE[group]}</span>
                <div className="chips">
                  {tags.map((tag) => (
                    <button
                      key={tag.tag}
                      className="chip"
                      data-on={picked.has(`${group}:${tag.tag}`)}
                      data-origin={tag.why === 'keyword' && !picked.has(`${group}:${tag.tag}`) ? 'auto' : undefined}
                      onClick={() => toggle(`${group}:${tag.tag}`)}
                      title={tag.why === 'label' ? `She named it: ${tag.from}` : `Inferred from: ${tag.from}`}
                    >
                      {tag.label}
                    </button>
                  ))}
                </div>
              </div>
            )
          })}

          {/* What it could not place. Shown rather than dropped: the failure to
              avoid is a profile that looks complete and quietly is not. */}
          {proposal.unmapped.length > 0 && (
            <details className="intake-group">
              <summary className="axis-name">
                {proposal.unmapped.length} answer{proposal.unmapped.length === 1 ? '' : 's'} it made nothing of
              </summary>
              <ul className="intake-unmapped">
                {proposal.unmapped.map((answer, at) => (
                  <li key={at}>
                    {answer.question && <b>{answer.question}: </b>}
                    {answer.answer}
                  </li>
                ))}
              </ul>
            </details>
          )}

          <button className="btn btn-quiet" disabled={busy || picked.size === 0} onClick={apply}>
            Fill the sheet · {picked.size}
          </button>
        </div>
      )}
    </div>
  )
}
