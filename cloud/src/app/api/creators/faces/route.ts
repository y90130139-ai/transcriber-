import { NextResponse } from 'next/server'
import { isSignedIn } from '@/lib/auth'
import { facesFor } from '@/lib/reel-media'

/** A picture for each creator and format named — `?handles=a,b&formats=x,y`. */
export async function GET(request: Request) {
  if (!(await isSignedIn())) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const url = new URL(request.url)
  const list = (key: string) => (url.searchParams.get(key) ?? '').split(',').map((s) => s.trim().replace(/^@/, '')).filter(Boolean)
  return NextResponse.json(await facesFor(list('handles'), list('formats')))
}
