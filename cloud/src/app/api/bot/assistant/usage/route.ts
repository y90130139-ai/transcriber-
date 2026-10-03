import { NextResponse } from 'next/server'
import { isBot } from '@/lib/auth'
import { usage } from '@/lib/assistant/store'

/** /q usage: questions asked and what they cost. */
export async function GET(request: Request) {
  if (!isBot(request)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  return NextResponse.json({ text: await usage() })
}
