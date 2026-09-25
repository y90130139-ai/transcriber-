import { NextResponse } from 'next/server'
import { isSignedIn, isWorker } from '@/lib/auth'
import { aiReady } from '@/lib/ai'
import { writeWeekCaptions } from '@/lib/captions'

type Params = { params: Promise<{ id: string }> }

/** A week of captions is one planning pass and a call per card, in waves —
 *  a minute or two, well past the old 60s limit. */
export const maxDuration = 300

/**
 * Write the week's captions (`captions.ts`), for cards that have none.
 *
 * DMs are no longer written here. Geno sends models the portal link, not a
 * message per video (2026-09-25), so a DM is written only when he asks for one,
 * from the card (`/api/dm/<card>`). `{"captions": true}` rewrites every card's
 * captions; `"model": "default"` uses the free 70B instead of gpt-oss-120b, and
 * `"dry": true` shows the result without storing it.
 */
export async function POST(request: Request, { params }: Params) {
  // The console button, or the worker secret — the same pair `/api/retag`
  // takes, so this can be run for a whole week from a terminal or a timer
  // rather than only by somebody holding the page open.
  if (!(isWorker(request) || (await isSignedIn()))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  if (!aiReady()) return NextResponse.json({ error: 'Workers AI is not configured' }, { status: 503 })
  const { id } = await params
  const body = await request.json().catch(() => ({}))

  if (body.captions === true) {
    const captions = await writeWeekCaptions(id, {
      rewrite: true,
      model: body.model === 'default' ? 'default' : 'strong',
      dry: body.dry === true,
    })
    return NextResponse.json({ written: captions.ok ? 1 : 0, captions, remaining: 0 })
  }

  const captions = await writeWeekCaptions(id).catch((error) => ({
    ok: false, reason: String(error).slice(0, 160), cards: 0, captions: 0, short: 0,
  }))
  return NextResponse.json({ written: captions.ok ? 1 : 0, captions, remaining: 0 })
}
