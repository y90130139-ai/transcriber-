import { NextResponse } from 'next/server'
import { discoverFor } from '@/lib/discover'
import { modelSessionFrom } from '@/lib/model-auth'

/**
 * Her deck and her shelf, for the app (Geno, 2026-10-12).
 *
 * The same engine the portal's Discover uses — `discoverFor` tops the deck
 * up from `suggestionsFor` with all its guards, and remembers everything
 * dealt so nothing repeats. The app only renders what this returns.
 */
export async function GET(request: Request) {
  const session = await modelSessionFrom(request)
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { deck, starred } = await discoverFor(session.modelId)
  return NextResponse.json({ ok: true, deck, starred })
}
