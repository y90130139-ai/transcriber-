import { NextResponse } from 'next/server'
import { isSignedIn } from '@/lib/auth'
import { sql } from '@/lib/db'

type Params = { params: Promise<{ id: string }> }

/**
 * Every conversation this model has had on her cards, across every week —
 * the history behind the roster's "3 unread" (Geno, 2026-10-07: "there's
 * no way to read where that is").
 *
 * One thread per card, newest activity first, with the worked-out state:
 * a thread is ANSWERED when the last word was ours, OPEN when it was hers.
 * Nothing is marked read here — reading about a question is not answering
 * it; the reply (through the existing /api/plans/<id>/items) is what marks
 * her messages seen, exactly as the plan editor always has.
 */
export async function GET(_request: Request, { params }: Params) {
  if (!(await isSignedIn())) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const { id } = await params

  const rows = await sql.query(
    `select i.id as item_id, i.plan_id, i.card_no, i.position, i.title,
            p.week_of::text as week_of,
            m.id as message_id, m.author, m.body,
            to_char(m.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as at,
            (m.author = 'model' and m.seen_at is null) as unseen
       from transcriber.plan_messages m
       join transcriber.plan_items i on i.id = m.item_id
       join transcriber.plans p on p.id = i.plan_id
      where p.model_id = $1
      order by m.created_at`,
    [id],
  )

  type Thread = {
    item_id: string
    plan_id: string
    week_of: string
    card: string
    title: string | null
    messages: { id: string; author: string; body: string; at: string }[]
    unread: number
    answered: boolean
    last_at: string
  }
  const threads = new Map<string, Thread>()
  for (const row of rows) {
    const key = String(row.item_id)
    const thread = threads.get(key) ?? {
      item_id: key,
      plan_id: String(row.plan_id),
      week_of: String(row.week_of),
      card: `V-${row.card_no ?? Number(row.position) + 1}`,
      title: row.title ? String(row.title) : null,
      messages: [],
      unread: 0,
      answered: true,
      last_at: '',
    }
    thread.messages.push({
      id: String(row.message_id),
      author: String(row.author),
      body: String(row.body),
      at: String(row.at),
    })
    if (row.unseen) thread.unread += 1
    thread.answered = String(row.author) !== 'model'
    thread.last_at = String(row.at)
    threads.set(key, thread)
  }

  // Hers-still-waiting first, then by freshest word either way.
  const list = [...threads.values()].sort((a, b) =>
    Number(a.answered) - Number(b.answered) || b.last_at.localeCompare(a.last_at))
  return NextResponse.json({ threads: list })
}
