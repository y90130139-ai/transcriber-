'use client'

import { DAY_SHORT } from '@/lib/dates'
import { REGIONS, isKnownZone, timeIn, zoneForPlace } from '@/lib/timezones'
import DropSelect from '../../dashboard/DropSelect'
import type { ProfileForm, SetField } from './form'

const TIERS = [
  ['A', 'A · bespoke'],
  ['B', 'B · mixed'],
  ['C', 'C · library only'],
] as const

/** How her week is shaped, and where the footage goes when it is shot. */
export default function WeekTab({
  form,
  set,
  setForm,
}: {
  form: ProfileForm
  set: SetField
  setForm: (update: (current: ProfileForm) => ProfileForm) => void
}) {
  return (
    <>
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
          <label className="axis-name" htmlFor="model-tz">Where they are</label>
          {/* Keyed on the place, never the zone. Thirty US entries share
              `America/New_York`, and a controlled select matches the first
              option carrying its value — so keying on the zone snapped every
              Eastern state back to Connecticut and every Central one back to
              Alabama. The zone is derived from the choice below. */}
          <DropSelect
            id="model-tz"
            label="Where they are"
            value={form.place ?? ''}
            onChange={(next) => {
              const zone = zoneForPlace(next)
              // The escape hatch below has no place, only a zone. Picking it
              // again must leave her exactly where she was.
              if (!zone) { setForm((prev) => ({ ...prev, place: null })); return }
              setForm((prev) => ({ ...prev, place: next, timezone: zone }))
            }}
            options={[
              // A zone set before this picker existed, or by hand, stays
              // selectable — saving must not quietly move her a state over.
              ...(!isKnownZone(form.timezone)
                ? [{ value: '', label: `${form.timezone} (already set)` }]
                : []),
              ...REGIONS.flatMap((region) =>
                region.places.map((place) => ({ value: place.label, label: place.label }))),
            ]}
          />
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
          Standing rules — they see these on every plan
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

      {/* The one thing the plan never told her. Neither field is required: a
          model with a folder and no note renders the link alone, one with a
          note and no folder renders the note alone, and one with neither
          renders no delivery block at all rather than an empty box. */}
      <div className="form-row">
        <label className="axis-name" htmlFor="model-drive">
          Where they send the footage — they see this on every plan
        </label>
        <input
          id="model-drive"
          className="field"
          type="url"
          value={form.drive_url}
          onChange={(event) => set('drive_url', event.target.value)}
          placeholder="https://drive.google.com/drive/folders/…"
        />
        <span className="hint">
          Their own Drive folder — the one they already have access to. Left empty,
          the line below stands on its own.
        </span>
      </div>

      <div className="form-row">
        <label className="axis-name" htmlFor="model-delivery">
          And what to do if that will not open
        </label>
        <textarea
          id="model-delivery"
          className="field"
          rows={2}
          value={form.delivery_note}
          onChange={(event) => set('delivery_note', event.target.value)}
        />
      </div>

      {/* How much of her week is made for her. Nothing in the data can work
          this out — every plan item is a library reference — so it is stated
          here and the roster groups on it. */}
      <div className="form-pair">
        <div className="form-row">
          <span className="axis-name">Tier</span>
          <div className="chips">
            {TIERS.map(([value, label]) => (
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

      </div>
    </>
  )
}
