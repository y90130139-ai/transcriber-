import { headlineFor, SIGNALS_COLUMNS, SIGNALS_JOIN, signalsFrom } from './appeal'
import { sql } from './db'
import { currentWeekOf } from './dates'
import { planMediaFor, r2Config, type PlanMedia } from './r2'
import { spoken } from './sql'

/**
 * ISOLATION BOUNDARY.
 *
 * Every read that a model's phone can trigger goes through this file and
 * nowhere else. Each query is filtered by the token's own model at the database
 * layer: there is no endpoint that takes a model id from the request, and no
 * query here can widen to a second model under any parameter.
 *
 * `models.notes` is internal and is never selected — not even as unrendered
 * payload in a server component's flight data.
 */

/** How far either side of this week a sent plan can still be the one she sees.
 *  A plan sent on Friday for next week must open to something on Saturday. */
const LOOK_AHEAD_DAYS = 7
const LOOK_BEHIND_DAYS = 14

export type PlanModel = {
  id: string
  name: string
  photo_url: string | null
  filming_days: number[]
  timezone: string
  weekly_target: number
  standing_rules: string | null
  /** Where the footage goes. Hers to see, unlike `notes` — this is the one
   *  thing the plan never told her and the one thing she cannot guess. */
  drive_url: string | null
  delivery_note: string | null
}

export type PlanBlock = { speaker: string | null; start: number; text: string }

/** One turn in the conversation about a single card. `author` says which side
 *  wrote it; `seen` is always whether the *other* side has read it. */
export type PlanMessage = {
  id: string
  author: 'model' | 'operator'
  body: string
  at: string
  seen: boolean
}

/** Untouched, taken on, or turned down. Three states, not a boolean — "she has
 *  not answered yet" is not the same statement as "she said no". */
export type Verdict = 'open' | 'accepted' | 'declined'

export type PlanItem = {
  /** Why this reel, in her language — "Blowing up · 1.2M views · trending
   *  sound". Null when the sweep has nothing true to say about it. */
  headline: string | null
  id: string
  position: number
  /** Phase 4. Assigned once per model and never reassigned, so a conversation
   *  about "V-7" survives the week being reordered. Null only on a row written
   *  before phase 4 that the backfill has somehow not reached. */
  card_no: number | null
  /** What the card is called, and where it gets filmed. Both nullable. */
  title: string | null
  location: string | null
  notes: string | null
  editing_notes: string | null
  /** Phase 3. The same brief as discrete facts. Any of them null falls the card
   *  back to `notes`, which is all anything written before phase 3 has. */
  wardrobe: string | null
  camera: string | null
  takes: string | null
  sound: string | null
  hook: string | null
  caption: string | null
  filmed: boolean
  /** Kept as it was. The thread supersedes it, but nothing that read it broke. */
  model_note: string | null
  verdict: Verdict
  decline_reason: string | null
  /** The countable half of a decline — see lib/decline.ts. Null on every row
   *  written before it existed, and on anything she declined without picking
   *  one, which stays allowed. */
  decline_code: string | null
  messages: PlanMessage[]
  /** Answers from Geno she has not read yet — the count on her Ask button. */
  unread: number
  webpage_url: string | null
  duration_sec: number | null
  blocks: PlanBlock[]
  transcript: string
  media: PlanMedia | null
  /** The 70/20/10 card: which bucket, the one variable under test, what must
   *  not move, and when it goes out. All null on cards drafted before the split
   *  existed, which render exactly as they always did. */
  bucket: 'reskin' | 'iteration' | 'test' | null
  axis: string | null
  hold: string | null
  slot_day: number | null
  slot_time: string | null
  /** The reference's own tags, which decide the expression line and the shot
   *  scaffold she now sees. */
  formats: string[]
  hooks: string[]
  on_screen_captions: { t?: number | null; text?: string | null }[] | null
  /** T6: the DM-ready version of this card, when one has been written. */
  brief_short: string | null
  /** The caption engine's options, when written. */
  caption_options: CaptionOption[] | null
}

/** One caption from the engine: which formula, the line, and the comment it
 *  is built to provoke — the manual's test for whether a caption baits at all. */
/** `formula` is a label: once the manual's formula name, now where the real
 *  caption came from. `from` is the library caption it was adapted from. */
export type CaptionOption = { formula: string; caption: string; baits: string; from?: string }

export type Plan = {
  id: string
  week_of: string
  due_date: string | null
  title: string | null
  intro: string | null
  /** When she first opened it, or null if she never has. "Sent" and "seen"
   *  used to be the same state, so a creator going quiet could not be told
   *  apart from one who never got the link — and those need opposite
   *  responses. */
  opened_at: string | null
}

