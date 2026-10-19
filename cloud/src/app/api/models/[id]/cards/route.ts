import { NextResponse } from 'next/server'
import { isSignedIn } from '@/lib/auth'
import { findableCards } from '@/lib/plan-read'

type Params = { params: Promise<{ id: string }> }

/**
 * Her whole card history, for the Find a card panel.
 *
 * Deliberately unfiltered and unpaged: a model's history is a hundred-odd thin
 * rows, so one read answers every keystroke she could be searched by, and the
 * panel never waits on the network while Geno is typing. The matching itself
 * lives in `lib/card-find`, shared with the tests.
 */
export async function GET(_request: Request, { params }: Params) {
  if (!(await isSignedIn())) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const { id } = await params
  return NextResponse.json({ cards: await findableCards(id) })
}
