import { NextResponse } from 'next/server'
import { appEmailConfigured, appOrigin, sendModelResetEmail } from '@/lib/app-email'
import { requestReset } from '@/lib/model-accounts'
import { rateLimit } from '@/lib/ratelimit'

/**
 * "Forgot password" from the app's sign-in. One answer for every email —
 * known or not — so the endpoint cannot be used to ask who has an account.
 * The only honest failures are configuration ones: email not set up, send
 * bounced, server unreachable.
 */
export async function POST(request: Request) {
  const ip = (request.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'local'
  if (!rateLimit(`app-forgot:${ip}`, 10)) {
    return NextResponse.json({ error: 'Too many attempts — wait a minute and try again.' }, { status: 429 })
  }
  if (!appEmailConfigured()) {
    return NextResponse.json({ error: 'Email is not set up on this server — ask the team for a new link.' }, { status: 503 })
  }

  const body = await request.json().catch(() => ({} as Record<string, unknown>))
  let reset = null
  try {
    reset = await requestReset(body?.email)
  } catch {
    return NextResponse.json({ error: 'Something went wrong on our side — try again.' }, { status: 502 })
  }
  if (!reset) return NextResponse.json({ ok: true })

  const origin = appOrigin(request)
  const resetUrl = `${origin}/join?token=${reset.token}`
  const mail = await sendModelResetEmail({
    to: reset.account.email,
    name: reset.account.name,
    resetUrl,
    origin,
  })
  if (!mail.sent) {
    return NextResponse.json({ error: mail.why ?? 'Could not send right now — try again.' }, { status: 502 })
  }
  return NextResponse.json({ ok: true })
}
