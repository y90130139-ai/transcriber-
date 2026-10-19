/** Model sign-in accounts — the Gosian app's door (Geno, 2026-10-12).
 *
 * Same Supabase project and the same shape as the ai-invoice creator accounts
 * (`public.creator_accounts` → `public.model_accounts`): bcrypt passwords
 * hashed server-side, SHA-256 setup tokens that only ever exist hashed, a
 * 7-day invite window and a 1-hour reset window. The tables are created by
 * `schema/model_accounts.sql`, run once in the Supabase SQL editor — the same
 * way every other table in this project gets made.
 *
 * The console invites from the model sheet; this file is everything that
 * happens after the button: mint the token, check it, activate the account,
 * verify a sign-in. There are no cookies here — the app carries a bearer
 * session (lib/model-auth.ts) and the web join page is a plain form POST.
 *
 * Server only: the service key never leaves this file's callers.
 */
import { createHash, randomBytes } from 'node:crypto'
import bcrypt from 'bcryptjs'

import { sql } from './db'

const TABLE = 'model_accounts'
const RESET_TABLE = 'model_password_resets'
const SETUP_TTL_DAYS = 7
const RESET_TTL_HOURS = 1

export type ModelAccount = {
  id: string
  email: string
  name: string | null
  modelId: string | null
  status: 'invited' | 'active' | 'disabled'
  setupSentAt: string | null
  setupSendCount: number
  lastLoginAt: string | null
  activatedAt: string | null
  createdAt: string | null
}

type Row = {
  id: string
  email: string
  name: string | null
  model_id: string | null
  status: string
  password_hash: string | null
  setup_token_hash: string | null
  setup_expires_at: string | null
  setup_sent_at: string | null
  setup_send_count: number | null
  last_login_at: string | null
  activated_at: string | null
  created_at: string | null
}

