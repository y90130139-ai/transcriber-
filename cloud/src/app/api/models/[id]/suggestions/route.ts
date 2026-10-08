import { NextResponse } from 'next/server'
import { isSignedIn } from '@/lib/auth'
import { suggestionsFor } from '@/lib/match'
import { isValidTag } from '@/lib/taxonomy'

type Params = { params: Promise<{ id: string }> }

/** Library items that fit this model and are not already on a plan of hers.
 *  `formats=a,b` narrows the rail to those formats — the editor's chips. */
export async function GET(request: Request, { params }: Params) {
  if (!(await isSignedIn())) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const { id } = await params
  const url = new URL(request.url)
  const limit = Number(url.searchParams.get('limit'))
  const formats = (url.searchParams.get('formats') ?? '')
    .split(',')
    .map((tag) => tag.trim())
    .filter((tag) => isValidTag('format', tag))

  return NextResponse.json({
    items: await suggestionsFor(id, limit, formats.length > 0 ? formats : undefined),
  })
}
