'use client'

import { countdown } from './SweepTab'
import type { SweepRow } from '@/lib/sweep'

export type Flags = {
  row: SweepRow
  ours: boolean
  slipped: boolean
  silent: boolean
  overdue: boolean
  questions: boolean
}

/**
 * Why she is red.
 *
 * A roster card has always been able to say "4 this week · 0 filmed", which is
 * the same sentence whether the brief went out on Sunday and she is filming
 * tomorrow or whether it is still sitting in drafts. These say which.
 *
 * Ours-first, on purpose, and marked as ours: the flag Geno is most likely to
 * read as her failing is usually his.
 */
export default function SweepFlags({ row }: { row: Flags | null }) {
  if (!row) return null

  const due = countdown(row.row.days_left)
  const flags: { label: string; tone: 'ours' | 'warn' | 'bad' }[] = []

  if (row.ours) {
    flags.push({
      label: row.row.plan_id === null ? 'no week open' : 'not sent',
      tone: 'ours',
    })
  }
  if (row.questions) flags.push({ label: `${row.row.unread} to answer`, tone: 'ours' })
  if (row.overdue) flags.push({ label: 'overdue', tone: 'bad' })
  if (row.slipped) flags.push({ label: 'filming slipped', tone: 'warn' })
  if (row.silent) flags.push({ label: 'silent', tone: 'warn' })
  if (row.row.declined > 0) flags.push({ label: `${row.row.declined} turned down`, tone: 'warn' })

  // A due date with nothing wrong is still worth a line — it is the one figure
  // that decides whether today is the day to chase her.
  if (flags.length === 0 && !due) return null

  return (
    <span className="rosterflags">
      {flags.map((flag) => (
        <span key={flag.label} className="rosterflag" data-tone={flag.tone}>
          {flag.label}
        </span>
      ))}
      {due && (
        <span className="rosterflag" data-tone={(row.row.days_left ?? 0) < 0 ? 'bad' : 'quiet'}>
          {due}
        </span>
      )}
    </span>
  )
}
