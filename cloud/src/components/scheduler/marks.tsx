import PlatformIcon, { hasPlatformIcon } from '../roster/PlatformIcon'
import { isPlatform, labelOfPlatform, readSocial, type Platform } from '@/lib/socials'

/**
 * The account's mark (Geno, 2026-10-14): the platform's own glyph where the
 * console knows one, two initials where it does not — so an unmapped
 * provider still reads as a person, not a hole.
 */

/** Autoposter still says `twitter`; the console's mark is `x`. */
export function normalizePlatform(value: string): string {
  const lower = value.trim().toLowerCase()
  if (lower === 'twitter') return 'x'
  if (lower === 'facebook_page') return 'facebook'
  return lower
}

export function platformOf(value: string): Platform | null {
  const normalized = normalizePlatform(value)
  return isPlatform(normalized) ? normalized : null
}

export function platformLabel(value: string): string {
  const known = platformOf(value)
  if (known) return labelOfPlatform(known)
  const raw = value.trim()
  if (!raw) return 'Other'
  return raw[0].toUpperCase() + raw.slice(1)
}

/** Live profile URL from handle + platform, or null when we cannot build one. */
export function profileUrlOf(platform: string, handle: string): string | null {
  const known = platformOf(platform)
  if (!known || !handle.trim()) return null
  return readSocial(known, handle)?.url ?? null
}

export function Mark({ platform, name, size = 13 }: { platform: string; name: string; size?: number }) {
  const known = platformOf(platform)
  const token = known ?? (normalizePlatform(platform) || 'other')
  if (known && hasPlatformIcon(known)) {
    return (
      <span className="sc-mark" data-platform={token} aria-hidden>
        <PlatformIcon platform={known} size={size} />
      </span>
    )
  }
  return (
    <span className="sc-mark sc-mark-text" data-platform={token} aria-hidden>
      {name.slice(0, 2).toUpperCase() || '?'}
    </span>
  )
}

/** "awaiting_approval" → "Needs approval"; everything else title-cased. */
export function statusLabel(status: string): string {
  const lower = status.toLowerCase().replace(/[\s-]+/g, '_')
  if (lower === 'awaiting_approval' || lower === 'needs_approval') return 'Needs approval'
  return lower
    .split('_')
    .map((word) => (word ? word[0].toUpperCase() + word.slice(1) : word))
    .join(' ')
}

/** The API gives workspaces no names — the short id is the label. */
export function workspaceLabel(id: string): string {
  return `Workspace ${id.slice(0, 8)}`
}
