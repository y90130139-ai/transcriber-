/**
 * Team sign-in — the same credentials as the ai-invoice dashboard (Geno,
 * 2026-10-12).
 *
 * Members live in Supabase's `team_members`: email, bcrypt password hash,
 * role, and per-app page permissions. CEO and admin always get in here; a
 * member only when their `transcriber` permission is on (toggled in the
 * dashboard's Team settings — the key is `transcriber`).
 *
 * The session is a small HS256 JWT in the `tx_session` cookie, signed with
 * this app's own SESSION_SECRET. Deliberately its own cookie name: the
 * dashboard's `fanslink_session` may be scoped to the shared parent domain,
 * and two apps writing one cookie name with different secrets would fight.
 * Signing in here is its own deliberate act — with the same credentials.
 *
 * Server only: the service key and bcrypt never reach the browser.
 */
import { createHmac, timingSafeEqual } from 'node:crypto'
import bcrypt from 'bcryptjs'

export type TeamRole = 'ceo' | 'admin' | 'member'
/** The permission key the dashboard's Team settings write for this app. */
export const TRANSCRIBER_PAGE_KEY = 'transcriber'
export const SESSION_COOKIE = 'tx_session'
export const SESSION_TTL_SEC = 60 * 60 * 24 * 14

export type TeamSession = {
  id: string
  email: string
  name: string | null
  role: TeamRole
  /** This app's permission level from the member's page_permissions. */
  transcriber: 'read' | 'edit' | null
  /** Unix seconds. */
  exp: number
}

type TeamMember = {
  id: string
  email: string
  name: string | null
  role: TeamRole
  status: string
  password_hash: string | null
  page_permissions: Record<string, string> | null
}

