import { guardAccess } from '@/lib/access'
import { NextResponse } from 'next/server'
import { requirementSourceMap, subredditBoard, subredditGates, subredditListSparks } from '@/lib/reddit/queries'
import { isAdultCategory, parseSubredditInput, REGISTRY_CATEGORIES } from '@/lib/reddit/registry'
import { getSettings } from '@/lib/reddit/settings'
import { addSubreddit, registryCounts, seedRegistry, untrackedCandidates } from '@/lib/reddit/store'

/** Every community either registry knows about — the tracker's columns
 *  where trend collection follows it, the measured posting gates and their
 *  evidence everywhere. Geno, 2026-10-18: the board is the union of the
 *  two registries, so all ~1,450 communities are visible, not just the
 *  curated 19. */
export async function GET(request: Request) {
  const denied = await guardAccess(request)
  if (denied) return denied
  try {
    // First visit on a fresh install performs onboarding: the requested
    // registry lands as pending communities, waiting for validation.
    await seedRegistry()
    const settings = await getSettings()
    const [rows, untracked] = await Promise.all([
      subredditBoard(),
      untrackedCandidates(settings.adult_only),
    ])
    const ids = rows.map((row) => row.id)
    const [sparks, gates, sources] = await Promise.all([
      subredditListSparks(ids),
      subredditGates(ids),
      requirementSourceMap(ids),
    ])
    for (const row of rows) {
      row.spark = sparks.get(row.id) ?? []
      row.gates = gates.get(row.id) ?? null
      row.gate_sources = sources.get(row.id) ?? []
    }
    const categories = [...new Set(rows.map((row) => row.category))].sort((a, b) => a.localeCompare(b))
    return NextResponse.json({
      rows,
      categories,
      registry: { ...registryCounts(), untracked: untracked.length },
      untracked: untracked.slice(0, 60),
    })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 })
  }
}

/** Add one by name or URL. Existence is proven by validation, not assumed. */
export async function POST(request: Request) {
  const denied = await guardAccess(request)
  if (denied) return denied
  try {
    const body = await request.json().catch(() => ({}))
    const parsed = parseSubredditInput(String(body.input ?? ''))
    if (!parsed) return NextResponse.json({ error: 'That does not look like a subreddit name or URL' }, { status: 400 })
    const category = String(body.category ?? REGISTRY_CATEGORIES[0])
    if (!isAdultCategory(category)) {
      return NextResponse.json({ error: 'Choose an adult-creator category' }, { status: 400 })
    }
    const settings = await getSettings()
    const result = await addSubreddit({
      key: parsed.key,
      display: parsed.display,
      category,
      adult: true,
      enabled: settings.adult_enabled,
    })
    if (!result.ok) return NextResponse.json({ error: result.reason }, { status: 409 })
    return NextResponse.json({ ok: true, subreddit: { id: parsed.key, display_name: parsed.display, category, status: 'pending' } })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 })
  }
}
