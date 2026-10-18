import { guardAccess } from '@/lib/access'
import { NextResponse } from 'next/server'
import { trendingSounds } from '@/lib/sounds'

const PAGE = 60
const MAX_PAGE = 120

/** A page of the OFM Pro feeds' music sounds, most creators lately first,
 *  with the totals the header counts. Read-only; the worker is the writer. */
export async function GET(request: Request) {
  const denied = await guardAccess(request)
  if (denied) return denied
  const params = new URL(request.url).searchParams
  const limit = Math.min(MAX_PAGE, Math.max(1, Math.floor(Number(params.get('limit')) || PAGE)))
  const offset = Math.max(0, Math.floor(Number(params.get('offset')) || 0))
  return NextResponse.json(await trendingSounds(limit, offset))
}