/** Cheap shape check before the database is troubled at all. */
const isPlausibleToken = (token: unknown): token is string =>
  typeof token === 'string' && /^[A-Za-z0-9_-]{16,64}$/.test(token)

/**
 * Resolve a token to its model. Unknown, malformed and revoked tokens all come
 * back null, and callers turn every null into a 404 — a 403 would confirm that
 * something exists behind the URL.
 */
export async function modelForToken(token: unknown): Promise<PlanModel | null> {
  if (!isPlausibleToken(token)) return null
  const [model] = await sql.query(
    `select id, name, photo_url, filming_days, timezone, weekly_target, standing_rules,
            drive_url, delivery_note
       from transcriber.models
      where access_token = $1 and token_revoked_at is null`,
    [token],
  )
  return (model as PlanModel | undefined) ?? null
}

/** The plan she should be looking at right now: this week's if it has been
 *  sent, otherwise the nearest sent week either side. Drafts are invisible —
 *  that is the whole point of the draft status. */
async function currentPlanFor(model: PlanModel): Promise<Plan | null> {
  const thisWeek = currentWeekOf(model.timezone)
  const [plan] = await sql.query(
    `select id, to_char(week_of, 'YYYY-MM-DD') as week_of,
            to_char(due_date, 'YYYY-MM-DD') as due_date, title, intro,
            to_char(opened_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as opened_at
       from transcriber.plans
      where model_id = $1
        and status = 'sent'
        and week_of between $2::date - interval '${LOOK_BEHIND_DAYS} days'
                        and $2::date + interval '${LOOK_AHEAD_DAYS} days'
      order by abs(week_of - $2::date), week_of desc
      limit 1`,
    [model.id, thisWeek],
  )
  return (plan as Plan | undefined) ?? null
}

function mediaFor(row: Record<string, unknown>): PlanMedia | null {
  const config = r2Config()
  const key = row.r2_key as string | null
  if (!config || !key || !row.uploaded_at) return null
  const name = `${String(row.item_id).slice(0, 12)}.mp4`
  return planMediaFor(config, key, name)
}

/**
 * Every item on one plan, in the exact shape her page renders.
 *
 * **THIS FUNCTION AUTHORIZES NOTHING.** It takes a plan id and trusts it. It
 * was extracted from `loadPlan` so that the console's preview could render her
 * page from the same query rather than from a second one written to look like
 * it — a reconstruction drifts the moment either side gains a field, which is
 * the whole failure the preview exists to prevent.
 *
 * Two callers, and both establish access before they get here:
 *   - `loadPlan`, which resolved the plan from the token's own model.
 *   - `loadPlanPreview` in `preview.ts`, which is behind the console session.
 *
 * A third caller that has not done one of those things is a model-isolation
 * bug. Read the boundary note at the top of this file before adding one.
 */
