import { NextResponse } from 'next/server'
import { isBot } from '@/lib/auth'
import { sql } from '@/lib/db'

/** The Telegram groups of inactive models, for the Gosian bot to stop its
 *  marketing messages to (lib/inactive.ts). Read every minute. */
export async function GET(request: Request) {
  if (!isBot(request)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const rows = await sql.query(
    `select telegram_chat_id from transcriber.models where status = 'paused' and telegram_chat_id is not null`,
  )
  return NextResponse.json({ chats: rows.map((r) => String(r.telegram_chat_id)) })
}
