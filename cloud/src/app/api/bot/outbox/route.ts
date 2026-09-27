import { NextResponse } from 'next/server'
import { isBot } from '@/lib/auth'
import { sql } from '@/lib/db'

/**
 * What the bot has to do: weeks sent from the console that it has not handled.
 *
 *   post    post it in her MARKETING topic (Geno chose "Send on Telegram")
 *   record  post nothing; note it as sent (Geno sent it himself), so the
 *           bot's end-of-day report counts it
 *
 * The link is her portal link on the host the bot called — the same address
 * she is always sent, whichever week is live.
 */
export async function GET(request: Request) {
  if (!isBot(request)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const origin = new URL(request.url).origin
  const rows = await sql.query(
    `select p.id as plan_id,
            case p.telegram_state when 'queued' then 'post' else 'record' end as kind,
            p.telegram_variant as variant,
            to_char(p.week_of, 'YYYY-MM-DD') as week_of,
            m.name as model_name, m.telegram_chat_id as chat_id, m.access_token
       from transcriber.plans p
       join transcriber.models m on m.id = p.model_id
      where p.telegram_state in ('queued', 'manual')
        and p.status = 'sent'
        and m.telegram_chat_id is not null
      order by p.telegram_queued_at`,
  )
  return NextResponse.json({
    items: rows.map(({ access_token, ...row }) => ({ ...row, link: `${origin}/p/${access_token}` })),
  })
}
