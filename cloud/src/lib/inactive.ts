/**
 * A model who is not working with us right now (2026-09-30): unresponsive,
 * left, or something else, with an optional note. Greyed out on the roster
 * and one tap to bring back.
 *
 * The switch itself is still `models.status = 'paused'`, which every job
 * already honours: no weekly plan, no Scout sweep, no shout-outs, scorecards,
 * earnings reports, milestones or recaps while she is inactive. Nothing about
 * her is deleted, so reactivating picks up exactly where she left off.
 */
export const INACTIVE_REASONS = [
  { key: 'unresponsive', label: 'Unresponsive' },
  { key: 'left', label: 'Left' },
  { key: 'other', label: 'Other' },
] as const

export type InactiveReason = (typeof INACTIVE_REASONS)[number]['key']

export const MAX_INACTIVE_NOTE = 300

export const reasonLabel = (key: string | null | undefined): string =>
  INACTIVE_REASONS.find((r) => r.key === key)?.label ?? 'Inactive'

export type ActiveChange =
  | { active: true }
  | { active: false; reason: InactiveReason; note: string | null }

/** Validate a body at the boundary. "Other" needs a note saying what. */
export function readActiveChange(body: unknown): ActiveChange | { error: string } {
  if (typeof body !== 'object' || body === null) return { error: 'active is required' }
  const b = body as Record<string, unknown>
  if (b.active === true) return { active: true }
  if (b.active !== false) return { error: 'active must be true or false' }
  const reason = INACTIVE_REASONS.find((r) => r.key === b.reason)?.key
  if (!reason) return { error: 'pick a reason: unresponsive, left or other' }
  const note = typeof b.note === 'string' ? b.note.trim().slice(0, MAX_INACTIVE_NOTE) || null : null
  if (reason === 'other' && !note) return { error: 'say what the other reason is' }
  return { active: false, reason, note }
}
