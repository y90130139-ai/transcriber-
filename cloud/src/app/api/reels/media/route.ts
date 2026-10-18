import { guardAccess } from '@/lib/access'
import { NextResponse } from 'next/server'
import { mediaForPosts } from '@/lib/reel-media'

/** Covers, playable video and numbers for reels, by shortcode —
 *  `?codes=A,B,C`. For the profile's video carousels. */
export async function GET(request: Request) {
  const denied = await guardAccess(request)
  if (denied) return denied
  const codes = (new URL(request.url).searchParams.get('codes') ?? '').split(',').map((c) => c.trim()).filter((c) => /^[A-Za-z0-9_-]{5,20}$/.test(c))
  return NextResponse.json({ media: await mediaForPosts(codes) })
}
