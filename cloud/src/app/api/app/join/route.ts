import { NextResponse } from 'next/server'
import { readAgreement } from '@/lib/model-agreement'
import {
  activateWithToken,
  appAccountDetails,
  resetWithToken,
  validatePassword,
  validateResetToken,
  validateSetupToken,
  type ModelAccount,
} from '@/lib/model-accounts'
import { issueModelSession } from '@/lib/model-auth'
import { rateLimit } from '@/lib/ratelimit'

/**
 * The one page a link from an email opens — invite or reset, web or app.
 *
 * A setup token and a reset token mean different things underneath (activate
 * an invited account vs. replace an active password), but she experiences one
 * act: "set your password". So there is one URL, one form, and this route
 * resolves which token it was handed, in that order.
 *
 * Two callers, told apart by content type:
 *  - the web form posts `application/x-www-form-urlencoded` and gets a 303 to
 *    /join/done (or back to /join with an error code);
 *  - the app posts JSON and gets a session token back, signed in already.
 */

type Outcome = { ok: true; account: ModelAccount } | { ok: false; error: string; status: number }

async function completeJoin(token: unknown, password: unknown, name?: unknown): Promise<Outcome> {
  try {
    validatePassword(password)
  } catch (error) {
    return { ok: false, error: (error as Error).message, status: 400 }
  }

  const setup = await validateSetupToken(token)
  if (setup) {
    if (setup.alreadyActive) {
      return { ok: false, error: 'This account has already been set up — sign in instead.', status: 409 }
    }
    try {
      return { ok: true, account: await activateWithToken({ token, password, name }) }
    } catch {
      return { ok: false, error: 'This link is invalid or has expired.', status: 404 }
    }
  }

  const reset = await validateResetToken(token)
  if (reset) {
    try {
      return { ok: true, account: await resetWithToken(token, password) }
    } catch {
      return { ok: false, error: 'This link is invalid or has expired.', status: 404 }
    }
  }

  return { ok: false, error: 'This link is invalid or has expired.', status: 404 }
}

/** What the join page paints before she types: whose link is this, and is it
 *  still alive. Never spends the token. */
export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get('token')

  try {
    const setup = await validateSetupToken(token)
    if (setup) {
      return NextResponse.json({
        valid: true,
        state: setup.alreadyActive ? 'settled' : 'invite',
        email: setup.account.email,
        name: setup.account.name,
      })
    }
    const reset = await validateResetToken(token)
    if (reset) {
      return NextResponse.json({ valid: true, state: 'reset', email: reset.email, name: reset.name })
    }
    return NextResponse.json({ valid: false, state: 'invalid', email: null, name: null })
  } catch {
    return NextResponse.json({ error: 'temporarily_unavailable' }, { status: 502 })
  }
}

export async function POST(request: Request) {
  const ip = (request.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'local'
  if (!rateLimit(`app-join:${ip}`, 30)) {
    return NextResponse.json({ error: 'Too many attempts — wait a minute and try again.' }, { status: 429 })
  }

  const form = (request.headers.get('content-type') ?? '').includes('form')
  const body = form
    ? Object.fromEntries((await request.formData().catch(() => new FormData())).entries())
    : await request.json().catch(() => ({} as Record<string, unknown>))

  const token = body?.token
  const password = body?.password
  const name = body?.name

  if (form && String(body?.password2 ?? '') !== String(password ?? '')) {
    return NextResponse.redirect(new URL(`/join?token=${encodeURIComponent(String(token ?? ''))}&error=mismatch`, request.url), 303)
  }

  let outcome: Outcome
  try {
    outcome = await completeJoin(token, password, name)
  } catch {
    outcome = { ok: false, error: 'Something went wrong on our side — try again.', status: 502 }
  }

  if (form) {
    if (!outcome.ok) {
      const code = outcome.status === 409 ? 'exists' : outcome.status === 400 ? 'bad' : outcome.status === 502 ? 'server' : 'invalid'
      return NextResponse.redirect(new URL(`/join?token=${encodeURIComponent(String(token ?? ''))}&error=${code}`, request.url), 303)
    }
    return NextResponse.redirect(new URL('/join/done', request.url), 303)
  }

  if (!outcome.ok) return NextResponse.json({ error: outcome.error }, { status: outcome.status })
  if (!outcome.account.modelId) {
    return NextResponse.json({ error: 'This account is not linked to a model yet — ask the team.' }, { status: 403 })
  }

  // Her agreement fields ride the join (2026-10-19); /me refills them next.
  const agreement = await readAgreement(outcome.account.modelId).catch(() => null)

  const { token: sessionToken } = issueModelSession(outcome.account)
  return NextResponse.json({
    ok: true,
    token: sessionToken,
    account: appAccountDetails(outcome.account, agreement),
  })
}