const unquote = (value: string | undefined) => (value ?? '').trim().replace(/^["']|["']$/g, '')

function supabase(): { url: string; key: string } | null {
  const url = unquote(process.env.SUPABASE_URL)
  const key = unquote(process.env.SUPABASE_SERVICE_ROLE_KEY) || unquote(process.env.SUPABASE_KEY)
  return url && key ? { url: url.replace(/\/$/, ''), key } : null
}

/** Missing credentials are a configuration state, not a crash: the console
 *  shows "invites are not set up" rather than failing the whole model sheet. */
export function accountsConfigured(): boolean {
  return supabase() !== null
}

export function normalizeEmail(email: unknown): string {
  return String(email ?? '').trim().toLowerCase()
}

export function generateToken(): string {
  return randomBytes(32).toString('hex')
}

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex')

/** Her password, and only hers — the same floor the creator dashboard sets. */
export function validatePassword(password: unknown): string {
  const value = String(password ?? '')
  if (value.length < 8) throw new Error('Password must be at least 8 characters')
  if (value.length > 200) throw new Error('Password is too long')
  return value
}

export async function hashPassword(password: unknown): Promise<string> {
  return bcrypt.hash(validatePassword(password), 12)
}

async function rest(path: string, init: RequestInit = {}): Promise<Response> {
  const config = supabase()
  if (!config) throw new Error('Model accounts are not configured (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)')
  return fetch(`${config.url}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: config.key,
      Authorization: `Bearer ${config.key}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
    cache: 'no-store',
  })
}

function mapAccount(row: Row): ModelAccount {
  return {
    id: row.id,
    email: row.email,
    name: row.name ?? null,
    modelId: row.model_id ?? null,
    status: row.status === 'active' || row.status === 'disabled' ? row.status : 'invited',
    setupSentAt: row.setup_sent_at ?? null,
    setupSendCount: Number(row.setup_send_count ?? 0),
    lastLoginAt: row.last_login_at ?? null,
    activatedAt: row.activated_at ?? null,
    createdAt: row.created_at ?? null,
  }
}

/** What the console captured for the agreement (Neon, transcriber.models). */
export type AppAgreementDetails = {
  clientLegalName?: string | null
  clientStageName?: string | null
  laterServiceStartDate?: string | null
  /** When the invite went out — the agreement's Effective Date. */
  sentAt?: string | null
}

/** What the app itself may know about her: identity plus the agreement
 *  fields the console captured when the invite went out. */
export type AppAccountDetails = {
  id: string
  email: string
  name: string | null
  modelId: string | null
  invitedAt: string | null
  clientLegalName: string | null
  clientStageName: string | null
  laterServiceStartDate: string | null
}

export function appAccountDetails(account: ModelAccount, agreement?: AppAgreementDetails | null): AppAccountDetails {
  return {
    id: account.id,
    email: account.email,
    name: account.name,
    modelId: account.modelId,
    invitedAt: agreement?.sentAt ?? account.setupSentAt ?? account.createdAt,
    clientLegalName: agreement?.clientLegalName ?? account.name,
    clientStageName: agreement?.clientStageName ?? null,
    laterServiceStartDate: agreement?.laterServiceStartDate ?? null,
  }
}

async function selectRows(path: string): Promise<Row[]> {
  const response = await rest(path)
  if (!response.ok) throw new Error(`model_accounts read failed (${response.status})`)
  const rows = (await response.json()) as Row[]
  return Array.isArray(rows) ? rows : []
}

/** The row for one email, everything included — internal callers own the
 *  decision about which fields may leave this file. */
async function findRowByEmail(email: string): Promise<Row | null> {
  const rows = await selectRows(`${TABLE}?email=eq.${encodeURIComponent(email)}&select=*&limit=1`)
  return rows[0] ?? null
}

export async function findAccountByEmail(email: unknown): Promise<ModelAccount | null> {
  const normalized = normalizeEmail(email)
  if (!normalized) return null
  const row = await findRowByEmail(normalized)
  return row ? mapAccount(row) : null
}

export async function getAccount(id: string): Promise<ModelAccount | null> {
  if (!id) return null
  const rows = await selectRows(`${TABLE}?id=eq.${encodeURIComponent(id)}&select=*&limit=1`)
  return rows[0] ? mapAccount(rows[0]) : null
}

/** The account the model sheet shows: hers, matched by the model it belongs to. */
export async function findAccountForModel(modelId: string): Promise<ModelAccount | null> {
  if (!modelId) return null
  const rows = await selectRows(
    `${TABLE}?model_id=eq.${encodeURIComponent(modelId)}&select=*&order=created_at.desc&limit=1`,
  )
  return rows[0] ? mapAccount(rows[0]) : null
}

/** The app accounts for a set of models, keyed by model id — the roster grid
 *  renders invite state on every card from one read, not one per card.
 *  An active row beats an older invited one when a model somehow has both. */
export async function accountsForModels(modelIds: string[]): Promise<Map<string, ModelAccount>> {
  const ids = modelIds.filter((id) => typeof id === 'string' && id.length > 0 && id.length <= 64)
  if (ids.length === 0) return new Map()
  const rows = await selectRows(`${TABLE}?model_id=in.(${ids.map(encodeURIComponent).join(',')})&select=*`)
  const map = new Map<string, ModelAccount>()
  for (const row of rows) {
    if (!row.model_id) continue
    const account = mapAccount(row)
    const current = map.get(row.model_id)
    if (!current || (current.status !== 'active' && account.status === 'active')) {
      map.set(row.model_id, account)
    }
  }
  return map
}

/** Every app account, newest first — what the Invites tab lists. */
export async function listAccounts(): Promise<ModelAccount[]> {
  const rows = await selectRows(`${TABLE}?select=*&order=created_at.desc&limit=500`)
  return rows.map(mapAccount)
}

/** Her display name, from the app's "Make it yours" screen (2026-10-12). */
export async function updateAccountName(id: string, name: unknown): Promise<ModelAccount | null> {
  if (!id) return null
  const clean = String(name ?? '').trim().slice(0, 80) || null
  const response = await rest(`${TABLE}?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ name: clean, updated_at: new Date().toISOString() }),
  })
  if (!response.ok) throw new Error(`model_accounts write failed (${response.status})`)
  const rows = (await response.json()) as Row[]
  return rows[0] ? mapAccount(rows[0]) : null
}

/** Re-point an account at a model (2026-10-14) — the Settings tab's one
 *  write. The console links an account that never got one, or fixes one
 *  that landed on the wrong profile; the account, her password and her
 *  history all stay exactly as they are. */
export async function updateAccountModel(id: string, modelId: string): Promise<ModelAccount | null> {
  if (!id || !modelId) return null
  const response = await rest(`${TABLE}?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ model_id: modelId, updated_at: new Date().toISOString() }),
  })
  if (!response.ok) throw new Error(`model_accounts write failed (${response.status})`)
  const rows = (await response.json()) as Row[]
  return rows[0] ? mapAccount(rows[0]) : null
}

