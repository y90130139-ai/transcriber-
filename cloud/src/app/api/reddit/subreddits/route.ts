import { NextResponse } from 'next/server'
import { isSignedIn } from '@/lib/auth'
import { subredditListSparks } from '@/lib/reddit/queries'
import { isAdultCategory, parseSubredditInput, REGISTRY_CATEGORIES } from '@/lib/reddit/registry'
import { getSettings } from '@/lib/reddit/settings'
import { addSubreddit, listSubreddits, registryCounts, seedRegistry, untrackedCandidates } from '@/lib/reddit/store'

/** Every tracked community, with whatever the last run observed. */
export async function GET(request: Request) {
  if (!(await isSignedIn())) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const params = new URL(request.url).searchParams
  try {
    // First visit on a fresh install performs onboarding: the requested
    // registry lands as pending communities, waiting for validation.
    await seedRegistry()
    const settings = await getSettings()
    const [rows, untracked] = await Promise.all([
      listSubreddits({
        search: params.get('q') ?? undefined,
        category: params.get('category') ?? undefined,
        status: params.get('status') ?? undefined,
        priority: params.get('priority') ?? undefined,
        adultOnly: settings.adult_only,
      }),
      untrackedCandidates(settings.adult_only),
    ])
    const sparks = await subredditListSparks(rows.map((row) => row.id))
    for (const row of rows) row.spark = sparks.get(row.id) ?? []
    return NextResponse.json({
      rows,
      categories: REGISTRY_CATEGORIES,
      registry: { ...registryCounts(), untracked: untracked.length },
      untracked: untracked.slice(0, 60),
    })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 })
  }
}

/** Add one by name or URL. Existence is proven by validation, not assumed. */
export async function POST(request: Request) {
  if (!(await isSignedIn())) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
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
