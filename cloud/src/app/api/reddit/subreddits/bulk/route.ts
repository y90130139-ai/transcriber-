import { guardAccess } from '@/lib/access'
import { NextResponse } from 'next/server'
import { isAdultCategory } from '@/lib/reddit/registry'
import { bulkDeleteSubreddits, bulkUpdateSubreddits } from '@/lib/reddit/store'

/**
 * One call for many communities — the tracking table's select-all actions:
 * move to a category, set a priority, pause, resume, remove. A single
 * UPDATE/DELETE per action, so selecting every community is still one
 * round trip.
 */
export async function POST(request: Request) {
  const denied = await guardAccess(request)
  if (denied) return denied
  try {
    const body = await request.json().catch(() => ({}))
    const ids = Array.isArray(body.ids) ? body.ids.map(String).slice(0, 300) : []
    if (!ids.length) return NextResponse.json({ error: 'ids is required' }, { status: 400 })
    const action = String(body.action ?? '')
    const value = body.value === undefined ? '' : String(body.value)

    let affected = 0
    if (action === 'pause') affected = await bulkUpdateSubreddits(ids, { paused: true })
    else if (action === 'resume') affected = await bulkUpdateSubreddits(ids, { paused: false })
    else if (action === 'category') {
      const category = value.trim()
      if (!isAdultCategory(category)) {
        return NextResponse.json({ error: 'Choose an adult-creator category' }, { status: 400 })
      }
      affected = await bulkUpdateSubreddits(ids, { category, adult: true })
    } else if (action === 'priority') {
      if (!['high', 'medium', 'low'].includes(value)) return NextResponse.json({ error: 'invalid priority' }, { status: 400 })
      affected = await bulkUpdateSubreddits(ids, { priority: value as 'high' | 'medium' | 'low' })
    } else if (action === 'remove') {
      affected = await bulkDeleteSubreddits(ids)
    } else {
      return NextResponse.json({ error: 'unknown action' }, { status: 400 })
    }
    return NextResponse.json({ ok: true, affected })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 })
  }
}
