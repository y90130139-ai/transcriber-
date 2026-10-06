/**
 * "Make it yours": the looks a model can give her own pages
 * (Geno, 2026-10-06 — "kind of like MySpace was"; same day: fonts dropped
 * ("make no sense"), gold dropped (two oranges), and the picker moved into
 * a first-open setup sheet with her photo and light/dark).
 *
 * Presets, never free paint. Every palette swaps only the accent family —
 * the ink/bone ground that carries all the reading contrast is untouched —
 * and each has a light and a dark voice, both chosen so white type holds on
 * the accent the way it does on the house ember.
 *
 * `mode` is her light/dark choice, saved so a new phone opens her way; a
 * device where she already used the sun/moon keeps that device's choice
 * (localStorage wins — see styleScript). `done` means the setup sheet has
 * been answered or waved away and never comes back.
 *
 * Pure and import-free: the sheet, the panel, the save route and the inline
 * boot script all read the same list.
 */

export const PALETTES = [
  { key: 'ember', name: 'Ember', light: '#C2410C', dark: '#E8663A' },
  { key: 'crimson', name: 'Crimson', light: '#B91C1C', dark: '#EF4444' },
  { key: 'rose', name: 'Rose', light: '#C2185B', dark: '#EC5A8B' },
  { key: 'fuchsia', name: 'Fuchsia', light: '#A21CAF', dark: '#D946EF' },
  { key: 'violet', name: 'Violet', light: '#7C3AED', dark: '#9A6BFF' },
  { key: 'indigo', name: 'Indigo', light: '#4338CA', dark: '#7584FF' },
  { key: 'ocean', name: 'Ocean', light: '#0E7490', dark: '#2BA3DB' },
  { key: 'teal', name: 'Teal', light: '#0F766E', dark: '#16A394' },
  { key: 'forest', name: 'Forest', light: '#15803D', dark: '#2EB564' },
] as const

export type PortalStyle = { pal?: string; mode?: 'light' | 'dark'; done?: boolean }

const PAL_KEYS = new Set<string>(PALETTES.map((palette) => palette.key))

/** Only known keys survive; the house defaults are carried as absence. */
export function cleanStyle(raw: unknown): PortalStyle {
  const style: PortalStyle = {}
  if (raw && typeof raw === 'object') {
    const { pal, mode, done } = raw as Record<string, unknown>
    if (typeof pal === 'string' && PAL_KEYS.has(pal) && pal !== 'ember') style.pal = pal
    if (mode === 'light' || mode === 'dark') style.mode = mode
    if (done === true) style.done = true
  }
  return style
}

/** Writes her look onto <html> before first paint, THEME_SCRIPT-style, so
 *  the page never flashes the house ember at her. Her saved mode applies
 *  only where this device holds no choice of its own — the sun/moon she
 *  tapped on THIS phone always wins over what another phone saved. */
export function styleScript(style: PortalStyle | null | undefined): string {
  const clean = cleanStyle(style)
  const parts: string[] = []
  if (clean.pal) parts.push(`document.documentElement.dataset.pal=${JSON.stringify(clean.pal)}`)
  if (clean.mode) {
    parts.push(
      `try{if(!localStorage.getItem('sinaura-theme'))document.documentElement.dataset.theme=${JSON.stringify(clean.mode)}}catch(e){}`,
    )
  }
  if (parts.length === 0) return ''
  return `(function(){${parts.join(';')};})()`
}
