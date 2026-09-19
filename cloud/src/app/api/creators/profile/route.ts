import { NextResponse, after } from 'next/server'
import { isSignedIn, isWorker } from '@/lib/auth'
import { isScheduler } from '@/lib/cron'
import { decide, openProposals, profile, profilerReady, store, unprofiled } from '@/lib/profiler'

export const maxDuration = 60

/** Creators per run. Each is a vision call over eight frames, and five of
 *  them took 59 of the function's 60 seconds — so three, and the panel asks
 *  again rather than gambling on the clock. */
const BATCH = 3

/** What is waiting on a human. */
export async function GET() {
  if (!(await isSignedIn())) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const proposals = await openProposals()
  return NextResponse.json({ proposals, ready: profilerReady() })
}

/** Profile the next few unprofiled creators, or decide one.
 *
 * `{ handle, tags }` takes a proposal (tags as offered, or edited);
 * `{ handle, tags: null }` rejects it. Otherwise it runs a batch. */
export async function POST(request: Request) {
  const invited = (await isSignedIn()) || isScheduler(request) || isWorker(request)
  if (!invited) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => ({}))

  if (typeof body.handle === 'string') {
    const tags = body.tags === null ? null : Array.isArray(body.tags) ? body.tags.map(String) : null
    const applied = await decide(body.handle.toLowerCase(), tags)
    return NextResponse.json({ handle: body.handle, persona: applied })
  }

  if (!profilerReady()) {
    return NextResponse.json({ error: 'CLOUDFLARE_AI_TOKEN is not set' }, { status: 503 })
  }

  const limit = Math.min(Math.max(Number(body.limit) || BATCH, 1), BATCH)
  const handles = await unprofiled(limit)
  const made: { handle: string; tags: string[] }[] = []
  const errors: string[] = []
  for (const handle of handles) {
    try {
      const proposal = await profile(handle)
      if (!proposal) continue
      await store(proposal)
      made.push({ handle, tags: proposal.tags })
    } catch (error) {
      errors.push(`${handle}: ${String(error).slice(0, 140)}`)
    }
  }
  // Chain rather than loop: 178 creators is an hour of vision calls and no
  // function lives that long. Each pass hands the next one the baton, and the
  // chain stops when `unprofiled` comes back empty.
  const left = (await unprofiled(1)).length
  if (body.chain === true && made.length > 0 && left > 0) {
    const next = new URL(request.url).origin + '/api/creators/profile'
    after(async () => {
      await fetch(next, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.CRON_SECRET ?? ''}` },
        body: JSON.stringify({ chain: true }),
      }).catch(() => {})
    })
  }

  return NextResponse.json({ profiled: made.length, made, errors, more: left > 0 })
}