const unquote = (value: string | undefined) => (value ?? '').trim().replace(/^["']|["']$/g, '')

/** Who the inbox may start or grow a chat with (Geno, 2026-10-13): CEO and
 *  admin always, and members only when their transcriber permission is on -
 *  the same door as the console itself. Names and roles only; hashes and
 *  raw permissions never leave this file. */
export async function listTeamMembers(): Promise<
  { id: string; name: string | null; email: string; role: TeamRole }[]
> {
  const config = supabase()
  if (!config) return []
  const query = new URL(`${config.url.replace(/\/$/, '')}/rest/v1/team_members`)
  query.searchParams.set('status', 'eq.active')
  query.searchParams.set('select', 'id,name,email,role,page_permissions')
  query.searchParams.set('order', 'name')
  try {
    const response = await fetch(query, {
      headers: { apikey: config.key, Authorization: `Bearer ${config.key}`, Accept: 'application/json' },
      cache: 'no-store',
    })
    if (!response.ok) return []
    const rows = (await response.json()) as {
      id: string
      name: string | null
      email: string
      role: string
      page_permissions: Record<string, string> | null
    }[]
    return Array.isArray(rows)
      ? rows
          .map((row) => ({
            id: String(row.id),
            name: row.name ?? null,
            email: String(row.email ?? ''),
            role: (['ceo', 'admin', 'member'].includes(String(row.role)) ? String(row.role) : 'member') as TeamRole,
            allowed: canUseTranscriber(row.role, levelOf(row.page_permissions)),
          }))
          .filter((member) => member.allowed)
          .map(({ id, name, email, role }) => ({ id, name, email, role }))
      : []
  } catch {
    return []
  }
}

function supabase(): { url: string; key: string } | null {
  const url = unquote(process.env.SUPABASE_URL)
  const key = unquote(process.env.SUPABASE_SERVICE_ROLE_KEY) || unquote(process.env.SUPABASE_KEY)
  return url && key ? { url, key } : null
}

/** CEO and admin are in, always. A member needs the transcriber permission
 *  switched on for their account. */
export function canUseTranscriber(
  role: string | null | undefined,
  transcriber: 'read' | 'edit' | null | undefined,
): boolean {
  const normalized = String(role || 'member').toLowerCase()
  if (normalized === 'ceo' || normalized === 'admin') return true
  return transcriber === 'read' || transcriber === 'edit'
}

const levelOf = (permissions: Record<string, string> | null | undefined): 'read' | 'edit' | null => {
  const level = permissions?.[TRANSCRIBER_PAGE_KEY]
  return level === 'read' || level === 'edit' ? level : null
}

/** Check one email/password against the shared team table. */
export async function verifyTeamLogin(
  rawEmail: unknown,
  rawPassword: unknown,
): Promise<{ member: TeamMember } | { error: string; status: number }> {
  const email = String(rawEmail ?? '').trim().toLowerCase()
  const password = String(rawPassword ?? '')
  if (!email || !password) return { error: 'Email and password are required.', status: 400 }

  const config = supabase()
  if (!config) return { error: 'Sign-in is not configured on this server.', status: 500 }

  const query = new URL(`${config.url.replace(/\/$/, '')}/rest/v1/team_members`)
  query.searchParams.set('email', `eq.${email}`)
  query.searchParams.set('select', 'id,email,name,role,status,password_hash,page_permissions')
  query.searchParams.set('limit', '1')

  let member: TeamMember | null = null
  try {
    const response = await fetch(query, {
      headers: {
        apikey: config.key,
        Authorization: `Bearer ${config.key}`,
        Accept: 'application/json',
      },
      cache: 'no-store',
    })
    if (!response.ok) return { error: 'Sign-in is temporarily unavailable — try again.', status: 502 }
    const rows = (await response.json()) as TeamMember[]
    member = Array.isArray(rows) ? rows[0] ?? null : null
  } catch {
    return { error: 'Sign-in is temporarily unavailable — try again.', status: 502 }
  }

  if (!member || member.status !== 'active' || !member.password_hash) {
    return { error: 'Invalid email or password.', status: 401 }
  }
  const matches = await bcrypt.compare(password, member.password_hash)
  if (!matches) return { error: 'Invalid email or password.', status: 401 }

  if (!canUseTranscriber(member.role, levelOf(member.page_permissions))) {
    return {
      error: 'This account does not have access to the Transcriber — ask an admin to turn it on in Team settings.',
      status: 403,
    }
  }
  return { member }
}

/* ------------------------------------------------------------------ session */

function secret(): string {
  const value = process.env.SESSION_SECRET
  if (!value) throw new Error('SESSION_SECRET is not set')
  return value
}

const sign = (payload: string) => createHmac('sha256', secret()).update(payload).digest('base64url')

/** Constant-time compare that never throws on a length mismatch. */
function same(a: string, b: string): boolean {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  return left.length === right.length && timingSafeEqual(left, right)
}

/** Mint the cookie's token for a member who just signed in. */
export function issueSession(member: TeamMember): { token: string; session: TeamSession } {
  const now = Math.floor(Date.now() / 1000)
  const role = (['ceo', 'admin', 'member'].includes(String(member.role).toLowerCase())
    ? String(member.role).toLowerCase()
    : 'member') as TeamRole
  const session: TeamSession = {
    id: String(member.id),
    email: member.email,
    name: member.name ?? null,
    role,
    transcriber: levelOf(member.page_permissions),
    exp: now + SESSION_TTL_SEC,
  }
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
  const body = Buffer.from(JSON.stringify({ sub: session.id, email: session.email, name: session.name, role: session.role, transcriber: session.transcriber, iat: now, exp: session.exp })).toString('base64url')
  const token = `${header}.${body}.${sign(`${header}.${body}`)}`
  return { token, session }
}

/** Read a token back. Null for anything unsigned, tampered with or expired. */
export function readSession(token: string | undefined | null): TeamSession | null {
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
    const exp = Number(payload.exp)
    if (!exp || exp < Math.floor(Date.now() / 1000)) return null
    const role = (['ceo', 'admin', 'member'].includes(String(payload.role).toLowerCase())
      ? String(payload.role).toLowerCase()
      : 'member') as TeamRole
    const transcriber = payload.transcriber === 'read' || payload.transcriber === 'edit' ? payload.transcriber : null
    if (!canUseTranscriber(role, transcriber)) return null
    return {
      id: String(payload.sub ?? ''),
      email: String(payload.email ?? ''),
      name: payload.name ? String(payload.name) : null,
      role,
      transcriber,
      exp,
    }
  } catch {
    return null
  }
}
