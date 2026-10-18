/** Shapes shared by the console's model portal screens. */
import type { Platform, Social } from '@/lib/socials'

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
  /** Her OnlyFans usernames from matched Infloww accounts. Derived by the
   *  API on read, never saved — see `withLinkedOnlyfans`. */
  onlyfans_accounts?: string[]
  /** Why she is inactive (lib/inactive.ts), set only while status is paused. */
  inactive_reason?: string | null
  inactive_note?: string | null
  inactive_since?: string | null
  access_token: string
  token_revoked_at: string | null
  created_at: string
}

/** One follower reading. Same shape her sheet's own read returns, so the two
 *  are interchangeable as the figures strip renders them. */
export type CardReading = {
  id: string
  platform: Platform
  followers: number
  source: 'manual' | 'insights'
  taken_at: string
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
  /** Her newest readings and how many of her own posts are ingested, carried
   *  so the sheet's figures strip is drawn from what the grid already loaded
   *  rather than waiting on a fetch. Null on a response read before these
   *  columns existed; her sheet's own reads replace them a moment later. */
  readings: CardReading[] | null
  posts_count: number
  /** Her app account, carried so the grid can say "app · invited/active"
   *  without a request per card (2026-10-12). Null when she has none, or when
   *  the account store could not be read — both render as no line at all. */
  app_account?: { email: string; status: 'invited' | 'active' | 'disabled'; lastLoginAt: string | null } | null
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
  /** How many reels THIS week wants; null falls back to `weekly_target`. */
  target?: number | null
  /** How many of each content style the week wants (lib/styles.ts). Null on
   *  every week planned before the Add content composer existed. */
  style_targets?: Record<string, number> | null
  model_name: string
  access_token: string
  token_revoked_at: string | null
  weekly_target: number
  timezone: string
  filming_days: number[]
  standing_rules: string | null
  /** Their won't-do formats, for the editor's chips — struck, never silent. */
  wont_do?: string[] | null
  /** Which template drives their autodraft (lib/template.ts). Null = auto. */
  plan_template?: string | null
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
  /** What kind of job it is on her card — see cardKind in lib/card.ts. */
  bucket?: 'reskin' | 'iteration' | 'test' | 'repurpose' | 'custom' | null
  /** The content-style lane it was added under — format / talking / omegle /
   *  posts (lib/styles.ts). Null on cards added before the composer. */
  style?: string | null
  source_post?: string | null
  /** Where the card came from — the mixed-source tag (lib/source.ts). Null
   *  derives from the bucket, so render through `sourceOf`. */
  source?: string | null
  /** A reskin's one line: what changes from the reference. */
  twist?: string | null
  /** A format card's versions as fields (lib/styles.ts) — what changes each
   *  time. Null on cards written before versions became a column. */
  versions?: { outfit: string; caption: string }[] | null
  /** Per-card switches: filming directions and automated captions, each
   *  hideable from her card before the week goes out. */
  hide_film?: boolean | null
  hide_captions?: boolean | null
  /** Repurpose cards: null while it still needs repurposing. */
  repurposed_at?: string | null
  /** Her thumbs on the reference: 1 up, -1 down, null not answered. */
  rating?: number | null
  /** They said they had made this one already — now a Repurpose card. */
  made_at?: string | null
  /** Their post of it, if they pasted the link. */
  made_url?: string | null
  id: string
  /** Null on a written card — custom, original, blank — which has no library
   *  video behind it, on purpose. */
  job_id: string | null
  position: number
  /** Phase 4. The card's own id, its name, and where it gets filmed.
   *  `item_title` rather than `title` because `title` further down is the
   *  reference's own title on Instagram and both are on the same row. */
  card_no: number | null
  item_title: string | null
  location: string | null
  notes: string | null
  /** Free words for the model's card (Geno, 2026-10-13) — its own block on
   *  her page, separate from the Direction. Never machine-written. */
  notes_to_model?: string | null
  editing_notes: string | null
  editor_id?: string | null
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
  /** Her filmed take, uploaded from the app to R2 (2026-10-12). */
  take_key: string | null
  take_bytes: number | null
  take_duration_sec: number | null
  take_uploaded_at: string | null
  author: string | null
  title: string | null
  webpage_url: string | null
  duration_sec: number | null
  folder: string | null
  /** The library job's own status — what tells a card still downloading
   *  ("queued"/"running") apart from one with genuinely no video. */
  job_status?: string | null
  has_thumb: boolean
  preview: string | null
}

export type UploadState = 'ready' | 'waiting' | 'fetching' | 'no-video' | 'purged' | 'written'

/** Whether this item is actually available on her phone, which is the one thing
 *  worth knowing before a link is sent. */
export function uploadStateOf(item: PlanItemRow): UploadState {
  // A written card with nothing behind it — directions ARE the card. A card
  // WITH a job_id now carries a real reference video (the composer attaches
  // the German playbook's own video, 2026-10-13) and the worker uploads it to
  // R2 like any other, so it is read like any other: "On R2", "Waiting on the
  // Mac" — not "nothing to watch" while a video sits on it.
  if (!item.job_id) return 'written'
  if (item.uploaded_at) return 'ready'
  if (item.r2_purged_at) return 'purged'
  if (!item.folder) {
    // Just pasted: the Mac has not fetched it yet. Saying "no video on disk"
    // here is what sent everyone scrolling for a card that was simply loading.
    return item.job_status === 'queued' || item.job_status === 'running' ? 'fetching' : 'no-video'
  }
  return 'waiting'
}

export const UPLOAD_LABEL: Record<UploadState, string> = {
  ready: 'On R2',
  waiting: 'Waiting on the Mac',
  fetching: 'Downloading — shows up here by itself',
  'no-video': 'No video on disk',
  purged: 'Reclaimed',
  written: 'Written card — nothing to watch',
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
  /** Where the studio render stands: queued · rendering · ready · failed
   *  (docs/REPURPOSE.md). `marked` is a row from before renders existed. */
  repurpose_status?: 'marked' | 'queued' | 'rendering' | 'ready' | 'failed' | null
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
  /** The job's label — a German playbook reference's own name, shown when
   *  there is no author to show instead. */
  label?: string | null
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
