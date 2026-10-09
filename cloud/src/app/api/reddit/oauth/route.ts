import { NextResponse } from 'next/server'
import { isSignedIn } from '@/lib/auth'
import { handleOAuthCallback, oauthStatusPayload, startOAuth } from '@/lib/reddit/oauthFlow'
import { deleteOAuthAccount } from '@/lib/reddit/requirementStore'

/**
 * The one optional Reddit account, for the requirements board's Bot Bouncer
 * column. `?action=status` reads it; `?action=start` begins the consent
 * flow; `?action=callback` finishes it (the same callback also lives at
 * `/api/auth/reddit/callback`, whichever path `REDDIT_REDIRECT_URI` names).
 * DELETE disconnects.
 */

export async function GET(request: Request) {
  if (!(await isSignedIn())) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const action = new URL(request.url).searchParams.get('action') ?? 'status'
  try {
    if (action === 'status') return NextResponse.json(await oauthStatusPayload())
    if (action === 'start') return startOAuth()
    if (action === 'callback') return handleOAuthCallback(request)
    return NextResponse.json({ error: 'unknown action' }, { status: 400 })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 })
  }
}

export async function DELETE() {
  if (!(await isSignedIn())) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  try {
    await deleteOAuthAccount()
    return NextResponse.json({ ok: true })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 })
  }
}
