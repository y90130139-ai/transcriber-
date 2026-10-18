import { guardAccess } from '@/lib/access'
import { NextResponse } from 'next/server'
import { addCorrection, generateReport, loadAbout } from '@/lib/report/generate'

type Params = { params: Promise<{ id: string }> }

/** Opus over the whole evidence pile takes minutes, not seconds. */
export const maxDuration = 300

/** Her Creator Intelligence report as stored, or null before the first run. */
export async function GET(request: Request, { params }: Params) {
  const denied = await guardAccess(request)
  if (denied) return denied
  const { id } = await params
  try {
    return NextResponse.json({ about: await loadAbout(id) })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 404 })
  }
}

/** Generate (or regenerate) from everything on file, plus whatever was
 *  pasted for this run — meeting notes, a call transcript, an old form. */
export async function POST(request: Request, { params }: Params) {
  const denied = await guardAccess(request)
  if (denied) return denied
  const { id } = await params
  const body = await request.json().catch(() => ({}))
  const paste = typeof body?.paste === 'string' ? body.paste : undefined
  try {
    return NextResponse.json({ about: await generateReport(id, paste) })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 502 },
    )
  }
}

/** Add one standing correction — the template's permanent correction layer.
 *  It is stored at once and folded into every later generation. */
export async function PATCH(request: Request, { params }: Params) {
  const denied = await guardAccess(request)
  if (denied) return denied
  const { id } = await params
  const body = await request.json().catch(() => null)
  const note = typeof body?.note === 'string' ? body.note.trim() : ''
  if (!note) return NextResponse.json({ error: 'say what to correct' }, { status: 400 })
  try {
    return NextResponse.json({ about: await addCorrection(id, note) })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 400 },
    )
  }
}
