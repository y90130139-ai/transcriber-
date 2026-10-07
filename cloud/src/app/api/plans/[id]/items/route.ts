import { NextResponse } from 'next/server'
import { isSignedIn } from '@/lib/auth'
import { sql } from '@/lib/db'
import { appendItems, draftBothFor, isUntouchedDraft, newId, trashKeys } from '@/lib/models'
import { isValidTag } from '@/lib/taxonomy'

type Params = { params: Promise<{ id: string }> }

const unauthorized = () => NextResponse.json({ error: 'unauthorized' }, { status: 401 })
const notFound = () => NextResponse.json({ error: 'not found' }, { status: 404 })
const MAX_TEXT = 4000
const MAX_BATCH = 60

/** `upload_date` on a transcript is a plain `YYYY-MM-DD` string and is allowed
 *  to be anything the platform returned, so it is checked before it is cast. */
const isPostedOn = (value: unknown): value is string =>
  typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)

async function modelFor(planId: string): Promise<string | null> {
  const [plan] = await sql.query(`select model_id from transcriber.plans where id = $1`, [planId])
  return plan ? String(plan.model_id) : null
}

/** Put one or more library items on this plan, each with a drafted brief. */
export async function POST(request: Request, { params }: Params) {
  if (!(await isSignedIn())) return unauthorized()
  const { id } = await params

  const modelId = await modelFor(id)
  if (!modelId) return notFound()

  const body = await request.json().catch(() => ({}))

  // A custom card (Geno, 2026-10-07): no library video behind it — a blank
  // template the team labels, formats and writes themselves. It lands as a
  // normal card; her page simply has no "Watch it" step for it.
  if (body.custom && typeof body.custom === 'object') {
    const custom = body.custom as { label?: unknown; format?: unknown; body?: unknown }
    const label = typeof custom.label === 'string' ? custom.label.trim().slice(0, 120) : ''
    if (!label) return NextResponse.json({ error: 'give the card a label' }, { status: 400 })
    const format = typeof custom.format === 'string' && isValidTag('format', custom.format) ? custom.format : null
    const text = typeof custom.body === 'string' ? custom.body.trim().slice(0, 4000) : ''
    const [item] = await sql.query(
      `insert into transcriber.plan_items (id, plan_id, job_id, position, notes, title, bucket, card_no)
       select $1, $2, null,
              coalesce(max(i.position), -1) + 1,
              $3, $4, 'custom',
              (select coalesce(max(prior.card_no), 0) + 1
                 from transcriber.plan_items prior
                 join transcriber.plans pp on pp.id = prior.plan_id
                where pp.model_id = $5)
         from transcriber.plan_items i where i.plan_id = $2
       returning id`,
      [newId(), id, [format ? `Format: ${format}` : null, text].filter(Boolean).join('\n\n') || null, label, modelId],
    )
    return NextResponse.json({ added: 1, item_id: String(item.id) })
  }

  const offered = Array.isArray(body.job_ids)
    ? body.job_ids
    : typeof body.job_id === 'string'
      ? [body.job_id]
      : []
  const jobIds = offered
    .filter((jobId: unknown): jobId is string => typeof jobId === 'string' && jobId.length > 0)
    .slice(0, MAX_BATCH)
  if (jobIds.length === 0) return NextResponse.json({ error: 'nothing to add' }, { status: 400 })

  return NextResponse.json({ added: await appendItems(id, modelId, jobIds) })
}

/**
 * Edit one item, or reorder the whole plan.
 *
 * `model_note` is deliberately not writable here. It is hers, and the console
 * can only mark it read.
 */
