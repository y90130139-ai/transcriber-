-- ============================================================================
-- Gosian app · model accounts — Supabase setup
--
-- Run once in the Supabase SQL editor for the project referenced by
-- SUPABASE_URL (the shared Gosian project — same database as team_members and
-- creator_accounts). Safe to re-run.
--
-- Deliberately its own tables, the same way creator_accounts is: a model login
-- must never open the ai-invoice dashboard or the creator dashboard, and theirs
-- must never open the app.
--
-- `model_id` points at transcriber.models.id, which lives in Neon — a
-- different database, so there is no foreign key. Every read and write in
-- lib/model-accounts.ts filters by it explicitly instead.
-- ============================================================================

create extension if not exists pgcrypto;

-- -------------------------------------------------------------------- accounts

create table if not exists public.model_accounts (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  name text,
  model_id text,
  status text not null default 'invited' check (status in ('invited', 'active', 'disabled')),
  password_hash text,
  setup_token_hash text unique,
  setup_expires_at timestamptz,
  setup_sent_at timestamptz,
  setup_send_count integer not null default 0,
  last_login_at timestamptz,
  activated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists model_accounts_status_idx on public.model_accounts (status);
create index if not exists model_accounts_model_idx on public.model_accounts (model_id);

-- ------------------------------------------------------------ password resets

create table if not exists public.model_password_resets (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.model_accounts(id) on delete cascade,
  email text not null,
  token_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists model_password_resets_account_idx
  on public.model_password_resets (account_id);

-- --------------------------------------------------------------- updated_at

create or replace function public.set_model_row_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists model_accounts_set_updated_at on public.model_accounts;
create trigger model_accounts_set_updated_at
  before update on public.model_accounts
  for each row
  execute function public.set_model_row_updated_at();

-- --------------------------------------------------------------------- RLS
-- The app talks to Postgres exclusively with the service-role key from server
-- code. RLS is enabled with no public policies, so the anon key cannot read or
-- write these tables even if it leaks into a client bundle.

alter table public.model_accounts enable row level security;
alter table public.model_password_resets enable row level security;

-- ------------------------------------------------------------------ verify

select
  'model_accounts' as table_name,
  count(*) as rows
from public.model_accounts
union all
select 'model_password_resets', count(*) from public.model_password_resets;
