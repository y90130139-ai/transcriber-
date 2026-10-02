'use client'

/** One tappable answer. A real button with aria-pressed, so a screen reader
 *  hears "selected", and a 48px target for a thumb. */
export default function Choice({
  on,
  onTap,
  children,
  sub,
  wide = false,
}: {
  on: boolean
  onTap: () => void
  children: React.ReactNode
  sub?: string
  wide?: boolean
}) {
  return (
    <button type="button" className="sv-choice" data-on={on} data-wide={wide} aria-pressed={on} onClick={onTap}>
      <span className="sv-choice-label">{children}</span>
      {sub && <span className="sv-choice-sub">{sub}</span>}
    </button>
  )
}

/** The "why this matters" line under a question — the point of the form. */
export function Why({ text, tone = 'note' }: { text: string; tone?: 'note' | 'good' | 'warn' }) {
  return <p className="sv-why" data-tone={tone} aria-live="polite">{text}</p>
}
