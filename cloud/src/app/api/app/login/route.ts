import { NextResponse } from 'next/server'
import { issueModelSession } from '@/lib/model-auth'
import { touchLogin, verifyLogin } from '@/lib/model-accounts'
import { rateLimit } from '@/lib/ratelimit'

/**
 * The app's sign-in: her email and the password she set from the invite.
 *
 * Every failure answers exactly the same way — wrong password, unknown email,
 * disabled account — because the difference is not hers to learn. The one
 * exception is an account with no model attached, which is a console-side
 * mistake worth saying out loud.
 */
export async function POST(request: Request) {
  const ip = (request.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'local'
  if (!rateLimit(`app-login:${ip}`, 20)) {
    return NextResponse.json({ error: 'Too many attempts — wait a minute and try again.' }, { status: 429 })
  }

  const body = await request.json().catch(() => ({} as Record<string, unknown>))
  let account = null
  try {
    account = await verifyLogin(body?.email, body?.password)
  } catch {
    return NextResponse.json({ error: 'Sign-in is temporarily unavailable — try again.' }, { status: 502 })
  }
  if (!account) {
    return NextResponse.json({ error: 'Invalid email or password.' }, { status: 401 })
  }
  if (!account.modelId) {
    return NextResponse.json({ error: 'This account is not linked to a model yet — ask the team.' }, { status: 403 })
  }

  const { token } = issueModelSession(account)
  await touchLogin(account.id)
  return NextResponse.json({
    ok: true,
    token,
    account: { id: account.id, email: account.email, name: account.name, modelId: account.modelId },
  })
}
