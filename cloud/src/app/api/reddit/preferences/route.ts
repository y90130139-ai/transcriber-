import { NextResponse } from 'next/server'
import { isSignedIn } from '@/lib/auth'
import { getPreferences, savePreferences } from '@/lib/reddit/settings'
import type { RedditPreferences } from '@/lib/reddit/types'

const RANGES: RedditPreferences['range'][] = ['1h', '6h', '24h', '7d', '30d', '90d', 'custom']

/** Saved searches, the default range, table density — the console's own
 *  choices, kept apart from the collector's configuration. */
export async function GET() {
  if (!(await isSignedIn())) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  try {
    return NextResponse.json(await getPreferences())
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 })
  }
}

export async function PUT(request: Request) {
  if (!(await isSignedIn())) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  try {
    const body = await request.json().catch(() => ({}))
    const patch: Partial<RedditPreferences> = {}
    if (body.range && RANGES.includes(body.range)) patch.range = body.range
    if (body.from !== undefined) patch.from = typeof body.from === 'string' ? body.from.slice(0, 40) : null
    if (body.to !== undefined) patch.to = typeof body.to === 'string' ? body.to.slice(0, 40) : null
    if (body.density === 'comfortable' || body.density === 'compact') patch.density = body.density
    if (Array.isArray(body.saved_searches)) {
      patch.saved_searches = body.saved_searches
        .slice(0, 30)
        .map((entry: { name?: unknown; query?: unknown; kinds?: unknown }) => ({
          name: String(entry?.name ?? '').slice(0, 60),
          query: String(entry?.query ?? '').slice(0, 200),
          kinds: Array.isArray(entry?.kinds) ? entry.kinds.map(String).slice(0, 5) : [],
        }))
        .filter((entry: { name: string; query: string }) => entry.name && entry.query)
    }
    return NextResponse.json(await savePreferences(patch))
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 })
  }
}
