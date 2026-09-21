import { NextResponse } from 'next/server'
import { isSignedIn } from '@/lib/auth'
import { sql } from '@/lib/db'
import { aiReady } from '@/lib/ai'
import { checksFor, scanModel } from '@/lib/quality'
import { instagramAccounts, readSocials } from '@/lib/socials'

type Params = { params: Promise<{ id: string }> }
export const maxDuration = 60

export async function GET(_request: Request, { params }: Params) {
  if (!(await isSignedIn())) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const { id } = await params
  return NextResponse.json({ checks: await checksFor(id) })
}

/** Scan her newest unchecked reels, four a request. On demand only. */
export async function POST(_request: Request, { params }: Params) {
  if (!(await isSignedIn())) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (!aiReady()) return NextResponse.json({ error: 'Workers AI is not configured' }, { status: 503 })
  const { id } = await params
  const [model] = await sql.query(`select handle, socials from transcriber.models where id = $1`, [id])
  if (!model) return NextResponse.json({ error: 'not found' }, { status: 404 })
  const handles = instagramAccounts(model.handle as string | null, readSocials(model.socials))
  const scanned = await scanModel(id, handles)
  return NextResponse.json({ scanned: scanned.length, checks: await checksFor(id) })
}