/** Delete an account outright (Geno, 2026-10-19) — the console's own
 *  housekeeping for a duplicate, a test row, or a creator who is gone. The
 *  row and any reset link still out are deleted together.
 *
 *  Her app-side onboarding records are deleted with the account: the tour
 *  and onboarding milestones, the agreement/contact/intake submissions and
 *  her push devices all belong to the account, so a re-invite starts her
 *  onboarding over instead of logging her into a finished checklist. Her
 *  model page, plans and studio history live in other tables and are not
 *  touched. False when no row matched — the caller says "no such account". */
export async function deleteAccount(id: string): Promise<boolean> {
  if (!id) return false
  const account = await getAccount(id)
  if (!account) return false

  // Neon first: if this fails the account stays, so the console can retry
  // with both halves intact rather than a login gone and an onboarding left.
  if (account.modelId) {
    await sql.query(`delete from transcriber.app_events where model_id = $1`, [account.modelId])
    await sql.query(`delete from transcriber.app_submissions where model_id = $1`, [account.modelId])
    await sql.query(`delete from transcriber.model_devices where model_id = $1`, [account.modelId])
  }

  await rest(`${RESET_TABLE}?account_id=eq.${encodeURIComponent(id)}`, { method: 'DELETE' })
  const response = await rest(`${TABLE}?id=eq.${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: { Prefer: 'return=representation' },
  })
  if (!response.ok) throw new Error(`model_accounts delete failed (${response.status})`)
  const rows = (await response.json()) as Row[]
  return rows.length > 0
}

export type InviteResult = {
  account: ModelAccount
  /** True when a token was minted and should be emailed. False for an account
   *  that is already set up — refreshing would silently break her password. */
  invited: boolean
  token: string | null
}

/**
 * Create the account for a model, or refresh the setup token while it is still
 * waiting to be set up. An active account is left exactly as it is — getting
 * back in is the password-reset flow's job, not this one's.
 */
export async function createOrRefreshInvite({
  modelId,
  email,
  name,
}: {
  modelId: string
  email: unknown
  name?: string | null
}): Promise<InviteResult> {
  const normalized = normalizeEmail(email)
  if (!normalized) throw new Error('An email address is required to send the invite')

  const existing = await findRowByEmail(normalized)
  if (existing && existing.status === 'active') {
    return { account: mapAccount(existing), invited: false, token: null }
  }

  const token = generateToken()
  const now = new Date()
  const expiresAt = new Date(now.getTime() + SETUP_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString()
  const cleanName = String(name ?? '').trim() || null

  const patch = {
    email: normalized,
    name: cleanName ?? existing?.name ?? null,
    model_id: modelId,
    status: 'invited',
    setup_token_hash: hashToken(token),
    setup_expires_at: expiresAt,
    setup_sent_at: now.toISOString(),
    setup_send_count: Number(existing?.setup_send_count ?? 0) + 1,
    updated_at: now.toISOString(),
  }

  const response = existing
    ? await rest(`${TABLE}?id=eq.${encodeURIComponent(existing.id)}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify(patch),
      })
    : await rest(TABLE, {
        method: 'POST',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify({ ...patch, created_at: now.toISOString() }),
      })

  if (!response.ok) throw new Error(`model_accounts write failed (${response.status})`)
  const rows = (await response.json()) as Row[]
  const row = rows[0]
  if (!row) throw new Error('model_accounts write returned nothing')
  return { account: mapAccount(row), invited: true, token }
}export type SetupTokenState = { account: ModelAccount; alreadyActive: boolean }

/** A setup token, resolved. Null for unknown, expired, or already-used ones —
 *  every caller turns null into the same "link is no longer valid" screen. */
export async function validateSetupToken(token: unknown): Promise<SetupTokenState | null> {
  const value = String(token ?? '').trim()
  if (!/^[a-f0-9]{64}$/.test(value)) return null
  const rows = await selectRows(`${TABLE}?setup_token_hash=eq.${hashToken(value)}&select=*&limit=1`)
  const row = rows[0]
  if (!row) return null
  if (!row.setup_expires_at || new Date(row.setup_expires_at).getTime() < Date.now()) return null
  if (row.status === 'active') return { account: mapAccount(row), alreadyActive: true }
  if (row.status !== 'invited') return null
  return { account: mapAccount(row), alreadyActive: false }
}

