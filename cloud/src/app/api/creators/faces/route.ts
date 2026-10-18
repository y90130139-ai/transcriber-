import { guardAccess } from '@/lib/access'
import { NextResponse } from 'next/server'
import { facesFor } from '@/lib/reel-media'

/** A picture for each creator and format named — `?handles=a,b&formats=x,y`. */
export async function GET(request: Request) {
  const denied = await guardAccess(request)
  if (denied) return denied
  const url = new URL(request.url)
  const list = (key: string) => (url.searchParams.get(key) ?? '').split(',').map((s) => s.trim().replace(/^@/, '')).filter(Boolean)
  return NextResponse.json(await facesFor(list('handles'), list('formats')))
}
