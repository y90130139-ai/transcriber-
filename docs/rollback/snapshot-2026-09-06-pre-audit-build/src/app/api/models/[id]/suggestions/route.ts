import { NextResponse } from 'next/server'
import { isSignedIn } from '@/lib/auth'
import { suggestionsFor } from '@/lib/match'

type Params = { params: Promise<{ id: string }> }

/** Library items that fit this model and are not already on a plan of hers. */
export async function GET(request: Request, { params }: Params) {
  if (!(await isSignedIn())) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const { id } = await params
  const limit = Number(new URL(request.url).searchParams.get('limit'))

  return NextResponse.json({ items: await suggestionsFor(id, limit) })
}
