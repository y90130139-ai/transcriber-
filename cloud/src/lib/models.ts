/** The console side of the model portal: validation, tokens, and the brief. */
import { nanoid } from 'nanoid'
import { firstLineOf } from './autotag'
import {
  ANY_FORMAT, OVERRIDE_FIELDS, draftBrief, draftFields, draftLocation, draftTitle,
  legacyFieldsDirection, overrideKey,
  type BriefFields, type BriefInput, type BriefOverrides, type OverrideField,
} from './brief'
import type { OnScreenCaption } from './autotag'
import { isCreatorType, type CreatorType } from './creator-type'
import { sql } from './db'
import { DECLINE_COOLDOWN_DAYS, PERMANENT_DECLINES } from './decline'
import { isDateString, mondayOf } from './dates'
import { readSocials, type Social } from './socials'
import { isValidTag, labelOf } from './taxonomy'
import { isKnownPlace } from './timezones'
import { jobsNeedingOthers } from './solo'

/** Long enough that guessing is not a strategy, short enough to paste. */
const TOKEN_LENGTH = 32
const MAX_NAME = 120
const MAX_TEXT = 4000
const MAX_WEEKLY_TARGET = 200
/** Long enough for "Drive folder, or the Telegram channel if it will not
 *  open", short enough that it never becomes a second brief. */
const MAX_DELIVERY_NOTE = 600

export { CREATOR_TYPES, isCreatorType, type CreatorType } from './creator-type'


/** Every column of a model row the console is allowed to see. `notes` and
 *  `access_token` are in here on purpose — this is the operator's own view. */
export const MODEL_COLUMNS = `
  id, name, handle, photo_url, persona, formats, hooks, wont_do,
  status, tier, filming_days, weekly_target, timezone, place, standing_rules, notes,
  drive_url, delivery_note, ig_account_type, creator_type, socials, telegram_chat_id,
  access_token, token_revoked_at, created_at
`

/** The same list qualified to a `transcriber.models m` alias. */
export const MODEL_COLUMNS_ALIASED = MODEL_COLUMNS.replace(/(\w+)/g, 'm.$1')

export const newId = () => nanoid(12)
export const newToken = () => nanoid(TOKEN_LENGTH)

export type ModelInput = {
  name: string
  handle: string | null
  photo_url: string | null
  persona: string[]
  formats: string[]
  hooks: string[]
  wont_do: string[]
  status: 'active' | 'paused'
  /** A bespoke · B mixed · C library-only. Stated, not derived. */
  tier: 'A' | 'B' | 'C'
  filming_days: number[]
  weekly_target: number
  timezone: string
  /** The label she was picked as — see lib/timezones.ts. Null before the
   *  column existed, or for a zone set by hand. */
  place: string | null
  standing_rules: string | null
  notes: string | null
  /** Where she sends the footage. The folder she already has access to, and a
   *  line naming the alternative. Both nullable — neither is required to send
   *  a plan, and a model with neither renders no delivery block at all. */
  drive_url: string | null
  delivery_note: string | null
  /** Whether Instagram will ever hand us her numbers. Only a professional
   *  (Business or Creator) account can authorise Insights, so this is the
   *  gate on views, saves and watch time for her — asked at intake, and
   *  `unknown` until somebody has actually checked rather than assumed. */
  ig_account_type: 'unknown' | 'personal' | 'professional'
  creator_type: CreatorType
  /** Every account of hers worth opening. Ordered — the order is the order the
   *  buttons render in, and it is stated rather than sorted. */
  socials: Social[]
}

const text = (value: unknown, limit: number): string | null => {
  if (typeof value !== 'string') return null
  const clean = value.trim().slice(0, limit)
  return clean.length > 0 ? clean : null
}

/** A link that a phone can actually open. Anything that is not http(s) is
 *  dropped to null rather than stored — a `javascript:` or a bare `drive.com`
 *  typed into the box would render on her page as a dead or hostile tap
 *  target, and she has no way to tell which. */
const httpUrl = (value: unknown, limit: number): string | null => {
  const raw = text(value, limit)
  if (!raw) return null
  try {
    const parsed = new URL(raw)
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? raw : null
  } catch {
    return null
  }
}

/** Everything a create or an edit is allowed to set. Anything else in the body
 *  is ignored rather than trusted — the token in particular is never client-set. */
