import { guardAccess } from '@/lib/access'
import { NextResponse } from 'next/server'
import { appEmailConfigured, appOrigin, sendModelInviteEmail, sendModelResetEmail } from '@/lib/app-email'
import { sql } from '@/lib/db'
import {
  createOrRefreshInvite,
  findAccountForModel,
  normalizeEmail,
  requestReset,
} from '@/lib/model-accounts'

type Params = { params: Promise<{ id: string }> }

/**
 * The model's app account, from the model sheet's side.
 *
 * GET  — where she stands: no account / invited / active, and when she last
 *        opened the app. What the Access tab paints.
 * POST — `invite` (default) mints the account and emails the setup link;
 *        `reset` emails a new-password link to the account that exists. Both
 *        come back with the URL either way, because email is a convenience
 *        and copy-the-link is the fallback — the same deal editors get.
 */

const unavailable = () =>
  NextResponse.json({ error: 'The account store is unreachable — try again.' }, { status: 502 })

export async function GET(request: Request, { params }: Params) {
  const denied = await guardAccess(request)
  if (denied) return denied
  const { id } = await params
  try {
    return NextResponse.json({
      account: await findAccountForModel(id),
      emailConfigured: appEmailConfigured(),
    })
  } catch {
    return unavailable()
  }
}

export async function POST(request: Request, { params }: Params) {
  const denied = await guardAccess(request)
  if (denied) return denied
  const { id } = await params
  const body = await request.json().catch(() => ({} as Record<string, unknown>))
  const action = body?.action === 'reset' ? 'reset' : 'invite'

  const [model] = await sql.query(`select id, name from transcriber.models where id = $1`, [id])
  if (!model) return NextResponse.json({ error: 'not found' }, { status: 404 })

  const origin = appOrigin(request)

  try {
    const account = await findAccountForModel(id)

    if (action === 'reset') {
      if (!account) {
        return NextResponse.json({ ok: true, outcome: 'no_account', why: 'She has no app account yet — send the invite first.' })
      }
      const reset = await requestReset(account.email)
      if (!reset) {
        return NextResponse.json({ ok: true, outcome: 'no_account', why: 'No active app account for this model.' })
      }
      const url = `${origin}/join?token=${reset.token}`
      const mail = await sendModelResetEmail({ to: reset.account.email, name: reset.account.name, resetUrl: url, origin })
      return NextResponse.json({ ok: true, outcome: 'reset', sent: mail.sent, why: mail.why, url, account: reset.account })
    }

    const email = normalizeEmail(body?.email)
    if (!email || !email.includes('@')) {
      return NextResponse.json({ error: 'Her email address is required.' }, { status: 400 })
    }
    if (account?.status === 'active' && account.email !== email) {
      return NextResponse.json(
        { error: `This model already has an active account under ${account.email} — send a reset instead.` },
        { status: 409 },
      )
    }

    const invite = await createOrRefreshInvite({ modelId: id, email, name: (model.name as string) ?? null })
    if (!invite.invited || !invite.token) {
      return NextResponse.json({ ok: true, outcome: 'already_active', account: invite.account })
    }

    const url = `${origin}/join?token=${invite.token}`
    const mail = await sendModelInviteEmail({
      to: invite.account.email,
      name: invite.account.name,
      setupUrl: url,
      origin,
    })
    return NextResponse.json({ ok: true, outcome: 'invited', sent: mail.sent, why: mail.why, url, account: invite.account })
  } catch {
    return unavailable()
  }
}
