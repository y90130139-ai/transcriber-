'use client'

import {
  PLATFORMS, labelOfPlatform, platformOfUrl, readSocial,
  type Platform, type Social,
} from '@/lib/socials'
import DropSelect from '../../dashboard/DropSelect'

/**
 * Her accounts, as rows.
 *
 * What is held is `{platform, handle, url}` and what is typed is one box: paste
 * a link and the platform is read off the host, or type a bare handle and the
 * URL is built from the platform beside it. Both shapes arrive in practice —
 * a link from a phone's share sheet, a handle from her intake form — and asking
 * which one you have is the friction that leaves the field empty.
 *
 * Nothing is validated until save. `readSocial` is run here only to keep the
 * platform dropdown honest as you type; the server runs it again and drops
 * whatever will not parse, which is the same contract the Drive URL has.
 */
export default function SocialEditor({
  socials,
  onChange,
}: {
  socials: Social[]
  onChange: (next: Social[]) => void
}) {
  const setRow = (index: number, next: Social) =>
    onChange(socials.map((row, at) => (at === index ? next : row)))

  return (
    <div className="axis">
      <div className="axis-head">
        <span className="axis-name">Their accounts</span>
        <button
          className="axis-confirm"
          onClick={() => onChange([...socials, { platform: 'instagram', handle: '', url: '' }])}
        >
          Add an account
        </button>
      </div>

      {socials.length === 0 ? (
        <span className="hint">
          Nothing on file. Paste a link — Instagram, TikTok, OnlyFans, X, Reddit,
          anything — and it becomes a button on their profile and on their card.
        </span>
      ) : (
        <ul className="sociallist">
          {socials.map((row, index) => {
            const parsed = readSocial(row.platform, row.url)
            return (
            <li className="socialrow" key={index}>
              <DropSelect
                label="Which platform"
                value={row.platform}
                onChange={(next) => {
                  const platform = next as Platform
                  // Re-read what is already typed against the new platform, so
                  // a bare handle picks up the right profile route. A pasted
                  // URL keeps its own host — see `readSocial`.
                  setRow(index, readSocial(platform, row.url)
                    ?? { platform, handle: '', url: row.url })
                }}
                options={PLATFORMS.map((platform) => ({ value: platform, label: labelOfPlatform(platform) }))}
              />

              {/* Held exactly as typed until the field is left. Normalising on
                  every keystroke rewrites the box under the cursor — one
                  character of a handle becomes a whole profile URL and the next
                  character lands at the end of it. */}
              <input
                className="field"
                aria-label="Their handle or the link"
                value={row.url}
                placeholder="@handle, or paste the link"
                onChange={(event) => {
                  const typed = event.target.value
                  const pasted = /^https?:\/\//i.test(typed)
                  setRow(index, {
                    platform: pasted ? platformOfUrl(typed) : row.platform,
                    handle: '',
                    url: typed,
                  })
                }}
                onBlur={() => {
                  const settled = readSocial(row.platform, row.url)
                  if (settled) setRow(index, settled)
                }}
              />

              <span style={{ display: 'flex', gap: 'var(--sc-space-1)' }}>
                {/* Only once it parses. A half-typed row opening a new tab on
                    a stray tap is worse than no button at all. */}
                {parsed && (
                  <a
                    className="socialrow-open"
                    href={parsed.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`Open ${labelOfPlatform(row.platform)}`}
                  >
                    Open
                  </a>
                )}
                <button
                  className="chip"
                  aria-label="Remove this account"
                  onClick={() => onChange(socials.filter((_, at) => at !== index))}
                >
                  ×
                </button>
              </span>
            </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
