import { guardAccess } from '@/lib/access'
import { NextResponse } from 'next/server'
import { sql } from '@/lib/db'
import { aiReady } from '@/lib/ai'
import { writeCard } from '@/lib/writer'

type Params = { params: Promise<{ itemId: string }> }

export const maxDuration = 60

/**
 * One card's DM, written when Geno asks for it and not before.
 *
 * DMs used to be written for every card of every week, ahead of the captions.
 * Geno sends models the portal link, not a message per video (2026-09-25), so
 * they were paste-ready notes nobody pasted — and they doubled what a week
 * cost against the free AI allowance. Now the console's "Write DM" button calls
 * this, and an existing DM is returned rather than rewritten.
 */
export async function POST(request: Request, { params }: Params) {
  const denied = await guardAccess(request)
  if (denied) return denied
  const { itemId } = await params
  const [existing] = await sql.query(`select brief_short from transcriber.plan_items where id = $1`, [itemId])
  if (!existing) return NextResponse.json({ error: 'no such card' }, { status: 404 })
  if (existing.brief_short) return NextResponse.json({ dm: String(existing.brief_short) })
  if (!aiReady()) return NextResponse.json({ error: 'Workers AI is not configured' }, { status: 503 })

  const result = await writeCard(itemId).catch((error) => ({ ok: false, reason: String(error).slice(0, 200) }))
  if (!result.ok) {
    const limit = /429|daily free/.test(result.reason ?? '')
    return NextResponse.json(
      { error: limit ? "Today's free AI allowance is used up — try after 8pm." : 'The writer could not write this one.' },
      { status: limit ? 429 : 502 },
    )
  }
  const [row] = await sql.query(`select brief_short from transcriber.plan_items where id = $1`, [itemId])
  return NextResponse.json({ dm: String(row?.brief_short ?? '') })
}
