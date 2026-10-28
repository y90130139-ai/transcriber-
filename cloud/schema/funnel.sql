-- Whether each model's traffic has somewhere to land, one row per account
-- per day.
--
-- Three surfaces can carry a funnel link and only one has to work: the bio, a
-- highlight, a live story. A model with none of the three is posting into a
-- dead end, and on 2026-10-28 that was 53 of 60 accounts.
--
-- The reading is taken on Geno's Mac, because Instagram will not accept a
-- logged-in session from a datacenter IP, and posted here. The Mac keeps
-- nothing: this table is the history, which is what makes the domain ledger
-- below possible at all.
--
-- One row per account per DAY, not per reading. A second scan on the same day
-- corrects the first rather than appending, so "how many days was this link
-- up" stays a count of rows.

create table if not exists transcriber.funnel_readings (
  handle        text        not null,
  read_on       date        not null,
  -- green: a known selling link is in the bio, proven.
  -- amber: something might carry one - an unrecognised host, a highlight, a
  --        live story. A queue, not a pass mark.
  -- red:   no bio link, no highlight, no story. Dark.
  -- unknown: the bio field was absent from the payload. NOT the same as empty,
  --        and the distinction is the whole point of the column.
  state         text        not null,
  -- The link the verdict was reached on, not the first one in the bio: a shop
  -- or a Threads badge would make this disagree with the state beside it.
  bio_url       text,
  has_story     boolean,
  highlights    int,
  followers     bigint,
  is_private    boolean,
  creator       text,
  read_at       timestamptz not null,
  primary key (handle, read_on)
);

create index if not exists funnel_readings_day
  on transcriber.funnel_readings (read_on desc);
create index if not exists funnel_readings_handle
  on transcriber.funnel_readings (handle, read_on desc);

-- A host confirmed by a human as a real selling destination. An unrecognised
-- domain reads amber precisely because one 348K bio held a press article
-- about a jeweller; once someone has looked, it is green from then on.
create table if not exists transcriber.funnel_confirmed_hosts (
  host        text primary key,
  confirmed_at timestamptz not null default now(),
  note        text
);

-- The money beside the link, so the page can rank "what to do today" by what
-- it is worth rather than by follower count. Pushed by the same daily job:
-- the Infloww mirror stays on the Mac and only this summary travels.
create table if not exists transcriber.roster_money (
  creator    text   not null,
  read_on    date   not null,
  chat       boolean,
  tier       text,          -- safe | hold | push | stretch | out
  sep_full   bigint,        -- cents, her own September
  oct_net    bigint,        -- cents, month to the last settled day
  gap        bigint,        -- cents still to earn to match September
  week_now   bigint,        -- cents, her last 7 settled days
  week_peak  bigint,        -- cents, the roster's peak week (Sep 14)
  primary key (creator, read_on)
);

create index if not exists roster_money_day
  on transcriber.roster_money (read_on desc);
