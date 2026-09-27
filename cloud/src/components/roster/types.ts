/** Shapes shared by the console's model portal screens. */
import type { Social } from '@/lib/socials'

export type Model = {
  id: string
  name: string
  handle: string | null
  photo_url: string | null
  persona: string[]
  formats: string[]
  hooks: string[]
  wont_do: string[]
  status: 'active' | 'paused'
  /** Phase 5. A bespoke · B mixed · C library-only. Stated, never derived. */
  tier: 'A' | 'B' | 'C'
  filming_days: number[]
  weekly_target: number
  timezone: string
  /** The place label she was picked as. Null for rows saved before it. */
  place: string | null
  standing_rules: string | null
  notes: string | null
  /** Where she sends the footage — the folder, and the line naming the
   *  alternative. Null on any row saved before delivery existed. */
  drive_url: string | null
  delivery_note: string | null
  /** The Gosian bot group her plans are posted in. Linked in the Week tab. */
  telegram_chat_id?: string | null
  /** Whether Instagram will ever hand us her numbers: only a professional
   *  (Business or Creator) account can authorise Insights. `unknown` on every
   *  row saved before intake asked the question. */
  ig_account_type: 'unknown' | 'personal' | 'professional'
  creator_type?: string | null
  /** Every account of hers worth opening, in the order the buttons render.
   *  Empty on any row saved before the column existed — her `handle` still
   *  renders an Instagram button, see `withImpliedInstagram`. */
  socials: Social[]
  access_token: string
  token_revoked_at: string | null
  created_at: string
}

/** A roster card carries this week at a glance, so the grid answers "is anyone
 *  waiting on me" without opening anything. */
export type RosterModel = Model & {
  week_items: number
  week_filmed: number
  week_waiting: number
  plan_id: string | null
  plan_status: 'draft' | 'sent' | null
  unread_notes: number
  week_declined: number
  /** Whether this week's plan has ever been opened. False on a plan she has
   *  genuinely never opened; the column is null-safe in SQL so this is always
   *  a boolean here. */
  week_opened: boolean
}

export type PlanSummary = {
  id: string
  week_of: string
  due_date: string | null
  title: string | null
  status: 'draft' | 'sent'
  sent_at: string | null
  items: number
  filmed: number
  waiting: number
  unread: number
}

export type PlanHead = {
  id: string
  model_id: string
  week_of: string
  due_date: string | null
  title: string | null
  intro: string | null
  status: 'draft' | 'sent'
  sent_at: string | null
  model_name: string
  access_token: string
  token_revoked_at: string | null
  weekly_target: number
  timezone: string
  filming_days: number[]
  standing_rules: string | null
  /** Telegram, through the Gosian bot. `queued`/`manual` wait for the bot;
   *  `posted`/`recorded`/`failed` are its answer. */
  telegram_state: 'queued' | 'manual' | 'posted' | 'recorded' | 'failed' | null
  telegram_variant: string | null
  telegram_done_at: string | null
  telegram_error: string | null
  telegram_chat_id: string | null
  telegram_title: string | null
  telegram_skips: boolean | null
}

/** Another model already carrying the same reel. A warning, never a block —
 *  two creators on one trend is sometimes deliberate. */
export type Collision = {
  model_id: string
  name: string
  week_of: string
  status: 'draft' | 'sent'
}

/** One turn in the conversation about a card, as the console sees it. */
export type PlanMessageRow = {
  id: string
  author: 'model' | 'operator'
  body: string
  at: string
  seen: boolean
}

export type PlanItemRow = {
  id: string
  job_id: string
  position: number
  /** Phase 4. The card's own id, its name, and where it gets filmed.
   *  `item_title` rather than `title` because `title` further down is the
   *  reference's own title on Instagram and both are on the same row. */
  card_no: number | null
  item_title: string | null
  location: string | null
  notes: string | null
  editing_notes: string | null
  /** Phase 3. The brief as discrete fields; null falls back to `notes`. */
  wardrobe: string | null
  camera: string | null
  takes: string | null
  sound: string | null
  hook: string | null
  caption: string | null
  filmed_at: string | null
  posted_at: string | null
  post_url: string | null
  model_note: string | null
  model_note_at: string | null
  seen_at: string | null
  accepted_at: string | null
  declined_at: string | null
  decline_reason: string | null
  decline_code: string | null
  messages: PlanMessageRow[]
  /** What she has said that has not been read. */
  unread: number
  /** Other models whose weeks already carry this same reel. */
  also_on: Collision[]
  r2_key: string | null
  r2_bytes: number | null
  uploaded_at: string | null
  r2_purged_at: string | null
  author: string | null
  title: string | null
  webpage_url: string | null
  duration_sec: number | null
  folder: string | null
  has_thumb: boolean
  preview: string | null
}

export type UploadState = 'ready' | 'waiting' | 'no-video' | 'purged'

/** Whether this item is actually available on her phone, which is the one thing
 *  worth knowing before a link is sent. */
export function uploadStateOf(item: PlanItemRow): UploadState {
  if (item.uploaded_at) return 'ready'
  if (item.r2_purged_at) return 'purged'
  if (!item.folder) return 'no-video'
  return 'waiting'
}

export const UPLOAD_LABEL: Record<UploadState, string> = {
  ready: 'On R2',
  waiting: 'Waiting on the Mac',
  'no-video': 'No video on disk',
  purged: 'Reclaimed',
}

/** One of her own posts, ingested metadata-only, for the tap-to-link strip.
 *  `item_id` and `card_no` are set when it is already bound to a card. */
export type HerPost = {
  id: string
  status: string
  webpage_url: string | null
  upload_date: string | null
  duration_sec: number | null
  like_count: number | null
  comment_count: number | null
  has_thumb: boolean
  item_id: string | null
  card_no: number | null
  /** Already marked as ours to repost, and where it is going. */
  repurposed?: boolean
  destination?: 'trial' | 'main' | 'both' | null
}

/** A model scored against one library item, for the assign control. */
export type ModelFit = {
  id: string
  name: string
  fit: number
  matched: string[]
  /** She turned this exact reel down. Shown and blocked rather than hidden. */
  declined_code?: string | null
  declined_reason?: string | null
}

/** A library item scored against one model, for "suggested for her". */
export type Suggestion = {
  id: string
  author: string | null
  duration_sec: number | null
  upload_date: string | null
  outperformance: number | null
  is_hot: boolean | null
  /** Plain-language reasons, strongest first — see lib/appeal.ts. */
  badges?: { label: string; detail: string; tone: 'hot' | 'warm' | 'cool' }[]
  sig_plays?: number | string | null
  has_thumb: boolean
  preview: string | null
  fit: number
  matched: string[]
  /** Who else already has it. Rendered as a flag beside the row; the
   *  suggestion is still offered. */
  also_on: Collision[]
}
