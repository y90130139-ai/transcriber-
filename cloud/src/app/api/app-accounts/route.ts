import { NextResponse } from 'next/server'
import { isSignedIn } from '@/lib/auth'
import { loadAppAccounts } from '@/lib/app-accounts'

/**
 * The app-accounts list (Geno, 2026-10-12): every app account, where it
 * stands, and the model it is linked to — name and photo.
 *
 * The page renders the same read server-side for its first paint; this route
 * is the tab's refresh after an action. `lib/app-accounts.ts` is the one
 * read, so the two can never drift. Console only.
 */
export async function GET() {
  if (!(await isSignedIn())) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  try {
    return NextResponse.json(await loadAppAccounts())
  } catch {
    return NextResponse.json({ error: 'The account store is unreachable — try again.' }, { status: 502 })
  }
}
