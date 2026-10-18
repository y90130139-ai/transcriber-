import { NextResponse } from 'next/server'
import { modelSessionFrom } from '@/lib/model-auth'
import { loadContent } from '@/lib/app-content-store'

/**
 * The client app's copy of the words (Geno, 2026-10-14).
 *
 * One read, the whole set — welcome, onboarding, FAQ, Client SOP,
 * expectations and the agreement — merged over the built-in defaults, with
 * a single `version` the phone can compare against its cache. The app pulls
 * this on focus and on a slow timer, which is what makes a console edit
 * appear on her phone without an app update.
 *
 * Never cached anywhere: the whole point is that the next read is the new
 * text.
 */
export async function GET(request: Request) {
  const session = await modelSessionFrom(request)
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { docs, meta } = await loadContent()
  const version =
    Object.values(meta)
      .map((entry) => entry.updatedAt)
      .filter((at): at is string => Boolean(at))
      .sort()
      .at(-1) ?? null

  return NextResponse.json(
    { version, docs },
    { headers: { 'Cache-Control': 'no-store, max-age=0' } },
  )
}
