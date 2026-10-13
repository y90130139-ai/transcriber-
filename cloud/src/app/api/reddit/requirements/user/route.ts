import { NextResponse } from 'next/server'
import { isSignedIn } from '@/lib/auth'
import { fetchRequirementProfile } from '@/lib/reddit/collect'

/** The u/ search: read one account's karma and account age so the board can
 *  say which of its gates that account would clear. One governed request,
 *  cached for six hours. */
export const maxDuration = 30

export async function POST(request: Request) {
  if (!(await isSignedIn())) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  try {
    const body = await request.json().catch(() => ({}))
    const username = String(body.username ?? '').trim()
    if (username.length < 2) return NextResponse.json({ error: 'Enter a username' }, { status: 400 })
    const profile = await fetchRequirementProfile(username)
    if (!profile) {
      return NextResponse.json({ error: `No data for u/${username}` }, { status: 404 })
    }
    return NextResponse.json({ profile })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 })
  }
}
