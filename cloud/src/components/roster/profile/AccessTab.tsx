'use client'

import { useState } from 'react'
import { ANY_FORMAT, OVERRIDE_FIELDS, type OverrideField } from '@/lib/brief'
import { DECLINE_LABEL, isDeclineCode } from '@/lib/decline'
import { taxonomy } from '@/lib/taxonomy'
import type { ProfileForm, SetField } from './form'

const COPY_RESET_MS = 1600

/** What each brief field is called on her sheet. The same words her card uses,
 *  so setting one and reading it back are obviously the same thing. */
const FIELD_LABEL: Record<OverrideField, string> = {
  wardrobe: 'Wardrobe',
  camera: 'Camera',
  takes: 'Takes',
  sound: 'Sound',
  caption: 'Caption',
}

export type Override = { format: string; field: OverrideField; value: string }

/** The private half: the link she gets, the notes she never sees, her own brief
 *  wording, and what she has turned down. */
export default function AccessTab({
  form,
  set,
  shareUrl,
  revoked,
  busy,
  hasModel,
  defaults,
  setDefaults,
  declines,
  onToken,
}: {
  form: ProfileForm
  set: SetField
  shareUrl: string | null
  revoked: boolean
  busy: boolean
  hasModel: boolean
  defaults: Override[]
  setDefaults: (update: (current: Override[]) => Override[]) => void
  declines: { code: string | null; n: number }[]
  onToken: (action: 'rotate' | 'revoke') => void
}) {
  const [copied, setCopied] = useState(false)

  return (
    <>
      <div className="form-row">
        <label className="axis-name" htmlFor="model-notes">
          Your notes — they never see these
        </label>
        <textarea
          id="model-notes"
          className="field"
          rows={3}
          value={form.notes}
          onChange={(event) => set('notes', event.target.value)}
        />
      </div>

      {/* The brief's lookup tables are global, so two creators shooting the
          same format get byte-identical wardrobe lines. These are hers, in
          front of them. Standing facts about her, like standing rules — which
          is why they live here and not in the plan editor.

          Read only while drafting: setting one never rewrites a card that has
          already been authored. */}
      <div className="axis">
        <div className="axis-head">
          <span className="axis-name">Their own brief lines</span>
          <button
            className="axis-confirm"
            onClick={() =>
              setDefaults((current) => [
                ...current,
                { format: ANY_FORMAT, field: 'wardrobe', value: '' },
              ])
            }
          >
            Add a line
          </button>
        </div>

        {defaults.length === 0 ? (
          <span className="hint">
            Nothing set — every format falls back to the shared wording.
          </span>
        ) : (
          <ul className="overrides">
            {defaults.map((row, index) => (
              <li key={`${row.format}-${row.field}-${index}`} className="override">
                <select
                  className="field"
                  value={row.format}
                  aria-label="Which format"
                  onChange={(event) =>
                    setDefaults((current) => current.map((one, at) =>
                      at === index ? { ...one, format: event.target.value } : one))
                  }
                >
                  <option value={ANY_FORMAT}>Every format of theirs</option>
                  {form.formats.map((tag) => (
                    <option key={tag} value={tag}>
                      {taxonomy.format.tags.find((one) => one.id === tag)?.label ?? tag}
                    </option>
                  ))}
                </select>
                <select
                  className="field"
                  value={row.field}
                  aria-label="Which field"
                  onChange={(event) =>
                    setDefaults((current) => current.map((one, at) =>
                      at === index
                        ? { ...one, field: event.target.value as OverrideField }
                        : one))
                  }
                >
                  {OVERRIDE_FIELDS.map((field) => (
                    <option key={field} value={field}>{FIELD_LABEL[field]}</option>
                  ))}
                </select>
                <input
                  className="field"
                  value={row.value}
                  placeholder="What their card should say instead"
                  onChange={(event) =>
                    setDefaults((current) => current.map((one, at) =>
                      at === index ? { ...one, value: event.target.value } : one))
                  }
                />
                <button
                  className="chip"
                  aria-label="Remove this line"
                  onClick={() => setDefaults((current) => current.filter((_, at) => at !== index))}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
        {form.standing_rules && /face/i.test(form.standing_rules) && (
          <span className="hint">
            Their standing rules mention their face, so the camera line stays the
            no-face framing whatever is set here.
          </span>
        )}
      </div>

      {/* A constraint, not a mood. Three "nowhere to film" is a fact about
          where she lives and it should change what gets put on her week — which
          it cannot do while it is only ever three sentences in three different
          cards. */}
      {declines.length > 0 && (
        <div className="axis">
          <div className="axis-head">
            <span className="axis-name">What they have turned down</span>
            <span className="hint">
              {declines.reduce((total, row) => total + row.n, 0)} in all
            </span>
          </div>
          <ul className="declines">
            {declines.map((row) => (
              <li key={row.code ?? 'unsaid'}>
                <b>{row.n}</b>
                <span>
                  {isDeclineCode(row.code) ? DECLINE_LABEL[row.code] : 'No reason picked'}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {hasModel && (
        <div className="axis">
          <div className="axis-head"><span className="axis-name">Their link</span></div>
          {revoked ? (
            <p className="hint" data-tone="bad">Revoked. The old URL now 404s.</p>
          ) : (
            <p className="sharelink">{shareUrl ?? '—'}</p>
          )}
          <div className="copybar" style={{ padding: 0, border: 0, background: 'none', position: 'static' }}>
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
            <button className="btn btn-quiet" disabled={busy} onClick={() => onToken('rotate')}>
              New link
            </button>
            {!revoked && (
              <button className="btn btn-quiet" disabled={busy} onClick={() => onToken('revoke')}>
                Revoke
              </button>
            )}
          </div>
        </div>
      )}
    </>
  )
}
