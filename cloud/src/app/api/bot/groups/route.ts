import { NextResponse } from 'next/server'
import { isBot, isSignedIn } from '@/lib/auth'
import { sql } from '@/lib/db'

const MAX_GROUPS = 200
const MAX_TEXT = 200

const text = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim().slice(0, MAX_TEXT) : null

/**
 * The Gosian bot's creator groups — what a model can be linked to.
 *
 * PUT (the bot, on start and hourly): the whole list, replacing what was here.
 * A group the bot no longer has is dropped; a model still linked to it keeps
 * its chat id and the Week tab says the group is gone, rather than quietly
 * unlinking her. GET (the console): the list, for the picker.
 */
export async function PUT(request: Request) {
  if (!isBot(request)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const body = await request.json().catch(() => ({}))
  const groups = (Array.isArray(body.groups) ? body.groups : [])
    .slice(0, MAX_GROUPS)
    .map((group: Record<string, unknown>) => ({
      chat_id: text(String(group?.chat_id ?? '')),
      title: text(group?.title),
      creator_name: text(group?.creator_name),
      skip_campaigns: group?.skip_campaigns === true,
    }))
    .filter((group: { chat_id: string | null; title: string | null }) => group.chat_id && group.title)
  // An empty list is far more likely a broken bot than a bot with no creators,
  // and accepting it would wipe every picker.
  if (groups.length === 0) return NextResponse.json({ error: 'no groups' }, { status: 400 })

  await sql.transaction([
    sql.query(
      `insert into transcriber.telegram_groups (chat_id, title, creator_name, skip_campaigns, synced_at)
       select g.chat_id, g.title, g.creator_name, g.skip_campaigns, now()
         from json_to_recordset($1::json)
           as g(chat_id text, title text, creator_name text, skip_campaigns boolean)
       on conflict (chat_id) do update
          set title = excluded.title, creator_name = excluded.creator_name,
              skip_campaigns = excluded.skip_campaigns, synced_at = now()`,
      [JSON.stringify(groups)],
    ),
    sql.query(
      `delete from transcriber.telegram_groups where chat_id <> all($1::text[])`,
      [groups.map((group: { chat_id: string }) => group.chat_id)],
    ),
  ])
  return NextResponse.json({ ok: true, groups: groups.length })
}

export async function GET() {
  if (!(await isSignedIn())) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const groups = await sql.query(
    `select g.chat_id, g.title, g.creator_name, g.skip_campaigns, g.synced_at,
            (select json_agg(m.name order by m.name) from transcriber.models m
              where m.telegram_chat_id = g.chat_id) as linked_to
       from transcriber.telegram_groups g
      order by g.title`,
  )
  return NextResponse.json({ groups })
}