export function readModelInput(body: Record<string, unknown>): ModelInput | { error: string } {
  const name = text(body.name, MAX_NAME)
  if (!name) return { error: 'a name is required' }

  // No cap on any axis. The autotagger limits its guesses about a single video;
  // what a model does is a human statement and is as long as it needs to be.
  const axis = (value: unknown, which: 'persona' | 'format' | 'hook'): string[] =>
    [...new Set(
      Array.isArray(value) ? value.filter((tag): tag is string => typeof tag === 'string') : [],
    )].filter((tag) => isValidTag(which, tag))

  const persona = axis(body.persona, 'persona')
  const formats = axis(body.formats, 'format')
  const hooks = axis(body.hooks, 'hook')
  // A format cannot be both something she does and something she will not do.
  const wontDo = axis(body.wont_do, 'format').filter((tag) => !formats.includes(tag))

  const filmingDays = [...new Set(
    Array.isArray(body.filming_days)
      ? body.filming_days.map(Number).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6)
      : [],
  )].sort()

  const target = Number(body.weekly_target)

  return {
    name,
    handle: text(body.handle, MAX_NAME)?.replace(/^@+/, '') ?? null,
    photo_url: text(body.photo_url, 2000),
    persona,
    formats,
    hooks,
    wont_do: wontDo,
    status: body.status === 'paused' ? 'paused' : 'active',
    tier: body.tier === 'A' || body.tier === 'C' ? body.tier : 'B',
    filming_days: filmingDays,
    weekly_target: Number.isFinite(target) ? Math.min(Math.max(Math.round(target), 0), MAX_WEEKLY_TARGET) : 21,
    timezone: text(body.timezone, 60) ?? 'America/New_York',
    // Only a label the picker actually offers is stored. Anything else is
    // dropped to null rather than kept, so a stale place can never disagree
    // with the zone that everything downstream reads.
    place: (() => {
      const label = text(body.place, 80)
      return label && isKnownPlace(label) ? label : null
    })(),
    standing_rules: text(body.standing_rules, MAX_TEXT),
    notes: text(body.notes, MAX_TEXT),
    drive_url: httpUrl(body.drive_url, 2000),
    delivery_note: text(body.delivery_note, MAX_DELIVERY_NOTE),
    ig_account_type:
      body.ig_account_type === 'professional' || body.ig_account_type === 'personal'
        ? body.ig_account_type
        : 'unknown',
    creator_type: isCreatorType(body.creator_type) ? body.creator_type : 'unknown',
    // Rows that will not parse are dropped rather than stored, the same way a
    // non-http Drive URL is: a button that opens nothing is worse on a phone
    // than no button, because there is no way to tell the two apart until it
    // has already cost a tap.
    socials: readSocials(body.socials),
  }
}

/** A week identifier is always the Monday, whatever day was offered. */
export function readWeekOf(value: unknown, fallback: string): string {
  return isDateString(value) ? mondayOf(value) : fallback
}

/**
 * The auto-drafted direction for one library item on one model's plan.
 *
 * Reads what the library already holds — the format and hook tags, the opening
 * line of the transcript, how long it ran, how many voices were in it — plus
 * the model's own standing rules, and hands the rest to `draftBrief`.
 */
export async function draftNotesFor(jobId: string, modelId: string): Promise<string> {
  return draftBrief(await briefInputFor(jobId, modelId))
}

/**
 * The same draft, as discrete fields rather than as one paragraph.
 *
 * Phase 3. `draftNotesFor` above still exists and still returns the whole prose
 * blob — every item written before this is holding one, and it stays the
 * fallback for anything these fields leave empty.
 */
export async function draftFieldsFor(jobId: string, modelId: string): Promise<BriefFields> {
  return draftFields(await briefInputFor(jobId, modelId))
}

/**
 * Both drafts for one item: the prose blob as it has always been written, and
 * the same facts as fields.
 *
 * Returned together because the phase-3 draft has to be able to tell whether
 * the direction currently stored is still the machine's own untouched output.
 * If it is, replacing it with the shorter version loses nothing and stops the
 * card saying "Sound: …" twice. If Geno has touched a single character of it,
 * it is his and it stays.
 */
