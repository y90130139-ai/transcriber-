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
  messages: PlanMessage[]
  /** Answers from Geno she has not read yet — the count on her Ask button. */
  unread: number
  webpage_url: string | null
  duration_sec: number | null
  blocks: PlanBlock[]
  transcript: string
  media: PlanMedia | null
}

export type Plan = {
  id: string
  week_of: string
  due_date: string | null
  title: string | null
  intro: string | null
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
    `select id, name, photo_url, filming_days, timezone, weekly_target, standing_rules
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
            to_char(due_date, 'YYYY-MM-DD') as due_date, title, intro
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

/** Everything her page renders, for one token. */
export async function loadPlan(token: unknown): Promise<
  { model: PlanModel; plan: Plan; items: PlanItem[] } | null
> {
  const model = await modelForToken(token)
  if (!model) return null

  const plan = await currentPlanFor(model)
  if (!plan) return null

  // Joined through plan_id, which was itself resolved from the token's own
  // model. No id from the request touches this query.
  const rows = await sql.query(
    `select i.id as item_id, i.position, i.notes, i.editing_notes,
            i.wardrobe, i.camera, i.takes, i.sound, i.hook, i.caption,
            i.card_no, i.title, i.location,
            (i.filmed_at is not null) as filmed, i.model_note,
            i.accepted_at, i.declined_at, i.decline_reason,
            i.r2_key, i.uploaded_at,
            t.webpage_url, t.duration_sec, t.blocks,
            ${spoken('t.plain')} as transcript,
            coalesce(m.messages, '[]'::json) as messages,
            coalesce(m.unread, 0)::int as unread
       from transcriber.plan_items i
       left join transcriber.transcripts t on t.job_id = i.job_id
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
    [plan.id],
  )

  const items: PlanItem[] = rows.map((row) => ({
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
    messages: Array.isArray(row.messages) ? (row.messages as PlanMessage[]) : [],
    unread: Number(row.unread ?? 0),
    webpage_url: (row.webpage_url as string | null) ?? null,
    duration_sec: row.duration_sec === null ? null : Number(row.duration_sec),
    blocks: Array.isArray(row.blocks) ? (row.blocks as PlanBlock[]) : [],
    transcript: String(row.transcript ?? '').trim(),
    media: mediaFor(row),
  }))

  return { model, plan, items }
}

/** One item, proven to belong to this token's model before anything writes to
 *  it. Returns null on any mismatch, which the routes turn into a flat 404. */
export async function itemForToken(
  token: unknown,
  itemId: unknown,
): Promise<{ id: string; filmed: boolean } | null> {
  const model = await modelForToken(token)
  if (!model || typeof itemId !== 'string' || itemId.length === 0) return null

  const [item] = await sql.query(
    `select i.id, (i.filmed_at is not null) as filmed
       from transcriber.plan_items i
       join transcriber.plans p on p.id = i.plan_id
      where i.id = $1 and p.model_id = $2 and p.status = 'sent'`,
    [itemId, model.id],
  )
  return item ? { id: String(item.id), filmed: Boolean(item.filmed) } : null
}
