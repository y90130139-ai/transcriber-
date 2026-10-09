'use client'

import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { DAY_SHORT } from '@/lib/dates'
import { isKnownZone, REGIONS, timeIn, zoneForPlace } from '@/lib/timezones'
import DropSelect from '../dashboard/DropSelect'
import SocialEditor from './profile/SocialEditor'
import TagsTab from './profile/TagsTab'
import type { ProfileForm, SetField } from './profile/form'

const CREATOR_CHOICES = [
  ['unknown', 'Not set'],
  ['woman', 'Woman'],
  ['man', 'Man'],
  ['trans-woman', 'Trans woman'],
  ['trans-man', 'Trans man'],
  ['non-binary', 'Non-binary'],
  ['couple', 'Couple'],
] as const

const IG_CHOICES = [
  ['unknown', 'Not checked'],
  ['professional', 'Professional'],
  ['personal', 'Personal'],
] as const

const TIERS = [
  ['A', 'Bespoke'],
  ['B', 'Mixed'],
  ['C', 'Library only'],
] as const

/**
 * Adding someone is one form, not the profile sheet with half its tabs empty.
 * Same fade and centering as the creator dialog: a grid layer on document.body,
 * so a transform on the panel can never park it off-center.
 */
export default function AddModelDialog({
  form,
  set,
  setForm,
  busy,
  note,
  closing,
  onClose,
  onSave,
  onPhoto,
}: {
  form: ProfileForm
  set: SetField
  setForm: (update: (current: ProfileForm) => ProfileForm) => void
  busy: boolean
  note: { text: string; bad?: boolean } | null
  closing: boolean
  onClose: () => void
  onSave: () => void
  onPhoto: (file: File | undefined) => void
}) {
  const file = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [])

  return createPortal(
    <div className="adddialog-layer" data-closing={closing || undefined}>
      <button className="adddialog-scrim" onClick={onClose} aria-label="Close" />
      <div className="adddialog" role="dialog" aria-modal="true" aria-label="Add a model">
        <header className="adddialog-head">
          <div>
            <p className="adddialog-kicker">Roster</p>
            <h2>Add a model</h2>
            <p className="adddialog-lead">A name is enough to start. The rest shapes their first week.</p>
          </div>
          <button className="adddialog-x" onClick={onClose} aria-label="Close">×</button>
        </header>

        <div className="adddialog-body">
          <section className="adddialog-section">
            <h3>Who they are</h3>
            <div className="adddialog-who">
              <button
                type="button"
                className="adddialog-photo"
                onClick={() => file.current?.click()}
                aria-label={form.photo_url ? 'Replace their photo' : 'Add a photo'}
              >
                {form.photo_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={form.photo_url} alt="" />
                ) : (
                  <span>Photo</span>
                )}
              </button>
              <input
                ref={file}
                type="file"
                accept="image/*"
                hidden
                onChange={(event) => {
                  onPhoto(event.target.files?.[0])
                  event.target.value = ''
                }}
              />
              <div className="adddialog-names">
                <label className="adddialog-label" htmlFor="add-name">Name</label>
                <input
                  id="add-name"
                  className="field"
                  value={form.name}
                  autoFocus
                  placeholder="What they go by"
                  onChange={(event) => set('name', event.target.value)}
                />
                <label className="adddialog-label" htmlFor="add-handle">Instagram handle</label>
                <input
                  id="add-handle"
                  className="field"
                  value={form.handle}
                  placeholder="without the @"
                  onChange={(event) => set('handle', event.target.value.replace(/^@+/, ''))}
                />
              </div>
            </div>
            {form.photo_url && (
              <button type="button" className="adddialog-quiet" onClick={() => set('photo_url', null)}>
                Remove photo
              </button>
            )}

            <p className="adddialog-label">Who the creator is</p>
            <div className="chips" role="group" aria-label="Creator type">
              {CREATOR_CHOICES.map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  className="chip"
                  data-on={form.creator_type === value}
                  aria-pressed={form.creator_type === value}
                  onClick={() => set('creator_type', value)}
                >
                  {label}
                </button>
              ))}
            </div>

            <p className="adddialog-label">Their Instagram account</p>
            <div className="chips" role="group" aria-label="Instagram account type">
              {IG_CHOICES.map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  className="chip"
                  data-on={form.ig_account_type === value}
                  aria-pressed={form.ig_account_type === value}
                  onClick={() => set('ig_account_type', value)}
                >
                  {label}
                </button>
              ))}
            </div>
          </section>

          <section className="adddialog-section">
            <SocialEditor socials={form.socials} onChange={(next) => set('socials', next)} />
          </section>

          <section className="adddialog-section">
            <h3>What they make</h3>
            <TagsTab form={form} set={set} setForm={setForm} />
          </section>

          <section className="adddialog-section">
            <h3>Their week</h3>
            <p className="adddialog-label">Tier</p>
            <div className="chips" role="group" aria-label="Tier">
              {TIERS.map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  className="chip"
                  data-on={form.tier === value}
                  aria-pressed={form.tier === value}
                  onClick={() => set('tier', value)}
                >
                  {value} · {label}
                </button>
              ))}
            </div>

            <p className="adddialog-label">Filming days</p>
            <div className="daypicker" role="group" aria-label="Filming days">
              {DAY_SHORT.map((day, index) => (
                <button
                  key={day}
                  type="button"
                  className="chip"
                  data-on={form.filming_days.includes(index)}
                  aria-pressed={form.filming_days.includes(index)}
                  onClick={() =>
                    set(
                      'filming_days',
                      form.filming_days.includes(index)
                        ? form.filming_days.filter((existing) => existing !== index)
                        : [...form.filming_days, index].sort((a, b) => a - b),
                    )
                  }
                >
                  {day}
                </button>
              ))}
            </div>

            <div className="adddialog-pair">
              <div>
                <label className="adddialog-label" htmlFor="add-target">Videos a week</label>
                <input
                  id="add-target"
                  className="field"
                  type="number"
                  min={0}
                  max={200}
                  value={form.weekly_target}
                  onChange={(event) => set('weekly_target', Number(event.target.value))}
                />
              </div>
              <div>
                <span className="adddialog-label">Where they are</span>
                <DropSelect
                  id="add-place"
                  label="Where they are"
                  value={form.place ?? ''}
                  onChange={(next) => {
                    const zone = zoneForPlace(next)
                    if (!zone) { setForm((prev) => ({ ...prev, place: null })); return }
                    setForm((prev) => ({ ...prev, place: next, timezone: zone }))
                  }}
                  options={[
                    ...(!isKnownZone(form.timezone)
                      ? [{ value: '', label: `${form.timezone} (already set)` }]
                      : []),
                    ...REGIONS.flatMap((region) =>
                      region.places.map((place) => ({ value: place.label, label: place.label }))),
                  ]}
                />
                <span className="hint">
                  {timeIn(form.timezone) ? `It's ${timeIn(form.timezone)} there` : form.timezone}
                </span>
              </div>
            </div>

            <label className="adddialog-label" htmlFor="add-rules">Standing rules</label>
            <textarea
              id="add-rules"
              className="field"
              rows={2}
              value={form.standing_rules}
              placeholder="Never show face. No gym content."
              onChange={(event) => set('standing_rules', event.target.value)}
            />

            <label className="adddialog-label" htmlFor="add-drive">Where the footage goes</label>
            <input
              id="add-drive"
              className="field"
              type="url"
              value={form.drive_url}
              placeholder="https://drive.google.com/drive/folders/…"
              onChange={(event) => set('drive_url', event.target.value)}
            />

            <label className="adddialog-label" htmlFor="add-delivery">If that folder will not open</label>
            <textarea
              id="add-delivery"
              className="field"
              rows={2}
              value={form.delivery_note}
              onChange={(event) => set('delivery_note', event.target.value)}
            />
          </section>

        </div>

        <footer className="adddialog-foot">
          {note && <span className="adddialog-note" data-bad={note.bad || undefined}>{note.text}</span>}
          <button type="button" className="adddialog-cancel" disabled={busy} onClick={onClose}>Cancel</button>
          <button type="button" className="adddialog-save" disabled={busy} onClick={onSave}>
            {busy ? 'Working' : 'Add them'}
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  )
}