export async function draftBothFor(
  jobId: string,
  modelId: string,
): Promise<{
  blob: string
  fields: BriefFields
  location: string | null
  title: string | null
  /** Carried out so `isUntouchedDraft` can rebuild the field-form direction as
   *  it was written before the standing-rules line was dropped from it. */
  standingRules: string | null
  /** The same two drafts as they read before the reference's screen could be
   *  quoted. See `isUntouchedDraft`. */
  priorBlob: string
  priorDirection: string
}> {
  const input = await briefInputFor(jobId, modelId)
  // Phase 7 gave the drafter a fourth source of opening text, so for the 67
  // references whose opening is on the frame rather than in the audio the
  // drafter no longer writes what it wrote last week. Every card drafted from
  // one of those is holding the older wording, and a draft the drafter cannot
  // recognise is a card it will never touch again. So it drafts both.
  const blind: BriefInput = { ...input, onScreenText: null, onScreenCaptions: null }
  return {
    blob: draftBrief(input),
    fields: draftFields(input),
    location: draftLocation(input.formats),
    title: draftTitle(input.formats, (tag) => labelOf('format', tag)),
    standingRules: input.standingRules,
    priorBlob: draftBrief(blind),
    priorDirection: draftFields(blind).direction,
  }
}

/**
 * Is this direction still exactly something the drafter wrote for it?
 *
 * Three forms count, because the drafter has written three over the life of
 * this file and all three are still sitting in the database:
 *
 *   - `blob` — the whole prose paragraph, which is the entire brief on
 *     anything written before phase 3.
 *   - `direction` — the field-form direction as it is written now.
 *   - the field-form direction as it was written between phase 3 and the audit
 *     build, with her standing rules appended. Dropping that line is the point
 *     of the change; recognising it is what lets the drafter clear it.
 *   - both of the first two as they read before phase 7, when a reference whose
 *     opening is stamped on the frame quoted nothing at all. `priorBlob` and
 *     `priorDirection` are those, drafted from the same item with the screen
 *     withheld — for anything the screen adds nothing to they are identical to
 *     the current pair and this costs a string comparison.
 *
 * Anything else is Geno's and stays exactly as it is. Whitespace is normalised
 * because drafts written before phase 3 joined their lines with a newline, and
 * the same sentences in the same order are the same draft.
 */
export function isUntouchedDraft(
  notes: string | null,
  drafts: {
    blob: string
    direction: string
    standingRules: string | null
    priorBlob?: string
    priorDirection?: string
  },
): boolean {
  if (!notes) return false
  const flat = (value: string) => value.replace(/\s+/g, ' ').trim()
  const mine = flat(notes)
  const directions = [drafts.direction, drafts.priorDirection].filter(
    (value): value is string => typeof value === 'string',
  )
  const written = [drafts.blob, drafts.priorBlob, ...directions].filter(
    (value): value is string => typeof value === 'string',
  )
  for (const form of written) if (mine === flat(form)) return true
  for (const direction of directions) {
    const legacy = legacyFieldsDirection(direction, drafts.standingRules)
    if (legacy !== null && mine === flat(legacy)) return true
  }
  return false
}

/** Her own standing answers for the brief's fields, if she has set any.
 *
 *  Read on every draft rather than cached: the set is at most a handful of rows
 *  per model, and a stale override is a card that says something she has
 *  already corrected. */
export async function overridesFor(modelId: string): Promise<BriefOverrides> {
  const rows = await sql.query(
    `select format, field, value from transcriber.model_brief_defaults where model_id = $1`,
    [modelId],
  )
  const held: BriefOverrides = {}
  for (const row of rows) {
    const field = String(row.field) as OverrideField
    if (!(OVERRIDE_FIELDS as readonly string[]).includes(field)) continue
    held[overrideKey(String(row.format), field)] = String(row.value)
  }
  return held
}

/** Everything a model's overrides can be set to, validated. Anything else in
 *  the body is dropped rather than stored. */
export function readOverrides(
  body: Record<string, unknown>,
  formats: string[],
): { format: string; field: OverrideField; value: string }[] {
  const offered = Array.isArray(body.defaults) ? body.defaults : []
  const allowed = new Set([ANY_FORMAT, ...formats])
  const clean: { format: string; field: OverrideField; value: string }[] = []
  const seen = new Set<string>()

  for (const row of offered) {
    if (typeof row !== 'object' || row === null) continue
    const entry = row as Record<string, unknown>
    const format = typeof entry.format === 'string' ? entry.format : ''
    const field = typeof entry.field === 'string' ? entry.field : ''
    const value = text(entry.value, MAX_TEXT)
    if (!allowed.has(format)) continue
    if (!(OVERRIDE_FIELDS as readonly string[]).includes(field)) continue
    // An empty value is how a row is removed, so it is dropped rather than
    // stored — the table holds only what she actually has an answer for.
    if (!value) continue
    const key = `${format}|${field}`
    if (seen.has(key)) continue
    seen.add(key)
    clean.push({ format, field: field as OverrideField, value })
  }
  return clean
}

