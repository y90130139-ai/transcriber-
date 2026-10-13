import { NextResponse } from 'next/server'
import { currentSession } from '@/lib/auth'
import { rateLimit } from '@/lib/ratelimit'
import { SESSION_COOKIE, SESSION_TTL_SEC, issueSession, verifyTeamLogin } from '@/lib/team-auth'

/** Sign-in with the team's own accounts (Geno, 2026-10-12): the email and
 *  password from the ai-invoice dashboard. CEO and admin are in; a member
 *  needs the transcriber permission on their account. */
export async function POST(request: Request) {
  const ip = (request.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'local'
  if (!rateLimit(`login:${ip}`, 20)) {
    return NextResponse.json({ error: 'Too many attempts — wait a minute and try again.' }, { status: 429 })
  }

  const body = await request.json().catch(() => ({} as Record<string, unknown>))
  const result = await verifyTeamLogin(body?.email, body?.password)
  if ('error' in result) return NextResponse.json({ error: result.error }, { status: result.status })

  const { token, session } = issueSession(result.member)
  const response = NextResponse.json({
    ok: true,
    user: { name: session.name, role: session.role, email: session.email },
  })
  response.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_TTL_SEC,
  })
  return response
}

/** Who is signed in — the sidebar reads this. */
export async function GET() {
  const session = await currentSession()
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  return NextResponse.json({
    user: { name: session.name, role: session.role, email: session.email },
  })
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true })
  response.cookies.set(SESSION_COOKIE, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  })
  return response
}
