/** The Gosian app's session (Geno, 2026-10-12).
 *
 * Her phone signs in once and carries the result as `Authorization: Bearer`;
 * the web join flow has no session at all. The token is a small HS256 JWT,
 * signed with this app's own `MODEL_SESSION_SECRET` (falling back to
 * SESSION_SECRET when unset), and the payload says `kind: 'model'` so it can
 * never pass the console's `readSession` — and a console session can never
 * pass here. Two doors, two tokens, one deliberate act each.
 *
 * Server only.
 */
import { createHmac, timingSafeEqual } from 'node:crypto'
import { cookies } from 'next/headers'
import type { ModelAccount } from './model-accounts'

export const MODEL_SESSION_COOKIE = 'tx_model_session'
export const MODEL_SESSION_TTL_SEC = 60 * 60 * 24 * 30

export type ModelSession = {
  /** The model_accounts row. */
  accountId: string
  /** The transcriber.models id — never null on an issued session. */
  modelId: string
  email: string
  name: string | null
  /** Unix seconds. */
  exp: number
}

function secret(): string {
  const value = process.env.MODEL_SESSION_SECRET || process.env.SESSION_SECRET
  if (!value) throw new Error('MODEL_SESSION_SECRET is not set')
  return value
}

const sign = (payload: string) => createHmac('sha256', secret()).update(payload).digest('base64url')

/** Constant-time compare that never throws on a length mismatch. */
function same(a: string, b: string): boolean {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  return left.length === right.length && timingSafeEqual(left, right)
}

/** Mint the token for a model who just signed in or set her password. */
export function issueModelSession(account: ModelAccount): { token: string; session: ModelSession } {
  if (!account.modelId) throw new Error('This account has no model attached')
  const now = Math.floor(Date.now() / 1000)
  const session: ModelSession = {
    accountId: account.id,
    modelId: account.modelId,
    email: account.email,
    name: account.name,
    exp: now + MODEL_SESSION_TTL_SEC,
  }
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
  const body = Buffer.from(JSON.stringify({
    kind: 'model',
    sub: session.accountId,
    mid: session.modelId,
    email: session.email,
    name: session.name,
    iat: now,
    exp: session.exp,
  })).toString('base64url')
  const token = `${header}.${body}.${sign(`${header}.${body}`)}`
  return { token, session }
}

/** Read a token back. Null for anything unsigned, tampered with or expired. */
export function readModelSession(token: string | undefined | null): ModelSession | null {
  if (!token) return null
  const parts = token.split('.')
  if (parts.length !== 3) return null
  const [header, body, signature] = parts
  let expected = ''
  try {
    expected = sign(`${header}.${body}`)
  } catch {
    return null
  }
  if (!same(signature, expected)) return null
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as Record<string, unknown>
    if (payload.kind !== 'model') return null
    const exp = Number(payload.exp)
    if (!exp || exp < Math.floor(Date.now() / 1000)) return null
    const mid = String(payload.mid ?? '')
    if (!mid) return null
    return {
      accountId: String(payload.sub ?? ''),
      modelId: mid,
      email: String(payload.email ?? ''),
      name: payload.name ? String(payload.name) : null,
      exp,
    }
  } catch {
    return null
  }
}

/** The session on this request: bearer first (the app), cookie as fallback. */
export async function modelSessionFrom(request: Request): Promise<ModelSession | null> {
  const header = request.headers.get('authorization') ?? ''
  const presented = header.replace(/^Bearer\s+/i, '')
  if (presented) return readModelSession(presented)
  const store = await cookies()
  return readModelSession(store.get(MODEL_SESSION_COOKIE)?.value)
}