/** What the library already knows about one reference, for one model. */
async function briefInputFor(jobId: string, modelId: string): Promise<BriefInput> {
  const [reference] = await sql.query(
    `select t.plain, t.blocks, t.duration_sec, t.speaker_count, t.word_count,
            t.on_screen_text, t.on_screen_captions
       from transcriber.transcripts t where t.job_id = $1`,
    [jobId],
  )
  const tags = await sql.query(
    `select axis, tag from transcriber.tags where job_id = $1 order by score desc nulls last`,
    [jobId],
  )
  const [model] = await sql.query(
    `select standing_rules from transcriber.models where id = $1`,
    [modelId],
  )

  return {
    formats: tags.filter((row) => row.axis === 'format').map((row) => String(row.tag)),
    hooks: tags.filter((row) => row.axis === 'hook').map((row) => String(row.tag)),
    firstLine: reference ? firstLineOf(reference.blocks, String(reference.plain ?? '')) : null,
    onScreenText: (reference?.on_screen_text as string | null) ?? null,
    onScreenCaptions: (reference?.on_screen_captions as OnScreenCaption[] | null) ?? null,
    durationSec: reference?.duration_sec === null || reference?.duration_sec === undefined
      ? null : Number(reference.duration_sec),
    speakerCount: reference?.speaker_count === null || reference?.speaker_count === undefined
      ? null : Number(reference.speaker_count),
    wordCount: reference?.word_count === null || reference?.word_count === undefined
      ? null : Number(reference.word_count),
    standingRules: (model?.standing_rules as string | null) ?? null,
    overrides: await overridesFor(modelId),
  }
}

/**
 * Hand R2 object keys to the Mac for deletion.
 *
 * Deleting a plan removes its rows immediately, but only the Mac holds R2
 * credentials that can reclaim the bytes. Without this list those objects would
 * sit in the bucket forever, and retention is the entire reason this stays
 * inside the free tier.
 */
export async function trashKeys(keys: (string | null)[]): Promise<void> {
  const real = keys.filter((key): key is string => typeof key === 'string' && key.length > 0)
  if (real.length === 0) return
  await sql.query(
    `insert into transcriber.r2_trash (key)
     select unnest($1::text[]) on conflict (key) do nothing`,
    [real],
  )
}

/** The keys currently attached to a plan, read before the rows go away. */
export async function keysForPlan(planId: string): Promise<string[]> {
  const rows = await sql.query(
    `select r2_key from transcriber.plan_items where plan_id = $1 and r2_key is not null`,
    [planId],
  )
  return rows.map((row) => String(row.r2_key))
}

export async function keysForModel(modelId: string): Promise<string[]> {
  const rows = await sql.query(
    `select i.r2_key from transcriber.plan_items i
       join transcriber.plans p on p.id = i.plan_id
      where p.model_id = $1 and i.r2_key is not null`,
    [modelId],
  )
  return rows.map((row) => String(row.r2_key))
}

/**
 * What a 70/20/10 card carries beyond its brief: which bucket it belongs to,
 * the single variable under test, and which of her own posts it recreates.
 *
 * Written in the **same insert** as the card, not stamped on afterwards. A
 * Double Down batch is the same job five times, and the unique index that
 * stops a library reel being added twice is partial on `source_post is null` —
 * so a rung inserted without its `source_post` collides with the rung before
 * it and silently vanishes. The fields have to be there when the row lands.
 */
export type CardExtras = {
  bucket?: string | null
  axis?: string | null
  source_post?: string | null
  source_url?: string | null
  hold?: string | null
  slot_day?: number | null
  slot_time?: string | null
  /** Put above the drafted direction, because it is what she does first. */
  lead?: string | null
}

/**
 * Put library items on a plan, each with a drafted brief.
 *
 * The unique index on (plan_id, job_id) means adding the same reference twice
 * is a no-op rather than a duplicate card, so the control can stay a plain tap.
 */
