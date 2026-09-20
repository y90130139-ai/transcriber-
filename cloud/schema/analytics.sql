-- The analytics record: what each account posts, and how they are doing.
--
-- Deliberately *beside* `sightings`, not inside it. `sightings` is the reel
-- scoring pipeline — every row there is a reel with plays, and `candidates()`
-- measures each against its creator's median. Cadence needs the opposite: the
-- photos and carousels too, precisely because "2-3 carousels a week" cannot be
-- measured from a table that drops carousels. Mixing them would change the
-- score and its input in one step, which this project has a standing rule
-- against.
--
-- Handle-agnostic on purpose: the same two tables serve intel on the 196
-- watched creators and compliance on our own models' accounts.

-- One row per post, any type. Upserted, so re-sweeping a post updates its
-- counts and leaves its first sighting alone.
create table if not exists transcriber.creator_posts (
  post_id             text primary key,
  handle              text not null,
  posted_at           timestamptz,
  kind                text,           -- reel | carousel | photo
  product_type        text,           -- clips | feed
  carousel_count      int,
  plays               bigint,
  likes               bigint,
  comments            bigint,
  caption             text,
  audio_title         text,
  is_paid_partnership boolean,
  collaborators       text[],
  first_seen_at       timestamptz not null default now(),
  seen_at             timestamptz not null default now()
);
create index if not exists creator_posts_handle_posted
  on transcriber.creator_posts (handle, posted_at desc);

-- One row per account per sweep. A time series, because a single reading
-- cannot show growth, and because stories expire in 24h: only repeated
-- snapshots can say whether someone posts stories at all.
create table if not exists transcriber.creator_snapshots (
  handle       text not null,
  seen_at      timestamptz not null default now(),
  followers    bigint,
  posts        bigint,
  story_at     timestamptz,   -- latest_reel_media, null when there is none live
  has_story    boolean,
  highlights   int,
  is_private   boolean,
  is_verified  boolean,
  primary key (handle, seen_at)
);
create index if not exists creator_snapshots_handle_seen
  on transcriber.creator_snapshots (handle, seen_at desc);
