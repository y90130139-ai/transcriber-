/** Who is looking at the console (Geno, 2026-10-12).
 *
 * The console used to be one shared password. It now signs in with the same
 * team accounts the ai-invoice dashboard uses — see lib/team-auth.ts for the
 * table, the roles and the permission that opens this app. `tx_session`
 * carries the signed session; everything below that needs "signed in" asks
 * here, and what it means is "a signed-in teammate the transcriber is open
 * to".
 */
import { timingSafeEqual } from 'node:crypto'
import { cookies } from 'next/headers'
import { SESSION_COOKIE, readSession, type TeamSession, type TeamRole } from './team-auth'

export type { TeamSession, TeamRole }

/** The signed-in teammate, or null. */
export async function currentSession(): Promise<TeamSession | null> {
  const store = await cookies()
  return readSession(store.get(SESSION_COOKIE)?.value)
}

export async function isSignedIn(): Promise<boolean> {
  return Boolean(await currentSession())
}

/** Constant-time compare that never throws on a length mismatch. */
function matches(a: string, b: string): boolean {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  return left.length === right.length && timingSafeEqual(left, right)
}

/** The Mac worker authenticates with a bearer secret, not a browser session. */
export function isWorker(request: Request): boolean {
  const expected = process.env.WORKER_SECRET
  if (!expected) return false
  const header = request.headers.get('authorization') ?? ''
  const presented = header.replace(/^Bearer\s+/i, '')
  return presented.length > 0 && matches(presented, expected)
}

/** The Gosian Telegram bot: its own bearer secret, so revoking one side never
 *  locks out the other. Unset means the bot routes answer to no one. */
export function isBot(request: Request): boolean {
  const expected = process.env.GOSIAN_BOT_SECRET
  if (!expected) return false
  const header = request.headers.get('authorization') ?? ''
  const presented = header.replace(/^Bearer\s+/i, '')
  return presented.length > 0 && matches(presented, expected)
}