export async function appendItems(
  planId: string,
  modelId: string,
  jobIds: string[],
  extrasFor?: (jobId: string, index: number) => CardExtras,
): Promise<number> {
  const [row] = await sql.query(
    `select coalesce(max(position), -1) as last from transcriber.plan_items where plan_id = $1`,
    [planId],
  )
  let position = Number(row?.last ?? -1)
  let added = 0

  // Anything she already said no to never goes back on her week — not by the
  // planner, not by a bulk add, not by a mis-tap on the assign rail. The rail
  // blocks it in the UI; this is the same rule where it cannot be clicked past.
  const refused = await sql.query(
    `select job_id from transcriber.declines
      where model_id = $1 and job_id = any($2::text[])
        and (code = any($3::text[]) or declined_at > now() - ($4 || ' days')::interval)`,
    [modelId, jobIds, [...PERMANENT_DECLINES], String(DECLINE_COOLDOWN_DAYS)],
  )
  const declined = new Set(refused.map((row) => String(row.job_id)))

  // She films alone: a reel that needs someone else on camera never goes on
  // her week, however it is added (Susanna, the third time of asking,
  // 2026-09-27). `models.solo` is on unless someone turned it off for her.
  const [who] = await sql.query(`select coalesce(solo, true) as solo from transcriber.models where id = $1`, [modelId])
  const needsOthers = who?.solo === false ? new Set<string>() : await jobsNeedingOthers(jobIds)

  for (const [index, jobId] of jobIds.entries()) {
    if (declined.has(jobId) || needsOthers.has(jobId)) continue
    const extras = extrasFor?.(jobId, index) ?? {}
    // A reskin or an iteration points at HER reel, so the brief must stop
    // coaching her to fix its opening. `source_post` is what says whose it is.
    const input = { ...await briefInputFor(jobId, modelId), ownReel: Boolean(extras.source_post) }
    // `notes` stays the direction and is still written on every insert — it is
    // what her card renders as prose and what everything from before phase 3
    // falls back to. What it no longer carries is the handful of facts that
    // are now fields of their own, because showing them twice is worse than
    // the wall of text this was meant to break up.
    const fields = draftFields(input)
    // On her own reel the wardrobe line is not a suggestion. A control means
    // the same clothes; an outfit rung means one deliberate change and nothing
    // else. "Your call — pick it before the camera is up" said neither, and on
    // a card whose whole point is the single variable it reads as permission
    // to change something that must not move.
    if (extras.source_post) {
      fields.wardrobe = extras.axis === 'outfit'
        ? 'A different outfit from the original — that is the one thing being tested. ' +
          'Same place, same hair, same everything else.'
        : 'Exactly what you wore in the original.'
    }
    const notes = [extras.lead, fields.direction].filter(Boolean).join('\n\n')
    const inserted = await sql.query(
      // `card_no` counts on from the highest this model has ever been given,
      // across every week. It is read inside the insert so a batch of adds
      // numbers itself in order without a round trip per row, and it is never
      // recomputed afterwards — that is what makes "video 7" keep meaning the
      // same card after the week is reordered.
      `insert into transcriber.plan_items
         (id, plan_id, job_id, position, notes,
          wardrobe, camera, takes, sound, hook, caption,
          location, title, card_no,
          bucket, axis, source_post, source_url, hold, slot_day, slot_time)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
               (select coalesce(max(prior.card_no), 0) + 1
                  from transcriber.plan_items prior
                  join transcriber.plans owner on owner.id = prior.plan_id
                 where owner.model_id = $14),
               $15, $16, $17, $18, $19, $20, $21)
       -- The index is partial, so the predicate has to be named for Postgres
       -- to infer it. Her own reskins are meant to repeat; library reels are
       -- not, and that is exactly the line the predicate draws.
       on conflict (plan_id, job_id) where source_post is null do nothing
       returning id`,
      [
        newId(), planId, jobId, position + 1, notes,
        fields.wardrobe, fields.camera, fields.takes,
        fields.sound, fields.hook, fields.caption,
        draftLocation(input.formats),
        draftTitle(input.formats, (tag) => labelOf('format', tag)),
        modelId,
        extras.bucket ?? null, extras.axis ?? null,
        extras.source_post ?? null, extras.source_url ?? null,
        extras.hold ?? null, extras.slot_day ?? null, extras.slot_time ?? null,
      ],
    )
    if (inserted.length > 0) {
      position += 1
      added += 1
    }
  }
  return added
}
