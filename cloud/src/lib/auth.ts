import { createHmac, timingSafeEqual } from 'node:crypto'
import { cookies } from 'next/headers'

const COOKIE = 'tx_session'
const MAX_AGE_SEC = 60 * 60 * 24 * 60 // two months — this is a personal tool

function secret(): string {
  const value = process.env.SESSION_SECRET
  if (!value) throw new Error('SESSION_SECRET is not set')
  return value
}

function sign(payload: string): string {
  return createHmac('sha256', secret()).update(payload).digest('base64url')
}

/** Constant-time compare that never throws on a length mismatch. */
function matches(a: string, b: string): boolean {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  return left.length === right.length && timingSafeEqual(left, right)
}

export function checkPassword(candidate: string): boolean {
  const expected = process.env.APP_PASSWORD
  if (!expected) throw new Error('APP_PASSWORD is not set')
  return matches(candidate, expected)
}

export function issueToken(): string {
  const expires = Date.now() + MAX_AGE_SEC * 1000
  return `${expires}.${sign(String(expires))}`
}

export function tokenIsValid(token: string | undefined): boolean {
  if (!token) return false
  const [expires, signature] = token.split('.')
  if (!expires || !signature) return false
  if (Number(expires) < Date.now()) return false
  return matches(signature, sign(expires))
}

export async function isSignedIn(): Promise<boolean> {
  const store = await cookies()
  return tokenIsValid(store.get(COOKIE)?.value)
}

export async function startSession(): Promise<void> {
  const store = await cookies()
  store.set(COOKIE, issueToken(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: MAX_AGE_SEC,
  })
}

export async function endSession(): Promise<void> {
  const store = await cookies()
  store.delete(COOKIE)
}

/** The Mac worker authenticates with a bearer secret, not a browser session. */
export function isWorker(request: Request): boolean {
  const expected = process.env.WORKER_SECRET
  if (!expected) return false
  const header = request.headers.get('authorization') ?? ''
  const presented = header.replace(/^Bearer\s+/i, '')
  return presented.length > 0 && matches(presented, expected)
}
