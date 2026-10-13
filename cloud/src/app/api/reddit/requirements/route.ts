import { NextResponse } from 'next/server'
import { isSignedIn } from '@/lib/auth'
import { requirementBoardMeta, requirementRows, type RequirementQuery } from '@/lib/reddit/queries'
import { isAdultCategory, parseSubredditInput, REGISTRY_CATEGORIES } from '@/lib/reddit/registry'
import {
  addRequirementSubreddit,
  createSubredditList,
  discoveryStatus,
  listSubredditLists,
  removeRequirementSubreddit,
  setBotBouncerStatus,
  setRequirementDueNow,
  updateRequirementSubreddit,
} from '@/lib/reddit/requirementStore'
import { getSettings } from '@/lib/reddit/settings'

/**
 * The Subreddits Requirements board: rows, board meta, saved lists and the
 * discovery sweep's tallies in one read. Every figure comes from samples the
 * collector already wrote; this route never talks to Reddit.
 */

export async function GET(request: Request) {
  if (!(await isSignedIn())) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const params = new URL(request.url).searchParams
  try {
    const query: RequirementQuery = {
      search: params.get('q'),
      category: params.get('category'),
      botBouncer: (params.get('botBouncer') as RequirementQuery['botBouncer']) ?? 'all',
      includeNsfw: params.get('nsfw') === '0' ? false : true,
      list: params.get('list'),
      status: params.get('status'),
      limit: Number(params.get('limit') ?? 400) || 400,
      offset: Number(params.get('offset') ?? 0) || 0,
    }
    const [rows, meta, lists, settings] = await Promise.all([
      requirementRows(query),
      requirementBoardMeta(),
      listSubredditLists(),
      getSettings(),
    ])
    return NextResponse.json({
      rows,
      meta,
      lists,
      discovery: await discoveryStatus(
        settings.discovery_enabled,
        settings.discovery_daily_cap,
        settings.discovery_min_subscribers,
        settings.discovery_max_communities,
        settings.content_scan_percent,
      ),
      settings: {
        requirements_enabled: settings.requirements_enabled,
        requirements_interval_minutes: settings.requirements_interval_minutes,
      },
      categories: REGISTRY_CATEGORIES,
    })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 })
  }
}

/** Add one community by name or URL, or bulk-add a picked list of names. */
export async function POST(request: Request) {
  if (!(await isSignedIn())) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  try {
    const body = await request.json().catch(() => ({}))
    const category = String(body.category ?? '').trim() || 'Uncategorized'
    if (body.category && !isAdultCategory(category) && !body.allowAnyCategory) {
      return NextResponse.json({ error: 'Choose an adult-creator category, or leave the default' }, { status: 400 })
    }
    const inputs: string[] = Array.isArray(body.inputs) ? body.inputs.map(String) : [String(body.input ?? '')]
    const added: string[] = []
    const failed: { input: string; reason: string }[] = []
    for (const input of inputs.slice(0, 100)) {
      const parsed = parseSubredditInput(input)
      if (!parsed) {
        if (input.trim()) failed.push({ input, reason: 'not a subreddit name or URL' })
        continue
      }
      const result = await addRequirementSubreddit({
        key: parsed.key,
        display: parsed.display,
        category,
        over18: true,
      })
      if (!result.ok) failed.push({ input, reason: result.reason ?? 'could not be added' })
      else added.push(parsed.key)
    }
    return NextResponse.json({ ok: true, added, failed })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 })
  }
}

/** Row-level actions: category, priority, enable/pause, bring the scan
 *  forward, set the Bot Bouncer badge, or save the current result set as a
 *  new list. */
export async function PATCH(request: Request) {
  if (!(await isSignedIn())) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  try {
    const body = await request.json().catch(() => ({}))
    const action = String(body.action ?? 'update')
    if (action === 'list') {
      const name = String(body.name ?? '').trim()
      if (name.length < 2) return NextResponse.json({ error: 'Give the list a name' }, { status: 400 })
      const list = await createSubredditList(name, Array.isArray(body.subreddits) ? body.subreddits.map(String) : [])
      return NextResponse.json({ ok: true, list })
    }
    const id = parseSubredditInput(String(body.id ?? ''))
    if (!id) return NextResponse.json({ error: 'Unknown community' }, { status: 400 })
    if (action === 'due') {
      await setRequirementDueNow(id.key)
      return NextResponse.json({ ok: true })
    }
    if (action === 'botbouncer') {
      const status = ['yes', 'no', 'unknown'].includes(body.status) ? body.status : 'unknown'
      await setBotBouncerStatus(id.key, status)
      return NextResponse.json({ ok: true, bot_bouncer: status })
    }
    await updateRequirementSubreddit(id.key, {
      category: typeof body.category === 'string' ? body.category : undefined,
      priority: ['high', 'medium', 'low'].includes(body.priority) ? body.priority : undefined,
      enabled: typeof body.enabled === 'boolean' ? body.enabled : undefined,
    })
    return NextResponse.json({ ok: true })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 })
  }
}

export async function DELETE(request: Request) {
  if (!(await isSignedIn())) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  try {
    const id = new URL(request.url).searchParams.get('id') ?? ''
    const parsed = parseSubredditInput(id)
    if (!parsed) return NextResponse.json({ error: 'Unknown community' }, { status: 400 })
    await removeRequirementSubreddit(parsed.key)
    return NextResponse.json({ ok: true })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 })
  }
}
