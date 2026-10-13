import { NextResponse } from 'next/server'
import { findAccountByEmail, updateAccountName } from '@/lib/model-accounts'
import { modelSessionFrom } from '@/lib/model-auth'

/** Her display name, set from the app's "Make it yours" screen (2026-10-12).
 *  It is account data — it lives in Supabase with the rest of the account. */
export async function PATCH(request: Request) {
  const session = await modelSessionFrom(request)
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => null)
  const name = String(body?.name ?? '').trim().slice(0, 80)

  try {
    const account = await findAccountByEmail(session.email)
    if (!account || account.id !== session.accountId) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    }
    const updated = await updateAccountName(account.id, name)
    if (!updated) return NextResponse.json({ error: 'temporarily_unavailable' }, { status: 502 })
    return NextResponse.json({ ok: true, account: { id: updated.id, email: updated.email, name: updated.name, modelId: updated.modelId } })
  } catch {
    return NextResponse.json({ error: 'temporarily_unavailable' }, { status: 502 })
  }
}
