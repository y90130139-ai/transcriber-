'use client'

import { useState } from 'react'
import { PALETTES, cleanStyle, type PortalStyle } from '@/lib/portal-style'
import { shrink } from './SetupProfile'

/**
 * Her look, changeable any day (Geno, 2026-10-06). The first-open setup
 * sheet (SetupProfile) is where most picks happen now; this panel at the
 * foot is the way back in. Colors and background only — fonts were cut
 * the same day they shipped ("those make no sense").
 */
export default function MakeItYours({ token, style, photo }: { token: string; style: PortalStyle | null | undefined; photo?: string | null }) {
  const [current, setCurrent] = useState<PortalStyle>(() => cleanStyle(style))
  const [saved, setSaved] = useState(false)
  /** Her photo as this visit last saw it — saved to the same `photo_url`
   *  the console reads, so the admin side shows the new face too. */
  const [face, setFace] = useState<string | null>(photo ?? null)
  const [faceSaid, setFaceSaid] = useState<string | null>(null)

  async function pickFace(file: File | undefined) {
    if (!file) return
    const dataUrl = await shrink(file)
    if (!dataUrl) { setFaceSaid('That photo would not read — try another.'); return }
    const response = await fetch(`/api/plan/${token}/photo`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data_url: dataUrl }),
    }).catch(() => null)
    if (!response?.ok) { setFaceSaid('That did not save — try again.'); return }
    setFace(dataUrl)
    setFaceSaid('Saved — this is you everywhere now.')
    // The header above is server-rendered; swap it in place so she sees
    // herself change without a reload.
    document.querySelector('.plan-face')?.setAttribute('src', dataUrl)
    setTimeout(() => setFaceSaid(null), 4000)
  }

  function persist(next: PortalStyle) {
    setCurrent(next)
    void fetch(`/api/plan/${token}/style`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...next, done: true }),
    }).then((response) => {
      if (!response.ok) return
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    }).catch(() => null)
  }

  function applyPal(key: string) {
    const root = document.documentElement
    if (key === 'ember') delete root.dataset.pal
    else root.dataset.pal = key
    persist(cleanStyle({ ...current, pal: key }))
  }

  function applyMode(mode: 'light' | 'dark') {
    document.documentElement.dataset.theme = mode
    try { localStorage.setItem('sinaura-theme', mode) } catch { /* private mode */ }
    persist(cleanStyle({ ...current, mode }))
  }

  const dark = typeof document !== 'undefined' && document.documentElement.dataset.theme === 'dark'

  return (
    <details className="plan-yours-look">
      <summary>&#127912; Make it yours</summary>
      <p className="plan-look-note">Your photo, color and background — this page remembers.</p>
      <label className="plan-look-photo">
        {face
          /* eslint-disable-next-line @next/next/no-img-element */
          ? <img src={face} alt="" width={44} height={44} />
          : <span className="plan-look-photo-empty" aria-hidden>🙂</span>}
        <b>{face ? 'Change photo' : 'Add a photo'}</b>
        <input
          type="file"
          accept="image/*"
          onChange={(event) => void pickFace(event.target.files?.[0])}
        />
      </label>
      {faceSaid && <p className="plan-look-note" role="status">{faceSaid}</p>}
      <div className="plan-look-row" role="radiogroup" aria-label="Color">
        {PALETTES.map((palette) => (
          <button
            key={palette.key}
            type="button"
            className="plan-swatch"
            role="radio"
            aria-checked={(current.pal ?? 'ember') === palette.key}
            data-on={(current.pal ?? 'ember') === palette.key || undefined}
            style={{ background: dark ? palette.dark : palette.light }}
            title={palette.name}
            aria-label={palette.name}
            onClick={() => applyPal(palette.key)}
          />
        ))}
      </div>
      <div className="plan-look-row" role="radiogroup" aria-label="Background">
        <button type="button" className="plan-fontchip" role="radio"
                aria-checked={(current.mode ?? (dark ? 'dark' : 'light')) === 'light'}
                data-on={(current.mode ?? (dark ? 'dark' : 'light')) === 'light' || undefined}
                onClick={() => applyMode('light')}>
          &#9728;&#65039; Light
        </button>
        <button type="button" className="plan-fontchip" role="radio"
                aria-checked={(current.mode ?? (dark ? 'dark' : 'light')) === 'dark'}
                data-on={(current.mode ?? (dark ? 'dark' : 'light')) === 'dark' || undefined}
                onClick={() => applyMode('dark')}>
          &#127769; Dark
        </button>
      </div>
      {saved && <p className="plan-look-saved" role="status">Saved &#10003;</p>}
    </details>
  )
}
