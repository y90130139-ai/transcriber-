/**
 * The server-side doors (Geno, 2026-10-18).
 *
 * Two entry points, one source of truth (lib/permissions.ts, same functions
 * the rail reads):
 *
 *   guardAccess(request)  — every console API route calls this where it used
 *                           to call `isSignedIn()`. Reads need View on the
 *                           page that owns the path; anything else needs
 *                           Edit. 401 when not signed in, 403 when refused.
 *
 *   requirePage(key)      — server components (the console pages that render
 *                           data themselves) call this first. Redirects to
 *                           the first page the member can open.
 *
 * Routes with their own auth — the Mac worker, the Telegram bot, cron, her
 * plan pages by token, the model app — never call these and are unchanged.
 */
import { NextResponse } from 'next/server'
import { redirect } from 'next/navigation'
import { currentSession } from './auth'
import { canView, decideApi, firstAllowedPath, type AccessLevel } from './permissions'

const unauthorized = () => NextResponse.json({ error: 'unauthorized' }, { status: 401 })

/** Null when the call may proceed; the response to return when it may not. */
export async function guardAccess(request: Request): Promise<NextResponse | null> {
  const session = await currentSession()
  if (!session) return unauthorized()
  const url = new URL(request.url)
  const decision = decideApi(url.pathname, request.method, session.permissions)
  if (decision.ok) return null
  return NextResponse.json(
    {
      error: 'no access to that page',
      page: decision.page,
      need: decision.need,
    },
    { status: 403 },
  )
}

/**
 * Gate one console page. Returns the member's level ('read' for view-only)
 * or redirects to the first page they can open. Only for server components —
 * the client pages are gated by the shell, which reads the same decisions.
 */
export async function requirePage(key: string): Promise<AccessLevel> {
  const session = await currentSession()
  if (!session) redirect('/')
  if (!canView(session.permissions, key)) redirect(firstAllowedPath(session.permissions) ?? '/')
  return session.permissions[key] ?? 'none'
}
