import { NextResponse } from 'next/server'
import { isSignedIn } from '@/lib/auth'
import { sql } from '@/lib/db'
import { isDateString } from '@/lib/dates'
import { alsoOn } from '@/lib/match'
import { keysForPlan, trashKeys } from '@/lib/models'
import { preview } from '@/lib/sql'

type Params = { params: Promise<{ id: string }> }

const unauthorized = () => NextResponse.json({ error: 'unauthorized' }, { status: 401 })
const notFound = () => NextResponse.json({ error: 'not found' }, { status: 404 })
const MAX_TEXT = 4000

/** One plan, as the editor needs it: the week, the model, and every item with
 *  enough of its library row attached to be recognisable at a glance. */
export async function GET(_request: Request, { params }: Params) {
  if (!(await isSignedIn())) return unauthorized()
  const { id } = await params

  const [plan] = await sql.query(
    `select p.id, p.model_id, to_char(p.week_of, 'YYYY-MM-DD') as week_of,
            to_char(p.due_date, 'YYYY-MM-DD') as due_date,
            p.title, p.intro, p.status, p.sent_at, p.target,
            m.name as model_name, m.access_token, m.token_revoked_at,
            m.weekly_target, m.timezone, m.filming_days, m.standing_rules,
            m.wont_do, m.plan_template,
            p.telegram_state, p.telegram_variant, p.telegram_done_at, p.telegram_error,
            m.telegram_chat_id, g.title as telegram_title, g.skip_campaigns as telegram_skips
       from transcriber.plans p
       join transcriber.models m on m.id = p.model_id
       left join transcriber.telegram_groups g on g.chat_id = m.telegram_chat_id
      where p.id = $1`,
    [id],
  )
  if (!plan) return notFound()

  const items = await sql.query(
    `select i.id, i.job_id, i.position, i.notes, i.editing_notes, i.editor_id,
            i.wardrobe, i.camera, i.takes, i.sound, i.hook, i.caption,
            -- t.title below is the reference's own title on Instagram, so the
            -- card's own name has to arrive under a different one.
            i.card_no, i.title as item_title, i.location, i.bucket, i.source_post, i.repurposed_at, i.rating, i.made_at, i.made_url,
            i.source, i.twist,
            i.filmed_at, i.posted_at, i.post_url,
            i.model_note, i.model_note_at, i.seen_at,
            i.accepted_at, i.declined_at, i.decline_reason, i.decline_code,
            i.r2_key, i.r2_bytes, i.uploaded_at, i.r2_purged_at,
            t.author, t.title, t.webpage_url, t.duration_sec, t.folder,
            -- A card pasted a minute ago has no transcript row yet; the job's
            -- own status is what tells "still downloading" from "no video".
            j.status as job_status,
            (t.thumbnail is not null) as has_thumb,
            ${preview('t.plain', 160, 't.on_screen_text')} as preview,
            -- Who else is carrying this same reel. The editor flags it rather
            -- than refusing it: two creators on one trend is sometimes the
            -- point, and it is only a mistake when nobody knew.
            ${alsoOn('i.job_id', 'pl.model_id')} as also_on,
            coalesce(m.messages, '[]'::json) as messages,
            coalesce(m.unread, 0)::int as unread
       from transcriber.plan_items i
       join transcriber.plans pl on pl.id = i.plan_id
       left join transcriber.transcripts t on t.job_id = i.job_id
       left join transcriber.jobs j on j.id = i.job_id
       left join lateral (
         select json_agg(json_build_object(
                  'id',     n.id,
                  'author', n.author,
                  'body',   n.body,
                  'at',     to_char(n.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
                  'seen',   n.seen_at is not null
                ) order by n.created_at) as messages,
                -- Unread here is the mirror of her side: what she has said
                -- that Geno has not read.
                count(*) filter (where n.author = 'model' and n.seen_at is null) as unread
           from transcriber.plan_messages n
          where n.item_id = i.id
       ) m on true
      where i.plan_id = $1
      order by i.position, i.created_at`,
    [id],
  )

  return NextResponse.json({ plan, items })
}