export async function planItemsFor(planId: string): Promise<PlanItem[]> {
  // Filtered to the one plan id it was handed, and nothing else widens it.
  // Which model that plan belongs to was settled by the caller — see the note
  // above, and do not move an authorization check in here: the point of this
  // function is that it is the same query for both callers.
  const rows = await sql.query(
    `select i.id as item_id, i.position, i.notes, i.editing_notes,
            i.wardrobe, i.camera, i.takes, i.sound, i.hook, i.caption,
            i.card_no, i.title, i.location,
            (i.filmed_at is not null) as filmed, i.model_note,
            i.accepted_at, i.declined_at, i.decline_reason, i.decline_code,
            i.r2_key, i.uploaded_at,
            i.bucket, i.axis, i.hold, i.slot_day, i.slot_time,
            i.brief_short, i.caption_options,
            t.on_screen_captions,
            coalesce((select array_agg(g.tag) from transcriber.tags g
                       where g.job_id = i.job_id and g.axis = 'format'), '{}') as formats,
            coalesce((select array_agg(g.tag) from transcriber.tags g
                       where g.job_id = i.job_id and g.axis = 'hook'), '{}') as hooks,
            t.webpage_url, t.duration_sec, t.blocks,
            ${SIGNALS_COLUMNS},
            ${spoken('t.plain')} as transcript,
            coalesce(m.messages, '[]'::json) as messages,
            coalesce(m.unread, 0)::int as unread
       from transcriber.plan_items i
       left join transcriber.transcripts t on t.job_id = i.job_id
       ${SIGNALS_JOIN}
       left join lateral (
         select json_agg(json_build_object(
                  'id',     n.id,
                  'author', n.author,
                  'body',   n.body,
                  'at',     to_char(n.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
                  'seen',   n.seen_at is not null
                ) order by n.created_at) as messages,
                count(*) filter (where n.author = 'operator' and n.seen_at is null) as unread
           from transcriber.plan_messages n
          where n.item_id = i.id
       ) m on true
      where i.plan_id = $1
      order by i.position, i.created_at`,
    [planId],
  )

  const items: PlanItem[] = rows.map((row) => ({
    headline: headlineFor(signalsFrom(row)),
    id: String(row.item_id),
    position: Number(row.position ?? 0),
    card_no: row.card_no === null || row.card_no === undefined ? null : Number(row.card_no),
    title: (row.title as string | null) ?? null,
    location: (row.location as string | null) ?? null,
    notes: (row.notes as string | null) ?? null,
    editing_notes: (row.editing_notes as string | null) ?? null,
    wardrobe: (row.wardrobe as string | null) ?? null,
    camera: (row.camera as string | null) ?? null,
    takes: (row.takes as string | null) ?? null,
    sound: (row.sound as string | null) ?? null,
    hook: (row.hook as string | null) ?? null,
    caption: (row.caption as string | null) ?? null,
    filmed: Boolean(row.filmed),
    model_note: (row.model_note as string | null) ?? null,
    verdict: row.declined_at ? 'declined' : row.accepted_at ? 'accepted' : 'open',
    decline_reason: (row.decline_reason as string | null) ?? null,
    decline_code: (row.decline_code as string | null) ?? null,
    messages: Array.isArray(row.messages) ? (row.messages as PlanMessage[]) : [],
    unread: Number(row.unread ?? 0),
    webpage_url: (row.webpage_url as string | null) ?? null,
    duration_sec: row.duration_sec === null ? null : Number(row.duration_sec),
    blocks: Array.isArray(row.blocks) ? (row.blocks as PlanBlock[]) : [],
    transcript: String(row.transcript ?? '').trim(),
    media: mediaFor(row),
    bucket: isBucket(row.bucket) ? row.bucket : null,
    axis: (row.axis as string | null) ?? null,
    hold: (row.hold as string | null) ?? null,
    slot_day: row.slot_day === null || row.slot_day === undefined ? null : Number(row.slot_day),
    slot_time: (row.slot_time as string | null) ?? null,
    formats: Array.isArray(row.formats) ? (row.formats as string[]) : [],
    hooks: Array.isArray(row.hooks) ? (row.hooks as string[]) : [],
    on_screen_captions: Array.isArray(row.on_screen_captions)
      ? (row.on_screen_captions as PlanItem['on_screen_captions'])
      : null,
    brief_short: (row.brief_short as string | null) ?? null,
    caption_options: Array.isArray(row.caption_options)
      ? (row.caption_options as CaptionOption[])
      : null,
  }))

  return items
}

function isBucket(value: unknown): value is 'reskin' | 'iteration' | 'test' {
  return value === 'reskin' || value === 'iteration' || value === 'test'
}

/** Everything her page renders, for one token. */
export async function loadPlan(token: unknown): Promise<
  { model: PlanModel; plan: Plan; items: PlanItem[] } | null
> {
  const model = await modelForToken(token)
  if (!model) return null

  const plan = await currentPlanFor(model)
  if (!plan) return null

  const items = await planItemsFor(plan.id)

  return { model, plan, items }
}

/**
 * Stamp the first time she opened this week.
 *
 * Written once and never moved: the question it answers is "did the link ever
 * reach her", not "when was she last here". Guarded on null so it is idempotent
 * and so a reload never rewrites it.
 *
 * Called from the page route rather than from a client effect. A client effect
 * misses anyone with JS blocked, double-fires in development, and would make
 * the one signal that distinguishes "never opened" from "opened and ignored"
 * depend on the least reliable part of the stack.
 */
export async function markOpened(planId: string): Promise<void> {
  await sql.query(
    `update transcriber.plans set opened_at = now() where id = $1 and opened_at is null`,
    [planId],
  )
}

/** One item, proven to belong to this token's model before anything writes to
 *  it. Returns null on any mismatch, which the routes turn into a flat 404. */
export async function itemForToken(
  token: unknown,
  itemId: unknown,
): Promise<{
  id: string; filmed: boolean; planId: string; modelId: string
  verdict: 'accepted' | 'declined' | 'open'
} | null> {
  const model = await modelForToken(token)
  if (!model || typeof itemId !== 'string' || itemId.length === 0) return null

  const [item] = await sql.query(
    `select i.id, i.plan_id, (i.filmed_at is not null) as filmed,
            case when i.declined_at is not null then 'declined'
                 when i.accepted_at is not null then 'accepted' else 'open' end as verdict
       from transcriber.plan_items i
       join transcriber.plans p on p.id = i.plan_id
      where i.id = $1 and p.model_id = $2 and p.status = 'sent'`,
    [itemId, model.id],
  )
  return item
    ? {
        id: String(item.id), filmed: Boolean(item.filmed), planId: String(item.plan_id), modelId: model.id,
        verdict: item.verdict as 'accepted' | 'declined' | 'open',
      }
    : null
}
