import { NextResponse } from 'next/server'
import { readSurvey } from '@/lib/survey/core'
import { submitSurvey } from '@/lib/survey/store'

type Params = { params: Promise<{ token: string }> }

/** Her answers. The token is the auth; a bad one is a 404, as everywhere on /p. */
export async function POST(request: Request, { params }: Params) {
  const { token } = await params
  const read = readSurvey(await request.json().catch(() => null))
  if ('error' in read) return NextResponse.json({ error: read.error }, { status: 400 })
  try {
    const result = await submitSurvey(token, read.answers)
    if (!result) return NextResponse.json({ error: 'not found' }, { status: 404 })
    // Her priority is set but never sent back — she is not told it.
    return NextResponse.json({ ok: true, weekly: result.weekly })
  } catch (error) {
    console.error('survey submit failed', error)
    return NextResponse.json({ error: 'Could not save your answers. Try again in a moment.' }, { status: 500 })
  }
}