/** Title, intro, due date, and the one switch that makes the link live. */
export async function PUT(request: Request, { params }: Params) {
  if (!(await isSignedIn())) return unauthorized()
  const { id } = await params
  const body = await request.json().catch(() => ({}))

  const text = (value: unknown) =>
    typeof value === 'string' && value.trim() ? value.trim().slice(0, MAX_TEXT) : null
  const status = body.status === 'sent' ? 'sent' : body.status === 'draft' ? 'draft' : null

  // How many reels this week wants. 0 or blank clears it back to the model's
  // weekly target; anything else lands clamped to something a human meant.
  const target = typeof body.target === 'number' && Number.isFinite(body.target)
    ? Math.max(0, Math.min(200, Math.round(body.target))) || null
    : null

  const [plan] = await sql.query(
    `update transcriber.plans
        set title    = case when $2::bool then $3::text else title end,
            intro    = case when $4::bool then $5::text else intro end,
            due_date = case when $6::bool then $7::date else due_date end,
            target   = case when $9::bool then $10::int else target end,
            status   = coalesce($8::text, status),
            -- Stamped the first time it is sent and kept thereafter, so a later
            -- edit does not rewrite when she was actually given the week.
            sent_at  = case when $8::text = 'sent' then coalesce(sent_at, now())
                            when $8::text = 'draft' then null
                            else sent_at end,
            updated_at = now()
      where id = $1
      returning id, to_char(week_of, 'YYYY-MM-DD') as week_of,
                to_char(due_date, 'YYYY-MM-DD') as due_date,
                title, intro, status, sent_at, target`,
    [
      id,
      'title' in body, text(body.title),
      'intro' in body, text(body.intro),
      'due_date' in body, isDateString(body.due_date) ? body.due_date : null,
      status,
      'target' in body, target,
    ],
  )
  if (!plan) return notFound()

  const telegram = await telegramFor(id, status, body)
  if ('error' in telegram) {
    // The week is sent either way — the link works — but the bot was not
    // asked. Said, so Geno can link her group or send it himself.
    return NextResponse.json({ plan: { ...plan, ...telegram.state }, warning: telegram.error })
  }
  return NextResponse.json({ plan: { ...plan, ...telegram.state } })
}

const VARIANTS = new Set(['weekly', 'weekend', 'short'])
type TelegramState = Record<string, unknown>

/**
 * What sending means on Telegram (2026-09-26, Geno's call):
 *   telegram: 'post'    queue it — the Gosian bot posts it in her MARKETING topic
 *   telegram: 'manual'  he sent it himself — the bot only records it as sent
 * Unsending cancels anything the bot has not done yet; a post already made
 * stays on the record, because it is still in her group.
 */
async function telegramFor(
  planId: string,
  status: string | null,
  body: Record<string, unknown>,
): Promise<{ state: TelegramState } | { state: TelegramState; error: string }> {
  if (status === 'draft') {
    const [row] = await sql.query(
      `update transcriber.plans
          set telegram_state = case when telegram_state in ('queued', 'manual', 'failed')
                                    then null else telegram_state end
        where id = $1
        returning telegram_state, telegram_variant, telegram_done_at, telegram_error`,
      [planId],
    )
    return { state: row ?? {} }
  }
  if (status !== 'sent' || (body.telegram !== 'post' && body.telegram !== 'manual')) return { state: {} }

  const variant = typeof body.variant === 'string' && VARIANTS.has(body.variant) ? body.variant : 'weekly'
  const [linked] = await sql.query(
    `select m.telegram_chat_id, g.chat_id as group_id, g.skip_campaigns
       from transcriber.plans p
       join transcriber.models m on m.id = p.model_id
       left join transcriber.telegram_groups g on g.chat_id = m.telegram_chat_id
      where p.id = $1`,
    [planId],
  )
  const why = !linked?.telegram_chat_id
    ? body.telegram === 'post'
      ? 'Sent, but they have no Telegram group linked — link one in their Week tab, or send it yourself.'
      : 'Marked sent. They have no Telegram group linked, so the bot\'s daily report will not count it.'
    : !linked.group_id
      ? 'Sent, but their Telegram group is no longer on the bot. Link another, or send it yourself.'
      : body.telegram === 'post' && linked.skip_campaigns
        ? 'Sent, but their group is switched off for marketing on the bot, so nothing was posted.'
        : null
  const [row] = await sql.query(
    `update transcriber.plans
        set telegram_state = $2, telegram_variant = $3, telegram_queued_at = now(),
            telegram_done_at = null, telegram_error = null
      where id = $1 and $4
      returning telegram_state, telegram_variant, telegram_done_at, telegram_error`,
    [planId, body.telegram === 'post' ? 'queued' : 'manual', variant, why === null],
  )
  return why ? { state: {}, error: why } : { state: row ?? {} }
}

/** Drop a whole week. Its R2 objects go on the Mac's deletion list first. */
export async function DELETE(_request: Request, { params }: Params) {
  if (!(await isSignedIn())) return unauthorized()
  const { id } = await params

  await trashKeys(await keysForPlan(id))
  await sql.query(`delete from transcriber.plans where id = $1`, [id])
  return NextResponse.json({ ok: true })
}
