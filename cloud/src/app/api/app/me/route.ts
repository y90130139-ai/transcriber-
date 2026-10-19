import { NextResponse } from 'next/server'
import { sql } from '@/lib/db'
import { readAgreement } from '@/lib/model-agreement'
import { findAccountByEmail, appAccountDetails } from '@/lib/model-accounts'
import { issueModelSession, modelSessionFrom } from '@/lib/model-auth'

/**
 * Who the app is looking at. Read on launch and resume: the session slides
 * forward while the account remains active, and onboarding data is restored
 * from the server when a device has no local copy.
 */
export async function GET(request: Request) {
  const session = await modelSessionFrom(request)
  if (!session) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401, headers: { 'Cache-Control': 'private, no-store' } })
  }

  let account = null
  try {
    account = await findAccountByEmail(session.email)
  } catch {
    return NextResponse.json({ error: 'temporarily_unavailable' }, { status: 502, headers: { 'Cache-Control': 'private, no-store' } })
  }
  if (!account || account.status !== 'active' || account.id !== session.accountId || account.modelId !== session.modelId) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401, headers: { 'Cache-Control': 'private, no-store' } })
  }

  try {
    const [eventRows, submissionRows, agreement] = await Promise.all([
      sql.query(
        `select kind,
                to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as at
           from transcriber.app_events
          where model_id = $1 and kind in ('tour', 'onboarding')
          order by created_at desc`,
        [session.modelId],
      ),
      sql.query(
        `select kind, data,
                to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as created_at
           from transcriber.app_submissions
          where model_id = $1
          order by created_at desc limit 12`,
        [session.modelId],
      ),
      // The agreement's fill-ins from the invite (2026-10-19). A failed read
      // leaves them empty rather than blocking the session.
      readAgreement(session.modelId).catch(() => null),
    ])

    const milestones = { tourAt: null as string | null, onboardingAt: null as string | null }
    for (const row of eventRows) {
      if (row.kind === 'tour' && !milestones.tourAt) milestones.tourAt = String(row.at)
      if (row.kind === 'onboarding' && !milestones.onboardingAt) milestones.onboardingAt = String(row.at)
    }

    const latest = new Map<string, { kind: string; data: Record<string, unknown>; createdAt: string }>()
    for (const row of submissionRows) {
      const kind = String(row.kind)
      if (!['agreement', 'contact', 'intake'].includes(kind) || latest.has(kind)) continue
      latest.set(kind, {
        kind,
        data: row.data && typeof row.data === 'object' && !Array.isArray(row.data)
          ? row.data as Record<string, unknown>
          : {},
        createdAt: String(row.created_at),
      })
    }

    const refreshed = issueModelSession(account)
    return NextResponse.json(
      {
        ok: true,
        token: refreshed.token,
        account: appAccountDetails(account, agreement),
        bootstrap: { milestones, submissions: [...latest.values()] },
      },
      { headers: { 'Cache-Control': 'private, no-store' } },
    )
  } catch (error) {
    console.error('[api/app/me] bootstrap_read_failed', error instanceof Error ? error.name : 'UnknownError')
    return NextResponse.json(
      { error: 'temporarily_unavailable' },
      { status: 502, headers: { 'Cache-Control': 'private, no-store' } },
    )
  }
}
