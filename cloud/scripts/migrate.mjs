// Creates the transcriber schema. Safe to re-run.
import { neon } from '@neondatabase/serverless'
import { loadEnv } from './env.mjs'

loadEnv()
const sql = neon(process.env.DATABASE_URL)

const statements = [
  `create schema if not exists transcriber`,

  `create table if not exists transcriber.jobs (
     id            text primary key,
     kind          text not null,
     source        text not null,
     source_key    text not null,
     label         text not null,
     batch_id      text,
     status        text not null default 'queued',
     stage         text,
     error         text,
     attempts      integer not null default 0,
     claimed_at    timestamptz,
     created_at    timestamptz not null default now(),
     updated_at    timestamptz not null default now()
   )`,

  // One row per distinct source keeps a re-pasted link from re-transcribing.
  `create unique index if not exists jobs_source_key_idx on transcriber.jobs (source_key)`,
  `create index if not exists jobs_status_idx on transcriber.jobs (status, created_at)`,

  `create table if not exists transcriber.transcripts (
     job_id         text primary key references transcriber.jobs(id) on delete cascade,
     platform       text,
     author         text,
     author_name    text,
     title          text,
     webpage_url    text,
     caption        text,
     upload_date    text,
     duration_sec   real,
     language       text,
     speaker_count  integer,
     word_count     integer,
     thumbnail      text,
     plain          text not null default '',
     markdown       text not null default '',
     srt            text,
     blocks         jsonb,
     speakers       jsonb,
     transcribed_at timestamptz not null default now()
   )`,

  `create index if not exists transcripts_author_idx on transcriber.transcripts (author)`,

  // Full-text search over what was actually said, plus who said it.
  `create index if not exists transcripts_search_idx on transcriber.transcripts
     using gin (to_tsvector('simple',
       coalesce(plain,'') || ' ' || coalesce(author,'') || ' ' ||
       coalesce(title,'') || ' ' || coalesce(caption,'')))`,

  `create table if not exists transcriber.worker_pings (
     id       integer primary key default 1,
     seen_at  timestamptz not null default now(),
     note     text
   )`,

  // The worker reports where its videos are reachable; a quick tunnel hands out
  // a new hostname on every restart, so this is learned, not configured.
  `alter table transcriber.worker_pings
     add column if not exists media_url text`,

  // ---------------------------------------------------------------- library

  // Engagement. Only the fields Instagram actually returns: likes and comments
  // are present on every stored post, view_count on one in forty-one and
  // share_count on none. Columns for views and shares would be permanently null.
  `alter table transcriber.transcripts
     add column if not exists like_count    integer,
     add column if not exists comment_count integer,
     add column if not exists post_id       text,
     add column if not exists folder        text,
     add column if not exists tagged_at     timestamptz,
     add column if not exists confirmed_at  timestamptz`,

  // Hot ranking filters on upload_date and groups by author.
  `create index if not exists transcripts_upload_idx on transcriber.transcripts (upload_date desc)`,

  // Three independent axes, one row per applied tag. `origin` separates what
  // the auto-tagger guessed from what a human actually stood behind, so a
  // re-run can replace its own guesses without touching confirmed tags.
  `create table if not exists transcriber.tags (
     job_id text not null references transcriber.jobs(id) on delete cascade,
     axis   text not null check (axis in ('persona','format','hook','topic')),
     tag    text not null,
     origin text not null default 'auto' check (origin in ('auto','human')),
     score  real,
     primary key (job_id, axis, tag)
   )`,

  `create index if not exists tags_lookup_idx on transcriber.tags (axis, tag)`,

  // A creator's persona is a property of the creator, not of each video, so it
  // lives here and the Models tab reads it directly.
  `create table if not exists transcriber.creators (
     handle       text primary key,
     display_name text,
     persona      text[] not null default '{}',
     note         text,
     updated_at   timestamptz not null default now()
   )`,

  // ------------------------------------------------------------ model portal

  // `transcriber.creators` above are the Instagram accounts we research. These
  // are our own people, which is a different entity entirely — hence a second
  // table rather than a flag on the first. The UI calls them Models and calls
  // the researched accounts Creators.
  `create table if not exists transcriber.models (
     id               text primary key,
     name             text not null,
     handle           text,
     photo_url        text,
     persona          text[] not null default '{}',
     status           text not null default 'active',
     filming_days     int[]  not null default '{}',
     weekly_target    integer not null default 21,
     timezone         text not null default 'America/New_York',
     standing_rules   text,
     notes            text,
     access_token     text unique not null,
     token_revoked_at timestamptz,
     created_at       timestamptz not null default now(),
     updated_at       timestamptz not null default now()
   )`,

  `create table if not exists transcriber.plans (
     id         text primary key,
     model_id   text not null references transcriber.models(id) on delete cascade,
     week_of    date not null,
     due_date   date,
     title      text,
     intro      text,
     status     text not null default 'draft',
     sent_at    timestamptz,
     created_at timestamptz not null default now(),
     updated_at timestamptz not null default now()
   )`,

  // One plan per model per week. The share link always resolves to the current
  // week, so two plans for the same week would be a coin toss.
  `create unique index if not exists plans_model_week_idx on transcriber.plans (model_id, week_of)`,

  // A plan item points at a library job, so it inherits the Instagram link, the
  // transcript, the tags, the engagement and the video for free. Nothing that
  // already lives on the job is copied down here.
  `create table if not exists transcriber.plan_items (
     id            text primary key,
     plan_id       text not null references transcriber.plans(id) on delete cascade,
     job_id        text not null references transcriber.jobs(id) on delete cascade,
     position      integer not null default 0,
     notes         text,
     editing_notes text,
     filmed_at     timestamptz,
     posted_at     timestamptz,
     post_url      text,
     -- Hers, not ours. Never overwritten from the console, and shown
     -- unread-styled until seen_at says Geno has read it.
     model_note    text,
     model_note_at timestamptz,
     seen_at       timestamptz,
     -- The copy of the video that lives in R2 rather than on the Mac. A plan is
     -- client-facing, and the tunnel dies whenever the Mac sleeps.
     r2_key        text,
     r2_bytes      bigint,
     uploaded_at   timestamptz,
     -- Set when retention has reclaimed the object, so a purged item is not
     -- immediately re-queued for upload by the same query that found it.
     r2_purged_at  timestamptz,
     created_at    timestamptz not null default now()
   )`,

  `create unique index if not exists plan_items_unique_idx on transcriber.plan_items (plan_id, job_id)`,
  `create index if not exists plan_items_upload_idx on transcriber.plan_items (uploaded_at, r2_purged_at)`,

  // What she actually does, in the same vocabulary the library tags videos
  // with. Uncapped on purpose: the autotagger caps its guesses about one video,
  // but this is a human statement about a person.
  `alter table transcriber.models
     add column if not exists formats text[] not null default '{}',
     add column if not exists hooks   text[] not null default '{}',
     -- A hard exclusion, not a low score. Recommending gym content to someone
     -- who has said no is worse than recommending nothing.
     add column if not exists wont_do text[] not null default '{}'`,

  // Keys whose row is already gone. Deleting a plan removes its rows instantly;
  // the bytes in R2 can only be reclaimed by the Mac, which does it on its next
  // poll. Without this list those objects would be billed forever.
  `create table if not exists transcriber.r2_trash (
     key        text primary key,
     created_at timestamptz not null default now()
   )`,

  // Whether this video has anything worth running whisper over. Most of what
  // gets added is a silent thirst trap or a text-overlay post, and a speech
  // pass on those costs Mac time to produce an empty file. Default true so
  // everything already in the library keeps the transcript it was added for;
  // new rows say what they want explicitly.
  `alter table transcriber.jobs
     add column if not exists transcribe boolean not null default true`,

  // What the speech pass actually heard, as against what was asked for.
  // Measured 2026-09-03: whisper large-v3-turbo behind Silero VAD costs ~1s on
  // a reel and returns zero segments on a music-only post, so the honest label
  // comes from listening rather than guessing. `has_speech` is null until a
  // pass has run — which is not the same statement as false.
  `alter table transcriber.transcripts
     add column if not exists has_speech boolean,
     add column if not exists speech_ratio real`,

  // A human disagreeing with the pass. Null means nobody has, so the machine's
  // finding stands; same contract as a tag, where a confirmed value is never
  // overwritten by a later suggestion.
  `alter table transcriber.transcripts
     add column if not exists speech_override boolean`,

  // What the screen said. `has_looked` follows the same convention has_speech
  // set: null means nothing has looked, which is NOT the same claim as
  // "looked and found no text". Conflating them re-OCRs every wordless video
  // forever. Additive — nothing existing changes.
  `alter table transcriber.transcripts
     add column if not exists has_looked boolean,
     add column if not exists on_screen_text text,
     add column if not exists on_screen_captions jsonb`,

  // ------------------------------------------------ her answer on an item

  // Whether she has taken the card on. Two nullable timestamps rather than one
  // status column, because "not answered yet" is a real third state and the
  // console has to be able to tell it apart from a decline. Both null is
  // untouched; a decline carries the reason she gave, in her words.
  `alter table transcriber.plan_items
     add column if not exists accepted_at    timestamptz,
     add column if not exists declined_at    timestamptz,
     add column if not exists decline_reason text`,

  `create index if not exists plan_items_verdict_idx
     on transcriber.plan_items (declined_at) where declined_at is not null`,

  // ------------------------------------------------------------ the thread

  // Until now `plan_items.model_note` held one string she could overwrite, and
  // there was nowhere for an answer to go — she could ask and never be told.
  // This is that conversation, one row per message, either side.
  //
  // `seen_at` is always "read by the other side": on a model message it is
  // Geno reading it, on an operator message it is her. That keeps one unread
  // rule instead of two.
  `create table if not exists transcriber.plan_messages (
     id         text primary key,
     item_id    text not null references transcriber.plan_items(id) on delete cascade,
     author     text not null check (author in ('model','operator')),
     body       text not null,
     created_at timestamptz not null default now(),
     seen_at    timestamptz
   )`,

  `create index if not exists plan_messages_item_idx
     on transcriber.plan_messages (item_id, created_at)`,

  `create index if not exists plan_messages_unread_idx
     on transcriber.plan_messages (author, seen_at) where seen_at is null`,

  // Carry every note she has already written into the thread, so switching to
  // messages loses nothing she said. The id is derived from the item so a
  // re-run cannot duplicate it, and `model_note` is deliberately left in place
  // rather than dropped — it is still what the roster's existing unread count
  // reads, and a column that is cheap to keep is not worth a destructive
  // migration to remove.
  `insert into transcriber.plan_messages (id, item_id, author, body, created_at, seen_at)
   select 'seed_' || i.id, i.id, 'model', i.model_note,
          coalesce(i.model_note_at, i.created_at), i.seen_at
     from transcriber.plan_items i
    where i.model_note is not null and length(trim(i.model_note)) > 0
   on conflict (id) do nothing`,

  // ------------------------------------------- the brief, un-flattened

  // `lib/brief.ts` already worked all of this out and then joined it into one
  // prose blob, so the console could only offer her a wall of text to read on a
  // phone. These are the same facts as discrete fields. All nullable: an item
  // whose fields are empty falls back to `notes`, which is still written on
  // every insert and is still the only thing older items have.
  //
  // `caption` is genuinely new — nothing has ever drafted what she actually
  // posts under the video.
  `alter table transcriber.plan_items
     add column if not exists wardrobe text,
     add column if not exists camera   text,
     add column if not exists takes    text,
     add column if not exists sound    text,
     add column if not exists hook     text,
     add column if not exists caption  text`,

  // --------------------------------------- grouping and a stable id

  // Where she films it, in her words. The plan is grouped by this so that
  // everything shot in the car is shot in one trip to the car.
  //
  // `title` is what the card is called before you have watched anything —
  // "Car GRWM" reads as a job, "Video 3" reads as a row number.
  //
  // `card_no` is the one that matters. The list has always been numbered 1..N
  // by position, so moving one card renumbered every card under it and "video
  // 7" meant something different after any edit. This is assigned once, per
  // model, and never reassigned — reordering, deleting and adding all leave it
  // alone, which is the whole point.
  `alter table transcriber.plan_items
     add column if not exists location text,
     add column if not exists title    text,
     add column if not exists card_no  integer`,

  // Number what is already there, once. Ordered by the week and then by
  // position so the ids run in the order the weeks were actually worked. The
  // null guard is what makes this re-runnable: a row that already has a number
  // keeps it forever.
  `with taken as (
     select p.model_id, coalesce(max(i.card_no), 0) as high
       from transcriber.plan_items i
       join transcriber.plans p on p.id = i.plan_id
      group by p.model_id
   ), numbered as (
     select i.id, p.model_id,
            row_number() over (
              partition by p.model_id
              order by p.week_of, i.position, i.created_at
            ) as n
       from transcriber.plan_items i
       join transcriber.plans p on p.id = i.plan_id
      where i.card_no is null
   )
   update transcriber.plan_items i
      -- Counting on from whatever this model has already been given, so a
      -- second run over a roster that is half numbered cannot hand out an id
      -- twice.
      set card_no = numbered.n + coalesce(taken.high, 0)
     from numbered left join taken on taken.model_id = numbered.model_id
    where numbered.id = i.id and i.card_no is null`,

  `create index if not exists plan_items_card_idx on transcriber.plan_items (card_no)`,

  // ------------------------------------------------------------- her tier

  // How much of her week is made for her. A is bespoke, B is mixed, C is
  // library-only. Nothing computes this — every plan item is a library
  // reference, so there is no signal in the data to derive it from. It is a
  // commercial fact about the arrangement and it has to be stated.
  //
  // Defaults to B so an existing roster lands in the middle rather than being
  // silently promoted or demoted by a migration.
  `alter table transcriber.models
     add column if not exists tier text not null default 'B'
       check (tier in ('A','B','C'))`,

  // Where she is, as a place rather than a zone. Thirty US entries in
  // lib/timezones.ts share `America/New_York`, so the zone alone cannot say
  // which one the operator picked — the select snapped every Eastern state
  // back to Connecticut. Nullable on purpose: a model saved before this
  // column, or with a hand-typed zone, keeps working and just falls back to
  // the first place sharing her zone until she is next saved.
  `alter table transcriber.models
     add column if not exists place text`,

  // Seed the rows that were already listened to, so they are not all re-run.
  // `jobs.transcribe` is the record of whether a pass was asked for, and until
  // 2026-09-03 it could be false — so true plus a finished job means whisper
  // did run, and word_count is then a straight answer. Rows that were never
  // asked stay null, which is what ./bin/relisten looks for. Guarded on null,
  // so re-running this never overwrites a real finding.
  `update transcriber.transcripts t
      set has_speech = (t.word_count > 0)
     from transcriber.jobs j
    where j.id = t.job_id
      and t.has_speech is null
      and j.transcribe
      and j.status = 'done'`,

  // ------------------------------------------------ where the footage goes

  // The plan told her what to film and never once told her where to send it.
  // Delivery is a Google Drive folder per creator — one she already has access
  // to — with the Telegram marketing channel as the stated alternative. Both
  // nullable: a model with neither renders nothing rather than an empty box,
  // and the Drive link is never required to send a plan.
  `alter table transcriber.models
     add column if not exists drive_url     text,
     add column if not exists delivery_note text`,

  // ------------------------------------------------ why she turned it down

  // A decline already carried her reason, in her words, and that is often the
  // useful half — but prose cannot be counted, so three "nowhere to film" in a
  // row read as a mood rather than as a constraint. This is an enum beside the
  // text, never instead of it.
  `alter table transcriber.plan_items
     add column if not exists decline_code text`,

  // ------------------------------------------------------- did she open it

  // "Sent" and "seen" were the same state, so a creator going quiet could not
  // be told apart from one who never opened the link — and those need opposite
  // responses. Written once, on the first render of her page.
  `alter table transcriber.plans
     add column if not exists opened_at timestamptz`,

  // ------------------------------------------- her own wardrobe, her own camera

  // The brief's lookup tables are global, so two creators shooting the same
  // format get byte-identical wardrobe lines. This is the layer in front of
  // them: model override → format default → global default.
  //
  // A table rather than a jsonb column on `models`, because it is queryable —
  // "which of my models have overridden camera" is a question worth being able
  // to ask.
  //
  // Consulted only when drafting. An override never rewrites a card that has
  // already been authored, which is the same contract phase 3 set for the
  // direction.
  `create table if not exists transcriber.model_brief_defaults (
     model_id   text not null references transcriber.models(id) on delete cascade,
     -- The format tag this applies to, or '*' for every format of hers.
     format     text not null,
     -- wardrobe | camera | takes | sound | caption
     field      text not null,
     value      text not null,
     updated_at timestamptz not null default now(),
     primary key (model_id, format, field)
   )`,

  `create index if not exists model_brief_defaults_model_idx
     on transcriber.model_brief_defaults (model_id)`,

  // ------------------------------------------- is her account one we can read

  // Views, saves, watch time and follows-from-post are all readable through
  // the Insights API — but only for a *professional* (Business or Creator)
  // account that has authorised our app. Everything the measurement half of
  // the plan needs turns on this one fact about each model, and it is a fact
  // nothing in the data can derive: it has to be asked and written down.
  //
  // Asked at intake, and answerable long before the Meta app exists — knowing
  // which five of eighteen are still on a personal account is what makes the
  // day App Review clears a connect-them-all afternoon instead of a survey.
  // The token and the IG user id land with that app; this column is the
  // prerequisite, not the connection.
  `alter table transcriber.models
     add column if not exists ig_account_type text not null default 'unknown'
       check (ig_account_type in ('unknown', 'personal', 'professional'))`,

  // ------------------------------------------------------ where she is online

  // Every account of hers we might open, in one place, so reviewing her
  // content is a tap rather than a search. A jsonb array rather than a table:
  // it is read whole, written whole, and never queried across models, which is
  // the same reasoning `plan_messages` did NOT qualify for.
  //
  // `handle` is kept beside `url` on purpose. The URL is what a tap opens; the
  // handle is what gets typed into a search box when a link rots, and rebuilding
  // one from the other guesses wrong on every platform that allows a vanity
  // path. Shape: [{ platform, handle, url }].
  `alter table transcriber.models
     add column if not exists socials jsonb not null default '[]'::jsonb`,

  // Her reach, per account, as a series rather than a number.
  //
  // A single `followers` column would answer "how big is she" and nothing else.
  // The question worth asking is whether the weeks we plan are moving her, and
  // that needs two readings and a date between them. Source is stamped because
  // a figure somebody typed off a phone and a figure Instagram handed back are
  // not the same evidence, and the day App Review clears we want to be able to
  // tell which rows were which.
  `create table if not exists transcriber.model_followers (
     id        text primary key,
     model_id  text not null references transcriber.models(id) on delete cascade,
     platform  text not null,
     followers bigint not null check (followers >= 0),
     source    text not null default 'manual'
       check (source in ('manual', 'insights')),
     taken_at  timestamptz not null default now()
   )`,

  `create index if not exists model_followers_idx
     on transcriber.model_followers (model_id, platform, taken_at desc)`,

  // ------------------------------------------------------- her intake form

  // The form she filled in, kept whole beside what was made of it. Onboarding
  // used to end with somebody re-typing her answers into the sheet; `raw` is
  // what the mapper read and `parsed` is what it proposed, so a mapping can be
  // re-run against better rules later without asking her for the form again —
  // the same reason ./bin/relisten keeps the audio.
  `create table if not exists transcriber.model_intake (
     id         text primary key,
     model_id   text not null references transcriber.models(id) on delete cascade,
     -- The original document in Blob storage, when one was uploaded. Null when
     -- the answers were pasted in, which is the path a PDF takes.
     source_url text,
     filename   text,
     raw        text not null,
     parsed     jsonb not null,
     -- Stamped when the profile was actually saved from this form, so a form
     -- that was read and then ignored is distinguishable from one that landed.
     applied_at timestamptz,
     created_at timestamptz not null default now()
   )`,

  `create index if not exists model_intake_model_idx
     on transcriber.model_intake (model_id, created_at desc)`,

  // --------------------------------------------- standing: priority and heat

  // What she does on her page, one row per act. `plans.opened_at` is stamped
  // once, so "is she still coming back to it" was unanswerable; the item
  // columns only ever hold the latest state, so a card accepted, reopened and
  // accepted again read as one quiet tap. This is the timeline behind heat.
  //
  // Written best-effort by the routes she already calls — a failed insert
  // here must never fail her tap. Visits are throttled at write time.
  `create table if not exists transcriber.plan_events (
     id       text primary key,
     model_id text not null references transcriber.models(id) on delete cascade,
     plan_id  text references transcriber.plans(id) on delete set null,
     item_id  text references transcriber.plan_items(id) on delete set null,
     kind     text not null
       check (kind in ('visit','accept','decline','reopen','film','unfilm','message')),
     at       timestamptz not null default now()
   )`,

  `create index if not exists plan_events_model_idx
     on transcriber.plan_events (model_id, at desc)`,
  `create index if not exists plan_events_plan_idx
     on transcriber.plan_events (plan_id, kind, at desc)`,

  // The week a card was first put on, set when a past week is carried forward.
  // A card that keeps moving unfilmed is backlog, and without this a carry
  // erased the only evidence of it.
  `alter table transcriber.plan_items
     add column if not exists carried_from date`,

  // Priority, which is not `tier`. `tier` says how bespoke her plan is and
  // stays exactly that. `priority` is who gets attention first: suggested by
  // the console from revenue and heat, set by Geno, never changed on its own.
  // Null until he sets it. Revenue is a band, not a figure: dollar amounts do
  // not belong in a system that hands out links.
  `alter table transcriber.models
     add column if not exists priority        text check (priority in ('S','A','B','C')),
     add column if not exists priority_set_at timestamptz,
     add column if not exists revenue_band    text check (revenue_band in ('high','mid','low')),
     add column if not exists revenue_set_at  timestamptz`,

  // Scout — the watchlist sweep. `access` is what the last sweep learned about
  // reading the account: open to a logged-out reader, gated (18+ or audience-
  // restricted, needs the burner session), or missing (renamed/deleted).
  // `watch` separates the accounts we sweep from ones the sweep *suggested*
  // (collaborators on a winner) so a suggestion never costs a sweep until a
  // human says watch it. Everything already here is `watching`.
  `alter table transcriber.creators
     add column if not exists access    text check (access in ('open','gated','missing')),
     add column if not exists access_at timestamptz,
     add column if not exists swept_at  timestamptz,
     add column if not exists watch     text not null default 'watching'
       check (watch in ('watching','suggested','dismissed')),
     add column if not exists found_via text`,

  // Every reel the sweep has seen, winner or not. This is the creator's real
  // baseline — the library only holds posts someone chose to keep, so a median
  // over the library is a median over the good ones. Metrics are refreshed on
  // every sighting because plays keep climbing for days.
  `create table if not exists transcriber.sightings (
     post_id        text primary key,
     handle         text not null,
     url            text not null,
     source_key     text not null,
     posted_at      timestamptz,
     plays          bigint,
     likes          bigint,
     comments       bigint,
     duration_sec   real,
     caption        text,
     audio_id       text,
     audio_title    text,
     audio_artist   text,
     original_audio boolean,
     collaborators  text[] not null default '{}',
     tagged         text[] not null default '{}',
     pinned         boolean not null default false,
     via            text not null check (via in ('apify','burner')),
     first_seen_at  timestamptz not null default now(),
     seen_at        timestamptz not null default now(),
     job_id         text references transcriber.jobs(id) on delete set null,
     picked_at      timestamptz,
     pick_reason    text
   )`,
  `create index if not exists sightings_handle_idx
     on transcriber.sightings (handle, posted_at desc)`,
  `create index if not exists sightings_audio_idx
     on transcriber.sightings (audio_id, posted_at desc) where audio_id is not null`,
  `create index if not exists sightings_source_key_idx
     on transcriber.sightings (source_key)`,
  // The window queries — `risingSounds` (28 days, every Sounds panel open) and
  // `candidates` (120 days, every sweep) — filter on time across all handles,
  // which neither index above can serve. Seq-scanned at 6,799 rows on
  // 2026-09-20; this table is the one headed for hundreds of thousands.
  `create index if not exists sightings_posted_idx
     on transcriber.sightings (posted_at desc)`,

  // Where the media actually sits, as the sweep saw it. Instagram's CDN links
  // are signed and expire in about 33 hours (read off the `oe` parameter), so
  // these are a short-lived shortcut, not storage: the cloud fallback can
  // fetch a reel with no Mac and no second Apify call while they are fresh,
  // and re-fetches once they are not.
  `alter table transcriber.sightings
     add column if not exists audio_url   text,
     add column if not exists video_url   text,
     add column if not exists poster_url  text,
     add column if not exists media_until timestamptz`,

  // Last sweep's play count, so a re-sighting can say whether a reel is still
  // climbing. One snapshot says how big; two say which direction.
  `alter table transcriber.sightings
     add column if not exists plays_prev    bigint,
     add column if not exists plays_prev_at timestamptz`,

  // What the creator says she is. A bio states in one line what a still frame
  // can only hint at — "mom of 3", "goth mommy", "certified brat" — and it is
  // the single densest piece of evidence for positioning her.
  `alter table transcriber.creators
     add column if not exists bio        text,
     add column if not exists category   text,
     add column if not exists followers  bigint,
     add column if not exists is_private boolean,
     add column if not exists profile_at timestamptz`,

  // What the profiler thinks a creator is, waiting on a human. Never applied
  // on its own: persona decides which model gets shown her work, and a guess
  // that writes itself into the matcher is a guess nobody can see.
  `create table if not exists transcriber.creator_proposals (
     handle     text primary key references transcriber.creators(handle) on delete cascade,
     tags       text[] not null default '{}',
     why        text,
     evidence   jsonb  not null default '{}',
     made_at    timestamptz not null default now(),
     decided_at timestamptz,
     decision   text check (decision in ('taken','edited','rejected'))
   )`,
  `create index if not exists creator_proposals_open_idx
     on transcriber.creator_proposals (made_at desc) where decided_at is null`,

  // One row per sweep, so "did it run, what did it cost, what did it find" is
  // a query rather than a log file on the Mac.
  `create table if not exists transcriber.scout_runs (
     id          text primary key,
     started_at  timestamptz not null,
     finished_at timestamptz not null default now(),
     handles     int not null default 0,
     sightings   int not null default 0,
     picked      int not null default 0,
     suggested   int not null default 0,
     gated       int not null default 0,
     cost_usd    numeric(8,4),
     notes       jsonb not null default '{}'
   )`,

  // ------------------------------------------------- the 70/20/10 week
  //
  // A card used to be one thing: a library reel to recreate. The Creative
  // Director workflow splits her week three ways, and two of those buckets are
  // her *own* posts, which have no `job_id` until they are ingested. So a card
  // now carries where it came from and what is under test on it.
  //
  //   bucket       reskin | iteration | test
  //   axis         the ONE variable a reskin changes — outfit, location, hook.
  //                Null on a control, which is the point of a control.
  //   source_post  her winning post's shortcode, for a reskin or an iteration
  //   hold         what must not move, so a result can be attributed
  //   slot_day     0-6 from the week's Monday
  //   slot_time    'HH:MM' local to her — 10:00 / 13:00 / 18:00
  //
  // Nullable throughout: every card written before this exists is a test by
  // definition, and backfilling a guess would be inventing history.
  `alter table transcriber.plan_items
     add column if not exists bucket      text,
     add column if not exists axis        text,
     add column if not exists source_post text,
     add column if not exists source_url  text,
     add column if not exists hold        text,
     add column if not exists slot_day    smallint,
     add column if not exists slot_time   text`,

  // How many ladder batches a model has run, which decides the next axis.
  `create index if not exists plan_items_source_idx
     on transcriber.plan_items (source_post) where source_post is not null`,

  // The uniqueness rule has to change shape for the ladder.
  //
  // (plan_id, job_id) unique is what stops a re-drafted week handing her the
  // same library reel twice, and it should keep doing exactly that. But a
  // Double Down batch is *deliberately* the same video five times — two
  // controls and three single-variable variants — so under the old index a
  // batch of five collapsed to one card without a word.
  //
  // So it becomes partial: library cards keep the guarantee, her own reskins
  // are allowed to repeat. Dropping and recreating rather than adding a second
  // index, because two rules on the same columns is how a constraint gets
  // enforced by whichever one someone happened to read.
  // ------------------------------------------------- quality scan (T2)
  `create table if not exists transcriber.quality_checks (
     post_id    text primary key,
     model_id   text not null references transcriber.models(id) on delete cascade,
     scores     jsonb not null,
     composite  real,
     verdict    text not null check (verdict in ('PASS', 'WARN', 'FAIL')),
     notes      text,
     checked_at timestamptz not null default now()
   )`,

  // ------------------------------------------------- the editor's queue
  //
  // Edit Reskins and Trial Reels: work on a clip that already exists, so it
  // never goes in her filming plan (decision 4 in CREATIVE-DIRECTOR.md).
  // One row per winner per move, so re-generating the queue is a no-op.
  `create table if not exists transcriber.editor_tasks (
     id          text primary key,
     model_id    text not null references transcriber.models(id) on delete cascade,
     source_post text not null,
     kind        text not null check (kind in ('edit', 'trial')),
     move        text not null,
     due_date    date not null,
     done_at     timestamptz,
     created_at  timestamptz not null default now()
   )`,
  `create unique index if not exists editor_tasks_unique_idx
     on transcriber.editor_tasks (model_id, source_post, kind, move)`,
  // Her trial-reel stage: 1 = 5 a day, 2 = 10, 3 = 15. Advanced by hand once a
  // stage runs smoothly — the manual's own rule, and not one a query can judge.
  `alter table transcriber.models
     add column if not exists trial_stage smallint not null default 1`,

  // ------------------------------------------------- her brand, once accepted
  //
  // Derived by lib/insights.ts and offered for a tap. Only what a human
  // accepted lands here; until then the planner works off the live proposal.
  //   verticals  [{format, name, tier}] — her 3-5 branded verticals, A/B/C
  //   similar_creators  the 3 watched creators she is benchmarked against
  //                     (not `similar` — that is a reserved word, SIMILAR TO)
  `alter table transcriber.models
     add column if not exists verticals jsonb,
     add column if not exists similar_creators text[]`,

  // ------------------------------------------------- what the card says to her
  //
  // brief_short     the T6 short brief — a DM-ready paragraph in her voice,
  //                 written by a model and stored because it is paid for once
  // caption_options the caption engine's output: formula, caption, and the
  //                 exact comment each one is built to provoke
  `alter table transcriber.plan_items
     add column if not exists brief_short     text,
     add column if not exists caption_options jsonb`,

  // ------------------------------------------------- where a date came from
  //
  // `taken_at` when the page sent one, `id` when it was read out of the
  // shortcode (lib/postid.ts). The reels tab never sends a date, so without
  // the second most new reels were stored undated — 1,429 rows on
  // 2026-09-21. Labelled so a real date always replaces a derived one.
  `alter table transcriber.creator_posts
     add column if not exists posted_at_source text`,
  `alter table transcriber.sightings
     add column if not exists posted_at_source text`,

  // Her own reels' CDN links, read by the roster pass. Her winners are not
  // sightings, so the direct-download fallback had nothing to fall back on
  // and 12 of 62 failed on 2026-09-21. Links expire in about a day, hence
  // `media_until`.
  `alter table transcriber.creator_posts
     add column if not exists video_url text,
     add column if not exists poster_url text,
     add column if not exists media_until timestamptz`,

  // The fourth axis. The table was created when there were three, and its
  // check constraint would refuse every topic tag.
  `alter table transcriber.tags drop constraint if exists tags_axis_check`,
  `alter table transcriber.tags add constraint tags_axis_check
     check (axis in ('persona','format','hook','topic'))`,

  // A winner she should shoot again is one decision; a winner we repost
  // ourselves is another. Added 2026-09-22: the reel goes through a batcher
  // that rewrites its metadata, then out again on trial reels or the main
  // feed. Tracked so the same reel is not quietly reposted twice.
  `create table if not exists transcriber.repurposes (
     post_id     text primary key,
     model_id    text not null references transcriber.models(id) on delete cascade,
     job_id      text references transcriber.jobs(id) on delete set null,
     destination text not null default 'trial' check (destination in ('trial','main','both')),
     note        text,
     created_at  timestamptz not null default now(),
     posted_at   timestamptz
   )`,
  `create index if not exists repurposes_model_idx on transcriber.repurposes (model_id, created_at desc)`,

  // Her "no", kept apart from the card it was said on.
  //
  // Declines lived only on `plan_items`, and matching skipped a reel because
  // that row still existed — delete the card and the same reel could be
  // offered to her again next week. This is the record that outlives the
  // card: one row per model per reel, the first refusal kept.
  `create table if not exists transcriber.declines (
     model_id   text not null references transcriber.models(id) on delete cascade,
     job_id     text not null references transcriber.jobs(id) on delete cascade,
     code       text,
     reason     text,
     declined_at timestamptz not null default now(),
     primary key (model_id, job_id)
   )`,

  // Who the creator is. Added 2026-09-23, after the caption writer addressed
  // Magnus — a man — as "a Connecticut girl" for a whole week, because nothing
  // on a model said otherwise and the roster's default reading is female.
  // `unknown` is a real answer and the default: nobody has said is not the
  // same as nobody knows.
  `alter table transcriber.models
     add column if not exists creator_type text not null default 'unknown'`,

  // Her niches — golf, cars, trivia. The fourth tag axis, added 2026-09-22:
  // the library held 51 golf reels and nothing said they were golf, so the
  // golf model got generic tests instead.
  `alter table transcriber.models
     add column if not exists topics text[]`,

  // What the viewer burner saw for a reel Instagram only shows signed-in
  // accounts: the video link on the page, which expires in about a day, and
  // how often it has tried. The worker fetches the file from that link with no
  // account at all (2026-09-25, after Geno's own account was warned).
  `create table if not exists transcriber.job_media (
     job_id       text primary key references transcriber.jobs(id) on delete cascade,
     video_url    text,
     poster_url   text,
     media_until  timestamptz,
     viewed_at    timestamptz,
     tries        integer not null default 0,
     last_error   text
   )`,

  // Telegram, through the Gosian bot (2026-09-26). The bot shares its creator
  // groups here; each model is linked to one by hand in her Week tab. Sending a
  // week either queues it for the bot to post in her MARKETING topic, or
  // records that Geno sent it himself — the bot polls for both and reports back.
  `create table if not exists transcriber.telegram_groups (
     chat_id         text primary key,
     title           text not null,
     creator_name    text,
     skip_campaigns  boolean not null default false,
     synced_at       timestamptz not null default now()
   )`,
  `alter table transcriber.models
     add column if not exists telegram_chat_id text`,
  `alter table transcriber.plans
     add column if not exists telegram_state      text,
     add column if not exists telegram_variant    text,
     add column if not exists telegram_queued_at  timestamptz,
     add column if not exists telegram_done_at    timestamptz,
     add column if not exists telegram_error      text`,

  // The dashboard's performance tag, pinned by hand (2026-09-27). Null means
  // the automatic tag from lib/performance/math.ts stands.
  `alter table transcriber.models
     add column if not exists performance_tag text
       check (performance_tag in ('top', 'average', 'attention'))`,

  // The 90-day library (2026-09-27, lib/expiry.ts). Archived, never deleted:
  // hidden everywhere the library is offered, restorable from its shelf.
  `alter table transcriber.jobs
     add column if not exists archived_at     timestamptz,
     add column if not exists archived_reason text`,
  `create index if not exists jobs_live_idx on transcriber.jobs (status) where archived_at is null`,

  // Her questions go to Telegram (2026-09-27): the Gosian bot posts each one
  // in her MARKETING topic and in OPS, then stamps relayed_at. Only questions
  // from the last few days are offered, so linking a model later never floods
  // her group with old ones.
  `alter table transcriber.plan_messages
     add column if not exists relayed_at  timestamptz,
     add column if not exists relay_error text`,

  // Shout-outs (2026-09-27): the Gosian bot congratulates a model on reels
  // that beat her own usual — a weekly roundup and an instant note for a big
  // hit. One row per message sent, so nothing is ever celebrated twice.
  `create table if not exists transcriber.shoutouts (
     id         text primary key,
     model_id   text not null references transcriber.models(id) on delete cascade,
     kind       text not null check (kind in ('weekly', 'instant')),
     week_of    date,
     post_ids   text[] not null default '{}',
     sent_at    timestamptz,
     error      text,
     created_at timestamptz not null default now()
   )`,

  // Repurpose cards (2026-09-27): null = "needs repurposing" — we still have
  // to run it through the batcher and send it back; set when that is done.
  `alter table transcriber.plan_items
     add column if not exists repurposed_at timestamptz`,

  // Weekly scorecards (2026-09-27): one row per card the Gosian bot sent (or
  // failed to), so a week is never sent twice.
  `create table if not exists transcriber.scorecards (
     id         text primary key,
     model_id   text not null references transcriber.models(id) on delete cascade,
     week_of    date not null,
     sent_at    timestamptz,
     error      text,
     created_at timestamptz not null default now()
   )`,

  `drop index if exists transcriber.plan_items_unique_idx`,
  `create unique index if not exists plan_items_unique_idx
     on transcriber.plan_items (plan_id, job_id) where source_post is null`,

  // OnlyFans numbers (2026-09-27, lib/numbers, docs/NUMBERS.md). There is no
  // OnlyFans API: numbers arrive as screenshots read by Claude or Infloww CSV
  // exports, and nothing lands here until a person confirms it on the review
  // screen. `metrics` is jsonb keyed by lib/numbers/metrics.ts DAY_METRICS;
  // a missing key means "not read", never zero. A later confirmation merges
  // over an earlier one key by key (`metrics || excluded.metrics`).
  //
  // An audit is the same numbers for someone not on the roster yet — a
  // prospect. `subject` is either a model or an audit, never both.
  `create table if not exists transcriber.of_audits (
     id          text primary key,
     name        text not null,
     handle      text,
     page_type   text check (page_type in ('free', 'paid')),
     model_id    text references transcriber.models(id) on delete set null,
     notes       text,
     created_at  timestamptz not null default now(),
     updated_at  timestamptz not null default now()
   )`,
  `alter table transcriber.models
     add column if not exists of_page_type text check (of_page_type in ('free', 'paid')),
     add column if not exists of_price     numeric`,
  `create table if not exists transcriber.of_uploads (
     id           text primary key,
     model_id     text references transcriber.models(id) on delete cascade,
     audit_id     text references transcriber.of_audits(id) on delete cascade,
     kind         text not null check (kind in ('screenshot', 'csv')),
     blob_url     text,
     filename     text,
     status       text not null default 'read' check (status in ('read', 'confirmed', 'failed', 'discarded')),
     reading      jsonb,
     error        text,
     created_at   timestamptz not null default now(),
     confirmed_at timestamptz,
     check ((model_id is null) <> (audit_id is null))
   )`,
  `create index if not exists of_uploads_subject_idx on transcriber.of_uploads (model_id, audit_id, created_at desc)`,
  `create table if not exists transcriber.of_days (
     subject    text not null,
     day        date not null,
     metrics    jsonb not null default '{}',
     source     text not null,
     upload_id  text references transcriber.of_uploads(id) on delete set null,
     updated_at timestamptz not null default now(),
     primary key (subject, day)
   )`,
  `create table if not exists transcriber.of_periods (
     subject    text not null,
     date_from  date not null,
     date_to    date not null,
     metrics    jsonb not null default '{}',
     source     text not null,
     upload_id  text references transcriber.of_uploads(id) on delete set null,
     updated_at timestamptz not null default now(),
     primary key (subject, date_from, date_to)
   )`,
  `create table if not exists transcriber.of_links (
     subject     text not null,
     kind        text not null check (kind in ('tracking', 'trial')),
     name        text not null,
     captured_on date not null,
     range_from  date,
     range_to    date,
     source      text,
     clicks      numeric,
     subs        numeric,
     earnings    numeric,
     spenders    numeric,
     cost        numeric,
     upload_id   text references transcriber.of_uploads(id) on delete set null,
     primary key (subject, kind, name, captured_on)
   )`,
  // What happened on a day, for explaining spikes: mass messages read off a
  // screenshot, promos and price changes typed in. Reels come from
  // creator_posts and are not copied here.
  `create table if not exists transcriber.of_events (
     id         text primary key,
     subject    text not null,
     day        date not null,
     kind       text not null check (kind in ('mass_message', 'promo', 'price', 'shoutout', 'note')),
     label      text not null,
     strength   numeric,
     meta       jsonb not null default '{}',
     upload_id  text references transcriber.of_uploads(id) on delete set null,
     created_at timestamptz not null default now()
   )`,
  `create index if not exists of_events_subject_idx on transcriber.of_events (subject, day)`,
  // Films alone (2026-09-27, Susanna, the third time of asking): reels that
  // need someone else on camera are not added to her week and are folded off
  // her page. On for everyone; turned off per model in the console.
  `alter table transcriber.models
     add column if not exists solo boolean not null default true`,
  // She tapped "More like this" on a card. Relayed to her group like a
  // question; kept so the console can see what she wants more of.
  `alter table transcriber.plan_items
     add column if not exists more_at timestamptz`,
]

for (const statement of statements) {
  await sql.query(statement)
  console.log('ok:', statement.split('\n')[0].trim().slice(0, 68))
}
console.log('\nschema ready')
