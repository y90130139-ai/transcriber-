'use client'

import { useEffect, useState } from 'react'
import { upload } from '@vercel/blob/client'
import { DAY_SHORT } from '@/lib/dates'
import {
  DEFAULT_ZONE, REGIONS, displayPlace, isKnownZone, placeFor, timeIn, zoneForPlace,
} from '@/lib/timezones'
import { taxonomy, type Axis } from '@/lib/taxonomy'
import type { Model } from './types'

const COPY_RESET_MS = 1600

/** One axis of the taxonomy, ticked off against a model. Same vocabulary the
 *  library tags videos with, which is the whole point — it is what lets the two
 *  sides find each other. Uncapped: as many as actually apply. */
function AxisPicker({
  title,
  axis,
  chosen,
  hint,
  tone,
  onChange,
}: {
  title: string
  axis: Axis
  chosen: string[]
  hint: string
  tone?: 'refuse'
  onChange: (next: string[]) => void
}) {
  const [open, setOpen] = useState(false)
  const options = taxonomy[axis].tags
  const toggle = (id: string) =>
    onChange(chosen.includes(id) ? chosen.filter((tag) => tag !== id) : [...chosen, id])

  return (
    <div className="axis" data-tone={tone}>
      <div className="axis-head">
        <span className="axis-name">{title}</span>
        <button className="axis-confirm" onClick={() => setOpen((shown) => !shown)}>
          {open ? 'Done' : chosen.length > 0 ? `Edit · ${chosen.length}` : 'Choose'}
        </button>
      </div>
      <div className="chips">
        {chosen.map((tag) => (
          <button
            key={tag}
            className="chip"
            data-origin={tone === 'refuse' ? undefined : 'human'}
            data-refuse={tone === 'refuse' || undefined}
            onClick={() => toggle(tag)}
          >
            {options.find((option) => option.id === tag)?.label ?? tag}
          </button>
        ))}
        {chosen.length === 0 && !open && <span className="hint">{hint}</span>}
      </div>
      {open && (
        <div className="picker">
          <div className="picker-grid">
            {options.map((tag) => (
              <button
                key={tag.id}
                className="picker-option"
                data-on={chosen.includes(tag.id)}
                onClick={() => toggle(tag.id)}
              >
                <b>{tag.label}</b>
                <span>{tag.desc}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

const BLANK = {
  name: '',
  handle: '',
  photo_url: null as string | null,
  persona: [] as string[],
  formats: [] as string[],
  hooks: [] as string[],
  wont_do: [] as string[],
  status: 'active' as 'active' | 'paused',
  tier: 'B' as 'A' | 'B' | 'C',
  filming_days: [] as number[],
  weekly_target: 21,
  timezone: DEFAULT_ZONE,
  // The place is what the select is keyed on; the zone is what everything
  // else reads. Both are held so the picker can show what was picked.
  place: placeFor(DEFAULT_ZONE),
  standing_rules: '',
  notes: '',
}

/** Add or edit one of our models, and hold the one link she ever gets. */
export default function ModelSheet({
  model,
  onClose,
  onSaved,
}: {
  model: Model | null
  onClose: () => void
  onSaved: () => void
}) {
  const [form, setForm] = useState(() =>
    model
      ? {
          name: model.name,
          handle: model.handle ?? '',
          photo_url: model.photo_url,
          persona: model.persona,
          formats: model.formats ?? [],
          hooks: model.hooks ?? [],
          wont_do: model.wont_do ?? [],
          status: model.status,
          tier: model.tier ?? 'B',
          filming_days: model.filming_days,
          weekly_target: model.weekly_target,
          timezone: model.timezone,
          place: displayPlace(model.place ?? null, model.timezone),
          standing_rules: model.standing_rules ?? '',
          notes: model.notes ?? '',
        }
      : BLANK,
  )
  const [token, setToken] = useState(model?.access_token ?? null)
  const [revoked, setRevoked] = useState(Boolean(model?.token_revoked_at))
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<{ text: string; bad?: boolean } | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm((current) => ({ ...current, [key]: value }))

  async function takePhoto(file: File | undefined) {
    if (!file) return
    setBusy(true)
    setNote({ text: 'Uploading the photo…' })
    try {
      // Straight to Blob from the browser, the same path the phone uploads take.
      const blob = await upload(file.name, file, {
        access: 'public',
        handleUploadUrl: '/api/uploads/photo',
      })
      set('photo_url', blob.url)
      setNote(null)
    } catch (error) {
      setNote({ text: error instanceof Error ? error.message : 'Upload failed.', bad: true })
    }
    setBusy(false)
  }

  async function save(tokenAction?: 'rotate' | 'revoke') {
    if (!form.name.trim()) {
      setNote({ text: 'She needs a name.', bad: true })
      return
    }
    setBusy(true)
    setNote(null)

    const response = await fetch(model ? `/api/models/${model.id}` : '/api/models', {
      method: model ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...form,
        handle: form.handle || null,
        standing_rules: form.standing_rules || null,
        notes: form.notes || null,
        ...(tokenAction ? { token: tokenAction } : {}),
      }),
    })
    const body = await response.json().catch(() => ({}))
    setBusy(false)

    if (!response.ok) {
      setNote({ text: body.error ?? 'Could not save that.', bad: true })
      return
    }
    if (tokenAction) {
      setToken(body.model?.access_token ?? null)
      setRevoked(Boolean(body.model?.token_revoked_at))
      setNote({ text: tokenAction === 'rotate' ? 'New link minted. The old one is dead.' : 'Link revoked.' })
      return
    }
    onSaved()
  }

  async function remove() {
    if (!model) return
    if (!confirm(`Remove ${model.name} and every plan of hers?`)) return
    setBusy(true)
    await fetch(`/api/models/${model.id}`, { method: 'DELETE' })
    setBusy(false)
    onSaved()
  }

  const shareUrl = token && typeof window !== 'undefined' ? `${window.location.origin}/p/${token}` : null

  return (
    <>
      <button className="reader-scrim" onClick={onClose} aria-label="Close" />
      <aside className="reader" aria-label={model ? `Edit ${model.name}` : 'Add a model'}>
        <header className="reader-head">
          <button className="reader-close" onClick={onClose} aria-label="Close">Close</button>
          <h3>{model ? model.name : 'New model'}</h3>
          <p className="facts">{model ? 'Ours — not a researched account' : 'One of ours'}</p>
        </header>

        <div className="reader-body">
          <div className="form-row form-photo">
            <span className="model-frame form-photo-frame">
              {form.photo_url ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img src={form.photo_url} alt="" width={200} height={200} />
              ) : (
                <span className="card-frame-empty">{form.name || '—'}</span>
              )}
            </span>
            <div>
              <label className="btn btn-quiet" style={{ display: 'inline-block', cursor: 'pointer' }}>
                {form.photo_url ? 'Replace photo' : 'Add a photo'}
                <input
                  type="file"
                  accept="image/*"
                  hidden
                  onChange={(event) => void takePhoto(event.target.files?.[0])}
                />
              </label>
              {form.photo_url && (
                <button className="axis-confirm" onClick={() => set('photo_url', null)}>
                  Remove
                </button>
              )}
            </div>
          </div>

          <div className="form-row">
            <label className="axis-name" htmlFor="model-name">Name</label>
            <input
              id="model-name"
              className="field"
              value={form.name}
              onChange={(event) => set('name', event.target.value)}
              placeholder="What she goes by"
            />
          </div>

          <div className="form-row">
            <label className="axis-name" htmlFor="model-handle">Handle</label>
            <input
              id="model-handle"
              className="field"
              value={form.handle}
              onChange={(event) => set('handle', event.target.value)}
              placeholder="without the @"
            />
          </div>

          <AxisPicker
            title="Persona"
            axis="persona"
            chosen={form.persona}
            hint="Where she sits, in the same vocabulary as the library."
            onChange={(next) => set('persona', next)}
          />

          <AxisPicker
            title="Formats she does"
            axis="format"
            chosen={form.formats}
            hint="Tick what she can actually shoot. This is what drives recommendations."
            onChange={(next) =>
              setForm((current) => ({
                ...current,
                formats: next,
                // A format cannot be both something she does and something she refuses.
                wont_do: current.wont_do.filter((tag) => !next.includes(tag)),
              }))
            }
          />

          <AxisPicker
            title="Hooks that work for her"
            axis="hook"
            chosen={form.hooks}
            hint="Optional — a tiebreaker, not a requirement."
            onChange={(next) => set('hooks', next)}
          />

          <AxisPicker
            title="Won't do"
            axis="format"
            tone="refuse"
            chosen={form.wont_do}
            hint="Anything here is excluded outright, never just ranked lower."
            onChange={(next) =>
              setForm((current) => ({
                ...current,
                wont_do: next,
                formats: current.formats.filter((tag) => !next.includes(tag)),
              }))
            }
          />

          <div className="form-row">
            <span className="axis-name">Filming days</span>
            <div className="daypicker" role="group" aria-label="Filming days">
              {DAY_SHORT.map((day, index) => (
                <button
                  key={day}
                  className="chip"
                  data-on={form.filming_days.includes(index)}
                  aria-pressed={form.filming_days.includes(index)}
                  onClick={() =>
                    set('filming_days', form.filming_days.includes(index)
                      ? form.filming_days.filter((existing) => existing !== index)
                      : [...form.filming_days, index].sort((a, b) => a - b))
                  }
                >
                  {day}
                </button>
              ))}
            </div>
          </div>

          <div className="form-pair">
            <div className="form-row">
              <label className="axis-name" htmlFor="model-target">Weekly target</label>
              <input
                id="model-target"
                className="field"
                type="number"
                min={0}
                max={200}
                value={form.weekly_target}
                onChange={(event) => set('weekly_target', Number(event.target.value))}
              />
            </div>
            <div className="form-row">
              <label className="axis-name" htmlFor="model-tz">Where she is</label>
              {/* Keyed on the place, never the zone. Thirty US entries share
                  `America/New_York`, and a controlled select matches the first
                  option carrying its value — so keying on the zone snapped
                  every Eastern state back to Connecticut and every Central one
                  back to Alabama. The zone is derived from the choice below. */}
              <select
                id="model-tz"
                className="field"
                value={form.place ?? ''}
                onChange={(event) => {
                  const label = event.target.value
                  const zone = zoneForPlace(label)
                  // The escape hatch below has no place, only a zone. Picking it
                  // again must leave her exactly where she was.
                  if (!zone) { setForm((prev) => ({ ...prev, place: null })); return }
                  setForm((prev) => ({ ...prev, place: label, timezone: zone }))
                }}
              >
                {/* A zone set before this picker existed, or by hand, stays
                    selectable — saving must not quietly move her a state over. */}
                {!isKnownZone(form.timezone) && (
                  <option value="">{form.timezone} (already set)</option>
                )}
                {REGIONS.map((region) => (
                  <optgroup key={region.region} label={region.region}>
                    {region.places.map((place) => (
                      <option key={`${region.region}:${place.label}`} value={place.label}>
                        {place.label}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
              {/* The clock is the check: it proves the place picked is the one meant. */}
              <span className="hint">
                {timeIn(form.timezone)
                  ? `It's ${timeIn(form.timezone)} there · ${form.timezone}`
                  : form.timezone}
              </span>
            </div>
          </div>

          <div className="form-row">
            <label className="axis-name" htmlFor="model-rules">
              Standing rules — she sees these on every plan
            </label>
            <textarea
              id="model-rules"
              className="field"
              rows={3}
              value={form.standing_rules}
              onChange={(event) => set('standing_rules', event.target.value)}
              placeholder="Never show face. No gym content."
            />
          </div>

          <div className="form-row">
            <label className="axis-name" htmlFor="model-notes">
              Your notes — she never sees these
            </label>
            <textarea
              id="model-notes"
              className="field"
              rows={2}
              value={form.notes}
              onChange={(event) => set('notes', event.target.value)}
            />
          </div>

          {/* How much of her week is made for her. Nothing in the data can
              work this out — every plan item is a library reference — so it is
              stated here and the roster groups on it. */}
          <div className="form-row">
            <span className="axis-name">Tier</span>
            <div className="chips">
              {([
                ['A', 'A · bespoke'],
                ['B', 'B · mixed'],
                ['C', 'C · library only'],
              ] as const).map(([value, label]) => (
                <button
                  key={value}
                  className="chip"
                  data-on={form.tier === value}
                  onClick={() => set('tier', value)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="form-row">
            <span className="axis-name">Status</span>
            <div className="chips">
              {(['active', 'paused'] as const).map((status) => (
                <button
                  key={status}
                  className="chip"
                  data-on={form.status === status}
                  onClick={() => set('status', status)}
                >
                  {status}
                </button>
              ))}
            </div>
          </div>

          {model && (
            <div className="axis">
              <div className="axis-head"><span className="axis-name">Her link</span></div>
              {revoked ? (
                <p className="hint" data-tone="bad">Revoked. The old URL now 404s.</p>
              ) : (
                <p className="sharelink">{shareUrl ?? '—'}</p>
              )}
              <div className="copybar" style={{ padding: 0, border: 0, background: 'none' }}>
                <button
                  className="btn btn-quiet"
                  disabled={!shareUrl || revoked}
                  onClick={async () => {
                    if (!shareUrl) return
                    await navigator.clipboard.writeText(shareUrl)
                    setCopied(true)
                    setTimeout(() => setCopied(false), COPY_RESET_MS)
                  }}
                >
                  {copied ? 'Copied' : 'Copy link'}
                </button>
                <button className="btn btn-quiet" disabled={busy} onClick={() => save('rotate')}>
                  New link
                </button>
                {!revoked && (
                  <button className="btn btn-quiet" disabled={busy} onClick={() => save('revoke')}>
                    Revoke
                  </button>
                )}
              </div>
            </div>
          )}

          <div className="copybar" style={{ position: 'static' }}>
            <button className="btn" disabled={busy} onClick={() => save()}>
              {busy ? 'Working' : model ? 'Save' : 'Add her'}
            </button>
            {model && (
              <button className="btn btn-quiet" disabled={busy} onClick={remove}>Remove</button>
            )}
            {note && <span className="hint" data-tone={note.bad ? 'bad' : undefined}>{note.text}</span>}
          </div>
        </div>
      </aside>
    </>
  )
}