export async function PUT(request: Request, { params }: Params) {
  if (!(await isSignedIn())) return unauthorized()
  const { id } = await params
  const body = await request.json().catch(() => ({}))

  if (Array.isArray(body.order)) {
    const order = body.order.filter((item: unknown): item is string => typeof item === 'string')
    await sql.query(
      `update transcriber.plan_items i
          set position = moved.position
         from (select unnest($2::text[]) as id, generate_subscripts($2::text[], 1) - 1 as position) moved
        where i.id = moved.id and i.plan_id = $1`,
      [id, order],
    )
    return NextResponse.json({ ok: true })
  }

  const itemId = typeof body.id === 'string' ? body.id : ''
  if (!itemId) return NextResponse.json({ error: 'id is required' }, { status: 400 })

  // The answer. Until this existed she could ask a question on a card and there
  // was nowhere for a reply to go — the note box was one-way, and the console
  // could only mark it read. Posting a reply also marks her messages on that
  // item read, because answering something is reading it.
  // A Repurpose card's one switch: the refreshed file has gone back to her.
  if (typeof body.repurposed === 'boolean') {
    const [row] = await sql.query(
      `update transcriber.plan_items
          set repurposed_at = case when $3 then coalesce(repurposed_at, now()) end
        where id = $1 and plan_id = $2 and bucket = 'repurpose'
        returning id, repurposed_at`,
      [itemId, id, body.repurposed],
    )
    if (!row) return notFound()
    return NextResponse.json({ item: row })
  }

  if (typeof body.reply === 'string' && body.reply.trim()) {
    const [owned] = await sql.query(
      `select id from transcriber.plan_items where id = $1 and plan_id = $2`,
      [itemId, id],
    )
    if (!owned) return notFound()

    const [message] = await sql.query(
      `insert into transcriber.plan_messages (id, item_id, author, body)
       values ($1, $2, 'operator', $3)
       returning id, author, body,
                 to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as at,
                 false as seen`,
      [newId(), itemId, body.reply.trim().slice(0, MAX_TEXT)],
    )
    await sql.query(
      `update transcriber.plan_messages
          set seen_at = now()
        where item_id = $1 and author = 'model' and seen_at is null`,
      [itemId],
    )
    await sql.query(
      `update transcriber.plan_items set seen_at = now() where id = $1 and seen_at is null`,
      [itemId],
    )
    return NextResponse.json({ ok: true, message })
  }

  const text = (value: unknown) =>
    typeof value === 'string' && value.trim() ? value.trim().slice(0, MAX_TEXT) : null

  // Phase 3. Fill the structured fields this item does not have yet, from the
  // same rules that draft them on assignment. Only ever writes into a null —
  // anything already typed here, by hand or by an earlier draft, is left where
  // it is, so the button is safe to press twice.
  if (body.draft === true) {
    const [owned] = await sql.query(
      `select i.id, p.model_id, i.job_id, i.notes
         from transcriber.plan_items i
         join transcriber.plans p on p.id = i.plan_id
        where i.id = $1 and i.plan_id = $2`,
      [itemId, id],
    )
    if (!owned) return notFound()

    const { blob, fields, location, title, standingRules, priorBlob, priorDirection } =
      await draftBothFor(String(owned.job_id), String(owned.model_id))

    // The direction is only rewritten when it is still the machine's own
    // untouched output — in which case the current version says the same thing
    // without repeating the four facts that have become fields, or her standing
    // rules that the ALWAYS block is already carrying. One character of Geno's
    // in there and it is left exactly as it is.
    const replaceNotes = isUntouchedDraft(owned.notes as string | null, {
      blob,
      direction: fields.direction,
      standingRules,
      // A card drafted before the screen could be quoted is still the drafter's
      // own, and must stay replaceable rather than being read as Geno's.
      priorBlob,
      priorDirection,
    })

    const [drafted] = await sql.query(
      `update transcriber.plan_items
          set wardrobe = coalesce(wardrobe, $3),
              camera   = coalesce(camera,   $4),
              takes    = coalesce(takes,    $5),
              sound    = coalesce(sound,    $6),
              hook     = coalesce(hook,     $7),
              caption  = coalesce(caption,  $8),
              notes    = case when $9::bool then $10::text else notes end,
              -- Phase 4, same contract: a location or a title that is already
              -- there is never replaced by a guess.
              location = coalesce(location, $11),
              title    = coalesce(title,    $12)
        where id = $1 and plan_id = $2
        returning id, notes, wardrobe, camera, takes, sound, hook, caption,
                  card_no, title as item_title, location`,
      [
        itemId, id,
        fields.wardrobe, fields.camera, fields.takes,
        fields.sound, fields.hook, fields.caption,
        replaceNotes, fields.direction,
        location, title,
      ],
    )
    if (!drafted) return notFound()
    return NextResponse.json({ item: drafted })
  }

  const [item] = await sql.query(
    `update transcriber.plan_items
        set notes         = case when $3::bool then $4::text else notes end,
            editing_notes = case when $5::bool then $6::text else editing_notes end,
            post_url      = case when $7::bool then $8::text else post_url end,
            -- Phase 5. When a post is bound from her strip it carries the day
            -- it actually went up, which is almost never today. Falls back to
            -- whatever was already stamped, then to now.
            posted_at     = case when $7::bool and $8::text is not null
                                   then coalesce($28::date::timestamptz, posted_at, now())
                                 when $7::bool then null else posted_at end,
            filmed_at     = case when $9::bool then (case when $10::bool then now() else null end)
                                 else filmed_at end,
            seen_at       = case when $11::bool then now() else seen_at end,
            -- Phase 3. Each one only written when the key is actually in the
            -- body, so a patch that touches the direction never blanks the
            -- caption beside it.
            wardrobe      = case when $12::bool then $13::text else wardrobe end,
            camera        = case when $14::bool then $15::text else camera end,
            takes         = case when $16::bool then $17::text else takes end,
            sound         = case when $18::bool then $19::text else sound end,
            hook          = case when $20::bool then $21::text else hook end,
            caption       = case when $22::bool then $23::text else caption end,
            -- Phase 4. card_no is deliberately not writable from anywhere:
            -- an id you can edit is not a stable id.
            location      = case when $24::bool then $25::text else location end,
            title         = case when $26::bool then $27::text else title end
      where id = $1 and plan_id = $2
      returning id, notes, editing_notes, post_url, posted_at, filmed_at, seen_at,
                wardrobe, camera, takes, sound, hook, caption,
                card_no, title as item_title, location`,
    [
      itemId, id,
      'notes' in body, text(body.notes),
      'editing_notes' in body, text(body.editing_notes),
      'post_url' in body, text(body.post_url),
      'filmed' in body, body.filmed === true,
      body.seen === true,
      'wardrobe' in body, text(body.wardrobe),
      'camera' in body, text(body.camera),
      'takes' in body, text(body.takes),
      'sound' in body, text(body.sound),
      'hook' in body, text(body.hook),
      'caption' in body, text(body.caption),
      'location' in body, text(body.location),
      'item_title' in body, text(body.item_title),
      isPostedOn(body.posted_on) ? body.posted_on : null,
    ],
  )
  if (!item) return notFound()
  return NextResponse.json({ item })
}

/** Take one item off the plan. Its R2 object goes on the Mac's deletion list. */
export async function DELETE(request: Request, { params }: Params) {
  if (!(await isSignedIn())) return unauthorized()
  const { id } = await params
  const itemId = new URL(request.url).searchParams.get('item') ?? ''
  if (!itemId) return NextResponse.json({ error: 'item is required' }, { status: 400 })

  const [item] = await sql.query(
    `delete from transcriber.plan_items where id = $1 and plan_id = $2 returning r2_key`,
    [itemId, id],
  )
  if (!item) return notFound()

  await trashKeys([item.r2_key as string | null])
  return NextResponse.json({ ok: true })
}
