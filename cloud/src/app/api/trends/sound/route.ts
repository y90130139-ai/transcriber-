import { NextResponse } from 'next/server'
import { isSignedIn } from '@/lib/auth'
import { freshAudioFor } from '@/lib/trends'

/** Save a spreading sound as a file: `?title=<audio_title>` streams the
 *  freshest stored, unexpired audio link for it, named after the sound.
 *  Proxied rather than linked because Instagram's CDN refuses the browser's
 *  cross-origin download and the links die in hours anyway — the button
 *  only shows when one is still alive (`fresh_audio` on the board). */
export async function GET(request: Request) {
  if (!(await isSignedIn())) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const title = new URL(request.url).searchParams.get('title')?.trim()
  if (!title) return NextResponse.json({ error: 'which sound?' }, { status: 400 })

  const fresh = await freshAudioFor(title)
  if (!fresh) {
    return NextResponse.json(
      { error: 'No stored copy of this sound is still alive — Scout’s next pass renews them.' },
      { status: 404 },
    )
  }

  const upstream = await fetch(fresh.url).catch(() => null)
  if (!upstream?.ok || !upstream.body) {
    return NextResponse.json({ error: 'Instagram would not hand the file over.' }, { status: 502 })
  }

  // A filename a Finder window can live with; the type as upstream says.
  const safe = title.replace(/[^\w\s&'()-]+/g, '').trim().slice(0, 60) || 'sound'
  return new Response(upstream.body, {
    headers: {
      'Content-Type': upstream.headers.get('content-type') ?? 'audio/mp4',
      'Content-Disposition': `attachment; filename="${safe}.m4a"`,
      'Cache-Control': 'no-store',
    },
  })
}
