import { NextResponse } from 'next/server'
import { findAccountByEmail } from '@/lib/model-accounts'
import { modelSessionFrom } from '@/lib/model-auth'

/**
 * Who the app is looking at. Read on launch: the stored token survives 30
 * days, but the account behind it can be disabled at any time, so the session
 * is only trusted after the account is read back and found active.
 */
export async function GET(request: Request) {
  const session = await modelSessionFrom(request)
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  let account = null
  try {
    account = await findAccountByEmail(session.email)
  } catch {
    return NextResponse.json({ error: 'temporarily_unavailable' }, { status: 502 })
  }
  if (!account || account.status !== 'active' || account.id !== session.accountId) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  return NextResponse.json({
    ok: true,
    account: { id: account.id, email: account.email, name: account.name, modelId: account.modelId },
  })
}
