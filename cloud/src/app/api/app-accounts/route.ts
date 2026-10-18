import { guardAccess } from '@/lib/access'
import { NextResponse } from 'next/server'
import { loadAppAccounts } from '@/lib/app-accounts'
import { sql } from '@/lib/db'
import { findAccountForModel, updateAccountModel } from '@/lib/model-accounts'

/**
 * The app-accounts list (Geno, 2026-10-12): every app account, where it
 * stands, and the model it is linked to — name and photo.
 *
 * The page renders the same read server-side for its first paint; this route
 * is the tab's refresh after an action. `lib/app-accounts.ts` is the one
 * read, so the two can never drift. Console only.
 */
export async function GET(request: Request) {
  const denied = await guardAccess(request)
  if (denied) return denied

  try {
    return NextResponse.json(await loadAppAccounts())
  } catch {
    return NextResponse.json({ error: 'The account store is unreachable — try again.' }, { status: 502 })
  }
}

/**
 * Link an account to a model (Geno, 2026-10-14) — the account page's
 * Settings tab, its one write. The account keeps its email, password and
 * history; only the link moves. A model that already has a different account
 * is refused, so the one-account-per-model rule the invite flow keeps holds
 * here too.
 */
export async function PATCH(request: Request) {
  const denied = await guardAccess(request)
  if (denied) return denied

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
  const accountId = typeof body.accountId === 'string' ? body.accountId.trim() : ''
  const modelId = typeof body.modelId === 'string' ? body.modelId.trim() : ''
  if (!accountId || !modelId) return NextResponse.json({ error: 'Pick a model first.' }, { status: 400 })

  const [model] = await sql.query(`select id, name from transcriber.models where id = $1`, [modelId])
  if (!model) return NextResponse.json({ error: 'No such model.' }, { status: 400 })

  const existing = await findAccountForModel(modelId)
  if (existing && existing.id !== accountId) {
    return NextResponse.json({ error: `${existing.email} already holds that model — move it first.` }, { status: 409 })
  }

  try {
    const account = await updateAccountModel(accountId, modelId)
    if (!account) return NextResponse.json({ error: 'No such account.' }, { status: 404 })
    return NextResponse.json({ ok: true, account })
  } catch {
    return NextResponse.json({ error: 'Could not save the link — try again.' }, { status: 502 })
  }
}
