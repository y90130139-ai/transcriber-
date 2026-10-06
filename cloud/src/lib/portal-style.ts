/**
 * "Make it yours": the looks a model can give her own pages
 * (Geno, 2026-10-06 — "kind of like MySpace was... fonts, colors").
 *
 * Presets, never free paint. Every palette swaps only the accent family —
 * the ink/bone ground that carries all the reading contrast is untouched —
 * and each has a light and a dark voice, both chosen so white type holds on
 * the accent exactly as it does on the house ember. Fonts are system stacks:
 * nothing to download, nothing to break, instant on every phone.
 *
 * Pure and import-free: the panel, the save route and the inline boot
 * script all read the same two lists.
 */

export const PALETTES = [
  { key: 'ember', name: 'Ember', light: '#C2410C', dark: '#E8663A' },
  { key: 'rose', name: 'Rose', light: '#C2185B', dark: '#F06292' },
  { key: 'violet', name: 'Violet', light: '#7C3AED', dark: '#A78BFA' },
  { key: 'ocean', name: 'Ocean', light: '#0E7490', dark: '#38BDF8' },
  { key: 'forest', name: 'Forest', light: '#15803D', dark: '#4ADE80' },
  { key: 'gold', name: 'Gold', light: '#B45309', dark: '#E0A32E' },
] as const

export const FONTS = [
  { key: 'classic', name: 'Classic', stack: null },
  { key: 'rounded', name: 'Rounded', stack: 'ui-rounded, "SF Pro Rounded", "Hiragino Maru Gothic ProN", Quicksand, Comfortaa, system-ui, sans-serif' },
  { key: 'serif', name: 'Serif', stack: 'ui-serif, Georgia, "Times New Roman", serif' },
  { key: 'mono', name: 'Typewriter', stack: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace' },
] as const

export type PortalStyle = { pal?: string; font?: string }

const PAL_KEYS = new Set<string>(PALETTES.map((palette) => palette.key))
const FONT_KEYS = new Set<string>(FONTS.map((font) => font.key))

/** Only known keys survive; the defaults are carried as absence. */
export function cleanStyle(raw: unknown): PortalStyle {
  const style: PortalStyle = {}
  if (raw && typeof raw === 'object') {
    const { pal, font } = raw as Record<string, unknown>
    if (typeof pal === 'string' && PAL_KEYS.has(pal) && pal !== 'ember') style.pal = pal
    if (typeof font === 'string' && FONT_KEYS.has(font) && font !== 'classic') style.font = font
  }
  return style
}

/** Writes her look onto <html> before first paint, THEME_SCRIPT-style, so
 *  the page never flashes the house ember at her. */
export function styleScript(style: PortalStyle | null | undefined): string {
  const clean = cleanStyle(style)
  const sets: string[] = []
  if (clean.pal) sets.push(`d.pal=${JSON.stringify(clean.pal)}`)
  if (clean.font) sets.push(`d.font=${JSON.stringify(clean.font)}`)
  if (sets.length === 0) return ''
  return `(function(){var d=document.documentElement.dataset;${sets.join(';')};})()`
}
