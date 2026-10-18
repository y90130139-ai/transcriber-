import { guardAccess } from '@/lib/access'
import { NextResponse } from 'next/server'
import {
  createSubredditList,
  deleteSubredditList,
  listSubredditLists,
  updateSubredditListItems,
} from '@/lib/reddit/requirementStore'

/** Saved lists of communities ("+ New List" on the requirements board). A
 *  list is just a name and a set of subreddit keys; it never duplicates the
 *  board's own data. */

export async function GET(request: Request) {
  const denied = await guardAccess(request)
  if (denied) return denied
  try {
    return NextResponse.json({ lists: await listSubredditLists() })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 })
  }
}

export async function POST(request: Request) {
  const denied = await guardAccess(request)
  if (denied) return denied
  try {
    const body = await request.json().catch(() => ({}))
    const name = String(body.name ?? '').trim()
    if (name.length < 2) return NextResponse.json({ error: 'Give the list a name' }, { status: 400 })
    const list = await createSubredditList(name, Array.isArray(body.subreddits) ? body.subreddits.map(String) : [])
    return NextResponse.json({ ok: true, list })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 })
  }
}

export async function PATCH(request: Request) {
  const denied = await guardAccess(request)
  if (denied) return denied
  try {
    const body = await request.json().catch(() => ({}))
    const id = String(body.id ?? '').trim()
    if (!id) return NextResponse.json({ error: 'Which list?' }, { status: 400 })
    const affected = await updateSubredditListItems(
      id,
      Array.isArray(body.add) ? body.add.map(String) : [],
      Array.isArray(body.remove) ? body.remove.map(String) : [],
    )
    return NextResponse.json({ ok: true, affected })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 })
  }
}

export async function DELETE(request: Request) {
  const denied = await guardAccess(request)
  if (denied) return denied
  try {
    const id = new URL(request.url).searchParams.get('id') ?? ''
    if (!id) return NextResponse.json({ error: 'Which list?' }, { status: 400 })
    await deleteSubredditList(id)
    return NextResponse.json({ ok: true })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 })
  }
}
