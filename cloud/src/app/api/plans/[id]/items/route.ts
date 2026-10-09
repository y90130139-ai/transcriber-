import { NextResponse } from 'next/server'
import { isSignedIn } from '@/lib/auth'
import { sql } from '@/lib/db'
import { appendItems, draftBothFor, isUntouchedDraft, newId, trashKeys, type SkipReason } from '@/lib/models'
import { isSource } from '@/lib/source'
import { isValidTag } from '@/lib/taxonomy'

type Params = { params: Promise<{ id: string }> }

const unauthorized = () => NextResponse.json({ error: 'unauthorized' }, { status: 401 })
const notFound = () => NextResponse.json({ error: 'not found' }, { status: 404 })
const MAX_TEXT = 4000
const MAX_BATCH = 60
/** The most copies one custom-card ask can lay — a week, not a wall. */
const MAX_COPIES = 30

/** `upload_date` on a transcript is a plain `YYYY-MM-DD` string and is allowed
 *  to be anything the platform returned, so it is checked before it is cast. */
const isPostedOn = (value: unknown): value is string =>
  typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)

async function modelFor(planId: string): Promise<string | null> {
  const [plan] = await sql.query(`select model_id from transcriber.plans where id = $1`, [planId])
  return plan ? String(plan.model_id) : null
}

/** The row a DELETE handed back, checked and ordered for the restore insert.
 *  The id has the same shape every id here has, the plan is the route's own,
 *  and every text field is clipped — the payload went through the browser. */
function restorable(row: Record<string, unknown>, planId: string): unknown[] | null {
  const id = typeof row.id === 'string' && /^[A-Za-z0-9_-]{6,32}$/.test(row.id) ? row.id : null
  if (!id || row.plan_id !== planId) return null
  const text = (value: unknown, max = MAX_TEXT) =>
    typeof value === 'string' && value ? value.slice(0, max) : null
  const stamp = (value: unknown) => (typeof value === 'string' && value ? value : null)
  const int = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : null)
  return [
    id, planId, text(row.job_id, 64), int(row.position) ?? 0,
    text(row.notes), text(row.editing_notes), text(row.title, 200), text(row.location, 200), int(row.card_no),
    text(row.bucket, 32), text(row.axis, 32), text(row.source_post, 64), text(row.source_url, 500),
    text(row.hold), int(row.slot_day), text(row.slot_time, 32),
    text(row.wardrobe), text(row.camera), text(row.takes), text(row.sound), text(row.hook), text(row.caption),
    text(row.brief_short), row.caption_options ? JSON.stringify(row.caption_options) : null,
    stamp(row.accepted_at), stamp(row.declined_at), text(row.decline_reason), text(row.decline_code, 32),
    row.rating === 1 || row.rating === -1 ? row.rating : null,
    stamp(row.made_at), text(row.made_url, 500), stamp(row.filmed_at), stamp(row.posted_at), text(row.post_url, 500),
    text(row.model_note), stamp(row.model_note_at), text(row.editor_id, 64),
    isSource(row.source) ? row.source : null, text(row.twist),
    stamp(row.created_at),
  ]
}

