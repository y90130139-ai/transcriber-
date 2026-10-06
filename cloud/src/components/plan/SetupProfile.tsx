'use client'

import { useRef, useState } from 'react'
import { PALETTES, cleanStyle, type PortalStyle } from '@/lib/portal-style'

/**
 * "Set up your page" — her first open (Geno, 2026-10-06: pick the color
 * BEFORE the app, not at the foot of it). One sheet, three choices, all
 * optional: her photo, her color, light or dark. Save or "maybe later"
 * both mark the sheet done, so it shows exactly once; the Make-it-yours
 * panel at the foot stays for changing her mind any day after.
 *
 * The photo is resized in the browser (256px, JPEG) and stored on her
 * model profile — the same `photo_url` the console reads, so what she
 * picks here is what the team sees there.
 */

const PHOTO_SIZE = 256
const PHOTO_QUALITY = 0.84

async function shrink(file: File): Promise<string | null> {
  const url = URL.createObjectURL(file)
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = reject
      img.src = url
    })
    const side = Math.min(image.naturalWidth, image.naturalHeight)
    if (!side) return null
    const canvas = document.createElement('canvas')
    canvas.width = PHOTO_SIZE
    canvas.height = PHOTO_SIZE
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(
      image,
      (image.naturalWidth - side) / 2, (image.naturalHeight - side) / 2, side, side,
      0, 0, PHOTO_SIZE, PHOTO_SIZE,
    )
    return canvas.toDataURL('image/jpeg', PHOTO_QUALITY)
  } catch {
    return null
  } finally {
    URL.revokeObjectURL(url)
  }
}

export default function SetupProfile({
  token,
  name,
  photo,
  onClose,
}: {
  token: string
  name: string
  photo: string | null
  onClose: () => void
}) {
  const [pal, setPal] = useState('ember')
  // `document` only behind the guard: this component is server-rendered with
  // the rest of the page, and an unguarded read crashed SSR — Next silently
  // fell back to client-only rendering for the WHOLE plan (empty HTML shell,
  // caught on production 2026-10-06).
  const [mode, setMode] = useState<'light' | 'dark'>(() =>
    typeof document !== 'undefined' && document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light',
  )
  const [picture, setPicture] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  function applyPal(key: string) {
    setPal(key)
    if (key === 'ember') delete document.documentElement.dataset.pal
    else document.documentElement.dataset.pal = key
  }

  function applyMode(next: 'light' | 'dark') {
    setMode(next)
    document.documentElement.dataset.theme = next
    try { localStorage.setItem('sinaura-theme', next) } catch { /* private mode */ }
  }

  async function pickPhoto(file: File | undefined) {
    if (!file) return
    const dataUrl = await shrink(file)
    if (dataUrl) setPicture(dataUrl)
  }

  async function finish(save: boolean) {
    setBusy(true)
    const style: PortalStyle = save
      ? cleanStyle({ pal, mode, done: true })
      : cleanStyle({ done: true })
    if (!save) {
      // She waved it off — put the page back the way it was.
      delete document.documentElement.dataset.pal
    }
    const jobs: Promise<unknown>[] = [
      fetch(`/api/plan/${token}/style`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...style, done: true }),
      }).catch(() => null),
    ]
    if (save && picture) {
      jobs.push(fetch(`/api/plan/${token}/photo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data_url: picture }),
      }).catch(() => null))
    }
    await Promise.all(jobs)
    onClose()
  }

  const shown = picture ?? photo

  return (
    <div className="plan-setup-veil" role="dialog" aria-modal="true" aria-labelledby="plan-setup-head">
      <div className="plan-setup">
        <h2 id="plan-setup-head">Set up your page</h2>
        <p className="plan-setup-sub">Make it yours, {name} — you can change any of this later.</p>

        <button
          type="button"
          className="plan-setup-photo"
          onClick={() => fileRef.current?.click()}
          aria-label="Add a profile picture"
        >
          {shown ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={shown} alt="" width={96} height={96} />
          ) : (
            <span aria-hidden>+</span>
          )}
          <b>{shown ? 'Change photo' : 'Add a photo'}</b>
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(event) => void pickPhoto(event.target.files?.[0])}
        />

        <p className="plan-setup-label">Your color</p>
        <div className="plan-look-row" role="radiogroup" aria-label="Color">
          {PALETTES.map((palette) => (
            <button
              key={palette.key}
              type="button"
              className="plan-swatch"
              role="radio"
              aria-checked={pal === palette.key}
              data-on={pal === palette.key || undefined}
              style={{ background: mode === 'dark' ? palette.dark : palette.light }}
              title={palette.name}
              aria-label={palette.name}
              onClick={() => applyPal(palette.key)}
            />
          ))}
        </div>

        <p className="plan-setup-label">Your background</p>
        <div className="plan-look-row" role="radiogroup" aria-label="Background">
          <button type="button" className="plan-fontchip" role="radio" aria-checked={mode === 'light'}
                  data-on={mode === 'light' || undefined} onClick={() => applyMode('light')}>
            &#9728;&#65039; Light
          </button>
          <button type="button" className="plan-fontchip" role="radio" aria-checked={mode === 'dark'}
                  data-on={mode === 'dark' || undefined} onClick={() => applyMode('dark')}>
            &#127769; Dark
          </button>
        </div>

        <div className="plan-setup-actions">
          <button type="button" className="plan-setup-save" disabled={busy} onClick={() => void finish(true)}>
            Save my look
          </button>
          <button type="button" className="plan-setup-skip" disabled={busy} onClick={() => void finish(false)}>
            Maybe later
          </button>
        </div>
      </div>
    </div>
  )
}
