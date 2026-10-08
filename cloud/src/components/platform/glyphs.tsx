/**
 * The platform cards' small mark set (2026-10-07), shared by the feed pages
 * and the week's top rack — same stroke language as ConsoleIcons: 1.9 at 24,
 * currentColor, drawn inline because the console ships no icon library.
 */
import type { ReactNode } from 'react'

type GlyphProps = { size?: number; children: ReactNode }

export function Glyph({ size = 13, children }: GlyphProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor"
      strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {children}
    </svg>
  )
}

export const PlayGlyph = () => <Glyph><path d="M7 5.5v13l11-6.5Z" /></Glyph>
export const PauseGlyph = () => <Glyph><path d="M9 5.5v13" /><path d="M15 5.5v13" /></Glyph>
export const HeartGlyph = () => <Glyph><path d="M12 20.5S3.5 15.5 3.5 9.6a4.6 4.6 0 0 1 8.5-2.6 4.6 4.6 0 0 1 8.5 2.6c0 5.9-8.5 10.9-8.5 10.9Z" /></Glyph>
export const CommentGlyph = () => <Glyph><path d="M21 12a8.5 8.5 0 0 1-8.5 8.5c-1.4 0-2.8-.3-3.9-.9L3 21l1.4-5.1a8.5 8.5 0 1 1 16.6-3.9Z" /></Glyph>
export const DownloadGlyph = () => <Glyph><path d="M12 3.5v11" /><path d="m7.5 10.5 4.5 4.5 4.5-4.5" /><path d="M4.5 20.5h15" /></Glyph>
export const OpenGlyph = () => <Glyph><path d="M13.5 5.5H19v5.5" /><path d="M19 5.5 11 13.5" /><path d="M19 14v5a1.5 1.5 0 0 1-1.5 1.5h-12A1.5 1.5 0 0 1 4 19V7a1.5 1.5 0 0 1 1.5-1.5H11" /></Glyph>
export const SoundGlyph = () => <Glyph><path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5Z" /><path d="M15.5 9.2a4 4 0 0 1 0 5.6" /><path d="M18 6.8a7.5 7.5 0 0 1 0 10.4" /></Glyph>
export const MuteGlyph = () => <Glyph><path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5Z" /><path d="m16 9.5 5 5" /><path d="m21 9.5-5 5" /></Glyph>
export const CheckGlyph = () => <Glyph><path d="m5 12.5 4.5 4.5L19 7.5" /></Glyph>
export const CaptionGlyph = () => <Glyph><path d="M4 6.5h16" /><path d="M4 12h10.5" /><path d="M4 17.5h13" /></Glyph>