/** Put one or more library items on this plan, each with a drafted brief. */
export async function POST(request: Request, { params }: Params) {
  if (!(await isSignedIn())) return unauthorized()
  const { id } = await params

  const modelId = await modelFor(id)
  if (!modelId) return notFound()

  const body = await request.json().catch(() => ({}))

  // Undo (2026-10-08): put a just-removed card back, exactly as it was. The
  // DELETE below hands the whole row to the editor; this takes it back. The
  // thread is gone with the old row — undo covers a misclick, not history —
  // and the R2 fields stay empty so the Mac re-uploads the file cleanly.
  if (body.restore && typeof body.restore === 'object') {
    const back = restorable(body.restore as Record<string, unknown>, id)
    if (!back) return NextResponse.json({ error: 'nothing restorable in that' }, { status: 400 })
    const [row] = await sql.query(
      `insert into transcriber.plan_items
         (id, plan_id, job_id, position, notes, editing_notes, title, location, card_no,
          bucket, axis, source_post, source_url, hold, slot_day, slot_time,
          wardrobe, camera, takes, sound, hook, caption, brief_short, caption_options,
          accepted_at, declined_at, decline_reason, decline_code,
          rating, made_at, made_url, filmed_at, posted_at, post_url,
          model_note, model_note_at, editor_id, source, twist, created_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9,
               $10, $11, $12, $13, $14, $15, $16,
               $17, $18, $19, $20, $21, $22, $23, $24::jsonb,
               $25::timestamptz, $26::timestamptz, $27, $28,
               $29::smallint, $30::timestamptz, $31, $32::timestamptz, $33::timestamptz, $34,
               $35, $36::timestamptz, $37, $38, $39, coalesce($40::timestamptz, now()))
       on conflict do nothing
       returning id`,
      back,
    )
    if (!row) return NextResponse.json({ error: 'already back on the week' }, { status: 409 })
    return NextResponse.json({ restored: 1, item_id: String(row.id) })
  }

  // Duplicate a card (Geno, 2026-10-08): "duplicate it, change some words up,
  // keep going until you have your variations." The copy keeps everything a
  // variation wants — direction, title, source, twist, the brief — and gets
  // its own number. A library-backed card's copy drops the video and becomes
  // a written card (one card per reel stands; the original keeps the Watch
  // step); her own reels (source_post) are allowed to repeat, so those copy
  // whole. `count` lays several in one ask.
  if (typeof body.duplicate === 'string' && body.duplicate) {
    const copies = typeof body.count === 'number' && Number.isFinite(body.count)
      ? Math.max(1, Math.min(MAX_COPIES, Math.round(body.count)))
      : 1
    // Versions (Geno, 2026-10-08): same concept, different costume — the set
    // names itself. The original becomes Version 1 and each copy counts on,
    // so V-6..V-9 read as one idea in four outfits.
    const versions = body.versions === true
    const [base] = await sql.query(
      `select title, position from transcriber.plan_items where id = $1 and plan_id = $2`,
      [body.duplicate, id],
    )
    if (!base) return notFound()
    const stem = String(base.title ?? '').replace(/\s*·?\s*version\s*\d+\s*$/i, '').trim()
    const versionTitle = (n: number) => (stem ? `${stem} · Version ${n}` : `Version ${n}`)
    if (versions) {
      await sql.query(
        `update transcriber.plan_items set title = $3 where id = $1 and plan_id = $2`,
        [body.duplicate, id, versionTitle(1)],
      )
    }
    // Copies belong WITH their original, not at the foot of the week — open a
    // gap right behind it and lay them in order (Geno, 2026-10-08).
    const anchor = Number(base.position ?? 0)
    await sql.query(
      `update transcriber.plan_items set position = position + $3
        where plan_id = $1 and position > $2`,
      [id, anchor, copies],
    )
    const ids: string[] = []
    for (let copy = 0; copy < copies; copy += 1) {
      const [row] = await sql.query(
        `insert into transcriber.plan_items
           (id, plan_id, job_id, position, notes, editing_notes, title, location, card_no,
            bucket, axis, source_post, source_url, hold, slot_day, slot_time,
            wardrobe, camera, takes, sound, hook, caption, brief_short, source, twist)
         select $1, i.plan_id,
                case when i.source_post is not null then i.job_id else null end,
                $4::int,
                i.notes, i.editing_notes, i.title, i.location,
                (select coalesce(max(prior.card_no), 0) + 1
                   from transcriber.plan_items prior
                   join transcriber.plans pp on pp.id = prior.plan_id
                  where pp.model_id = pl.model_id),
                case when i.source_post is null and i.job_id is not null then 'custom' else i.bucket end,
                i.axis, i.source_post, i.source_url, i.hold, i.slot_day, i.slot_time,
                i.wardrobe, i.camera, i.takes, i.sound, i.hook, i.caption, i.brief_short,
                case when i.source_post is null and i.job_id is not null then 'original' else i.source end,
                i.twist
           from transcriber.plan_items i
           join transcriber.plans pl on pl.id = i.plan_id
          where i.id = $2 and i.plan_id = $3
         returning id`,
        [newId(), body.duplicate, id, anchor + 1 + copy],
      )
      if (!row) return ids.length > 0
        ? NextResponse.json({ added: ids.length, item_ids: ids })
        : notFound()
      ids.push(String(row.id))
      if (versions) {
        await sql.query(
          `update transcriber.plan_items set title = $3 where id = $1 and plan_id = $2`,
          [String(row.id), id, versionTitle(copy + 2)],
        )
      }
    }
    return NextResponse.json({ added: ids.length, item_ids: ids })
  }

  // A custom card (Geno, 2026-10-07): written by the team. Optional `job_id`
  // is only the cover / reference frame — her page still has no Watch step
  // (bucket stays custom). Solo / declined rules do not apply here; one card
  // per reel per week still does, via the unique index.
  // `cards: [{ label, job_id? }]` lands a whole pile in one ask so the
  // composer is not N round-trips for N ticks.
  if (body.custom && typeof body.custom === 'object') {
    const custom = body.custom as {
      label?: unknown; format?: unknown; body?: unknown; source?: unknown; count?: unknown
      job_id?: unknown; cards?: unknown
    }
    const format = typeof custom.format === 'string' && isValidTag('format', custom.format) ? custom.format : null
    const sharedBody = typeof custom.body === 'string' ? custom.body.trim().slice(0, 4000) : ''
    const sharedSource = isSource(custom.source) ? custom.source : null

    type CardAsk = { label: string; jobId: string | null; text: string }
    const asks: CardAsk[] = []
    if (Array.isArray(custom.cards)) {
      for (const raw of custom.cards.slice(0, MAX_BATCH)) {
        if (!raw || typeof raw !== 'object') continue
        const row = raw as { label?: unknown; job_id?: unknown; body?: unknown }
        const label = typeof row.label === 'string' ? row.label.trim().slice(0, 120) : ''
        if (!label) continue
        asks.push({
          label,
          jobId: typeof row.job_id === 'string' && row.job_id.trim() ? row.job_id.trim().slice(0, 64) : null,
          text: typeof row.body === 'string' ? row.body.trim().slice(0, 4000) : sharedBody,
        })
      }
    } else {
      const label = typeof custom.label === 'string' ? custom.label.trim().slice(0, 120) : ''
      if (!label) return NextResponse.json({ error: 'give the card a label' }, { status: 400 })
      const jobId = typeof custom.job_id === 'string' && custom.job_id.trim()
        ? custom.job_id.trim().slice(0, 64)
        : null
      const count = jobId
        ? 1
        : typeof custom.count === 'number' && Number.isFinite(custom.count)
          ? Math.max(1, Math.min(MAX_COPIES, Math.round(custom.count)))
          : 1
      for (let copy = 0; copy < count; copy += 1) {
        asks.push({ label, jobId, text: sharedBody })
      }
    }
    if (asks.length === 0) return NextResponse.json({ error: 'nothing to add' }, { status: 400 })

    const jobIds = asks.map((ask) => ask.jobId).filter((job): job is string => Boolean(job))
    const held = jobIds.length > 0
      ? await sql.query(
          `select job_id from transcriber.plan_items where plan_id = $1 and job_id = any($2::text[])`,
          [id, jobIds],
        )
      : []
    const already = new Set(held.map((row) => String(row.job_id)))
    const thumbs = jobIds.length > 0
      ? new Set(
          (await sql.query(
            `select job_id from transcriber.transcripts
              where job_id = any($1::text[]) and thumbnail is not null`,
            [jobIds],
          )).map((row) => String(row.job_id)),
        )
      : new Set<string>()

    const items: Record<string, unknown>[] = []
    const skipped: string[] = []
    const [positionRow, cardNoRow] = await Promise.all([
      sql.query(
        `select coalesce(max(position), -1) as last from transcriber.plan_items where plan_id = $1`,
        [id],
      ),
      sql.query(
        `select coalesce(max(i.card_no), 0) as last
           from transcriber.plan_items i
           join transcriber.plans p on p.id = i.plan_id
          where p.model_id = $1`,
        [modelId],
      ),
    ])
    let position = Number(positionRow[0]?.last ?? -1)
    let cardNo = Number(cardNoRow[0]?.last ?? 0)

    for (const ask of asks) {
      if (ask.jobId && already.has(ask.jobId)) {
        skipped.push(ask.jobId)
        continue
      }
      const text = ask.text
      const source = sharedSource ?? (text ? 'original' : 'blank')
      const notes = [format ? `Format: ${format}` : null, text || null].filter(Boolean).join('\n\n') || null
      position += 1
      cardNo += 1
      const itemId = newId()
      const [item] = await sql.query(
        `insert into transcriber.plan_items
           (id, plan_id, job_id, position, notes, title, bucket, source, card_no)
         values ($1, $2, $3, $4, $5, $6, 'custom', $7, $8)
         returning id, job_id, position, notes, title as item_title, bucket, source, card_no`,
        [itemId, id, ask.jobId, position, notes, ask.label, source, cardNo],
      )
      if (!item) continue
      if (ask.jobId) already.add(ask.jobId)
      items.push({
        ...item,
        has_thumb: ask.jobId ? thumbs.has(ask.jobId) : false,
        author: null,
        title: null,
        preview: null,
        messages: [],
        unread: 0,
        also_on: [],
      })
    }

    if (items.length === 0) {
      return NextResponse.json({
        error: skipped.length > 0 ? 'that video is already on this week' : 'the card did not land',
        added: 0,
        skipped,
      }, { status: skipped.length > 0 ? 409 : 500 })
    }
    return NextResponse.json({
      added: items.length,
      item_id: String(items[0].id),
      item_ids: items.map((item) => String(item.id)),
      items,
      skipped,
    })
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

  const skipped = new Map<string, SkipReason>()
  const added = await appendItems(id, modelId, jobIds, undefined, skipped)
  return NextResponse.json({ added, skipped: Object.fromEntries(skipped) })
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
            title         = case when $26::bool then $27::text else title end,
            -- The mixed-source tag and a reskin's twist (2026-10-08). The tag
            -- only ever lands validated; clearing it falls back to the bucket.
            source        = case when $29::bool then $30::text else source end,
            twist         = case when $31::bool then $32::text else twist end,
            -- The per-card switches (2026-10-08): filming directions and
            -- automated captions, each hideable before the week goes out.
            hide_film     = case when $33::bool then $34::bool else hide_film end,
            hide_captions = case when $35::bool then $36::bool else hide_captions end
      where id = $1 and plan_id = $2
      returning id, notes, editing_notes, post_url, posted_at, filmed_at, seen_at,
                wardrobe, camera, takes, sound, hook, caption,
                card_no, title as item_title, location, source, twist, hide_film, hide_captions`,
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
      'source' in body, isSource(body.source) ? body.source : null,
      'twist' in body, text(body.twist),
      'hide_film' in body, body.hide_film === true,
      'hide_captions' in body, body.hide_captions === true,
    ],
  )
  if (!item) return notFound()
  return NextResponse.json({ item })
}

/** Take one item off the plan. Its R2 object goes on the Mac's deletion list.
 *  The whole row comes back so the editor's Undo can hand it to `restore` —
 *  the thread does not survive (messages cascade), but the card does. */
export async function DELETE(request: Request, { params }: Params) {
  if (!(await isSignedIn())) return unauthorized()
  const { id } = await params
  const itemId = new URL(request.url).searchParams.get('item') ?? ''
  if (!itemId) return NextResponse.json({ error: 'item is required' }, { status: 400 })

  const [item] = await sql.query(
    `delete from transcriber.plan_items where id = $1 and plan_id = $2 returning *`,
    [itemId, id],
  )
  if (!item) return notFound()

  await trashKeys([item.r2_key as string | null])
  return NextResponse.json({ ok: true, removed: item })
}