/** She set her password from the invite link. The token dies here. */
export async function activateWithToken({
  token,
  password,
  name,
}: {
  token: unknown
  password: unknown
  name?: unknown
}): Promise<ModelAccount> {
  const state = await validateSetupToken(token)
  if (!state) throw new Error('This setup link is invalid or has expired')
  if (state.alreadyActive) throw new Error('This account has already been set up. Please sign in.')

  const passwordHash = await hashPassword(password)
  const now = new Date().toISOString()
  const response = await rest(`${TABLE}?id=eq.${encodeURIComponent(state.account.id)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      password_hash: passwordHash,
      status: 'active',
      name: String(name ?? '').trim() || state.account.name,
      setup_token_hash: null,
      setup_expires_at: null,
      activated_at: now,
      last_login_at: now,
      updated_at: now,
    }),
  })
  if (!response.ok) throw new Error(`model_accounts write failed (${response.status})`)
  const rows = (await response.json()) as Row[]
  if (!rows[0]) throw new Error('model_accounts write returned nothing')
  return mapAccount(rows[0])
}

/** Email + password against the account. Null for anything that must not be
 *  told apart from anything else: wrong password, unknown email, disabled. */
export async function verifyLogin(email: unknown, password: unknown): Promise<ModelAccount | null> {
  const normalized = normalizeEmail(email)
  const secret = String(password ?? '')
  if (!normalized || !secret) return null
  const row = await findRowByEmail(normalized)
  if (!row || row.status !== 'active' || !row.password_hash) return null
  const matches = await bcrypt.compare(secret, row.password_hash)
  return matches ? mapAccount(row) : null
}

/** Recorded lazily — a failed touch never blocks a sign-in. */
export async function touchLogin(id: string): Promise<void> {
  try {
    await rest(`${TABLE}?id=eq.${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ last_login_at: new Date().toISOString() }),
    })
  } catch {
    /* not worth failing a sign-in over */
  }
}

/** A reset link for an active account. Unknown and inactive emails come back
 *  null and the caller says nothing about it — the same answer for both. */
export async function requestReset(email: unknown): Promise<{ token: string; account: ModelAccount } | null> {
  const normalized = normalizeEmail(email)
  if (!normalized) return null
  const row = await findRowByEmail(normalized)
  if (!row || row.status !== 'active') return null

  // One live link at a time: a second request retires the first.
  await rest(`${RESET_TABLE}?account_id=eq.${encodeURIComponent(row.id)}&used_at=is.null`, { method: 'DELETE' })

  const token = generateToken()
  const expiresAt = new Date(Date.now() + RESET_TTL_HOURS * 60 * 60 * 1000).toISOString()
  const response = await rest(RESET_TABLE, {
    method: 'POST',
    body: JSON.stringify({
      account_id: row.id,
      email: row.email,
      token_hash: hashToken(token),
      expires_at: expiresAt,
      created_at: new Date().toISOString(),
    }),
  })
  if (!response.ok) throw new Error(`model_password_resets write failed (${response.status})`)
  return { token, account: mapAccount(row) }
}

type ResetRow = { id: string; account_id: string; used_at: string | null; expires_at: string }

async function findResetRow(token: unknown): Promise<ResetRow | null> {
  const value = String(token ?? '').trim()
  if (!/^[a-f0-9]{64}$/.test(value)) return null
  const response = await rest(`${RESET_TABLE}?token_hash=eq.${hashToken(value)}&select=*&limit=1`)
  if (!response.ok) throw new Error(`model_password_resets read failed (${response.status})`)
  const rows = (await response.json()) as ResetRow[]
  const row = rows[0]
  if (!row || row.used_at) return null
  if (new Date(row.expires_at).getTime() < Date.now()) return null
  return row
}

/** The account behind a reset token, without spending it. */
export async function validateResetToken(token: unknown): Promise<ModelAccount | null> {
  const row = await findResetRow(token)
  if (!row) return null
  const account = await getAccount(row.account_id)
  return account && account.status !== 'disabled' ? account : null
}

/** Password replaced from a reset link; the link burns with the use. */
export async function resetWithToken(token: unknown, password: unknown): Promise<ModelAccount> {
  const row = await findResetRow(token)
  if (!row) throw new Error('This reset link is invalid or has expired')

  const passwordHash = await hashPassword(password)
  const now = new Date().toISOString()
  const response = await rest(`${TABLE}?id=eq.${encodeURIComponent(row.account_id)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ password_hash: passwordHash, updated_at: now }),
  })
  if (!response.ok) throw new Error(`model_accounts write failed (${response.status})`)
  const rows = (await response.json()) as Row[]
  if (!rows[0]) throw new Error('model_accounts write returned nothing')

  await rest(`${RESET_TABLE}?token_hash=eq.${hashToken(String(token).trim())}`, {
    method: 'PATCH',
    body: JSON.stringify({ used_at: now }),
  })
  return mapAccount(rows[0])
}
