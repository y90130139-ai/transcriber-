'use client'

import { useState } from 'react'
import { FONTS, PALETTES, cleanStyle, type PortalStyle } from '@/lib/portal-style'

/**
 * Her look, her call (Geno, 2026-10-06 — "kind of like MySpace was...
 * give them more creativity"). Palettes and fonts are presets from
 * lib/portal-style.ts: every combination stays readable, applies the moment
 * she taps it, and is saved to her profile so every visit — and her
 * home-screen app — opens in it.
 */
export default function MakeItYours({ token, style }: { token: string; style: PortalStyle | null | undefined }) {
  const [current, setCurrent] = useState<PortalStyle>(() => cleanStyle(style))
  const [saved, setSaved] = useState(false)

  function apply(next: PortalStyle) {
    setCurrent(next)
    const root = document.documentElement
    if (next.pal) root.dataset.pal = next.pal
    else delete root.dataset.pal
    if (next.font) root.dataset.font = next.font
    else delete root.dataset.font
    void fetch(`/api/plan/${token}/style`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(next),
    }).then((response) => {
      if (!response.ok) return
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    }).catch(() => null)
  }

  return (
    <details className="plan-yours-look">
      <summary>&#127912; Make it yours</summary>
      <p className="plan-look-note">Pick a color and a type voice — this page remembers.</p>
      <div className="plan-look-row" role="radiogroup" aria-label="Color">
        {PALETTES.map((palette) => (
          <button
            key={palette.key}
            type="button"
            className="plan-swatch"
            role="radio"
            aria-checked={(current.pal ?? 'ember') === palette.key}
            data-on={(current.pal ?? 'ember') === palette.key || undefined}
            style={{ background: palette.light }}
            title={palette.name}
            aria-label={palette.name}
            onClick={() => apply(cleanStyle({ ...current, pal: palette.key }))}
          />
        ))}
      </div>
      <div className="plan-look-row" role="radiogroup" aria-label="Font">
        {FONTS.map((font) => (
          <button
            key={font.key}
            type="button"
            className="plan-fontchip"
            role="radio"
            aria-checked={(current.font ?? 'classic') === font.key}
            data-on={(current.font ?? 'classic') === font.key || undefined}
            style={font.stack ? { fontFamily: font.stack } : undefined}
            onClick={() => apply(cleanStyle({ ...current, font: font.key }))}
          >
            {font.name}
          </button>
        ))}
      </div>
      {saved && <p className="plan-look-saved" role="status">Saved &#10003;</p>}
    </details>
  )
}
