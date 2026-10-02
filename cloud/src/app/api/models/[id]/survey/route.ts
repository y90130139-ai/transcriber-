import { NextResponse } from 'next/server'
import { isSignedIn } from '@/lib/auth'
import { latestFor, requestSurvey } from '@/lib/survey/store'

type Params = { params: Promise<{ id: string }> }

/** Queue her questionnaire; the Gosian bot posts it within a minute. */
export async function POST(_request: Request, { params }: Params) {
  if (!(await isSignedIn())) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const { id } = await params
  return NextResponse.json({ ok: true, ...(await requestSurvey(id)) })
}

/** Her latest questionnaire: where it stands, her answers, what they changed. */
export async function GET(_request: Request, { params }: Params) {
  if (!(await isSignedIn())) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const { id } = await params
  const row = await latestFor(id)
  if (!row) return NextResponse.json({ error: 'not found' }, { status: 404 })
  return NextResponse.json({ survey: row })
}
