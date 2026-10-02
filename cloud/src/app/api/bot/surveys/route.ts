import { NextResponse } from 'next/server'
import { isBot } from '@/lib/auth'
import { dueSurveys } from '@/lib/survey/store'

/** Questionnaire links to post, and reminders due. Polled by the Gosian bot. */
export async function GET(request: Request) {
  if (!isBot(request)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  return NextResponse.json({ items: await dueSurveys(new URL(request.url).origin) })
}
