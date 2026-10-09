/**
 * Settings and preferences. One global row (reddit.settings) and one
 * preference row (reddit.user_tracking_preferences); both are jsonb so a
 * new knob does not need a migration. The defaults below are the values the
 * collector actually runs with — conservative by construction, because the
 * brief's rule is that the effective budget never exceeds what Reddit's
 * own headers say we may use.
 */

import { q, sql } from '../db'
import type { RedditPreferences, RedditSettings } from './types'

export const DEFAULT_SETTINGS: RedditSettings = {
  paused: false,
  emergency_stop: false,
  // Requests per run. Conservative on purpose: enough to validate and
  // refresh a handful of communities' listings per invocation, nowhere near
  // claiming a quota we were not granted.
  budget_per_run: 40,
  // Floor between requests; the header arithmetic can only slow this down.
  min_interval_ms: 1100,
  // Fraction of the reported remaining quota we allow ourselves.
  safety_ratio: 0.5,
  // Even if a scheduler misbehaves, never exceed this in any clock hour.
  hourly_cap: 400,
  // The monitoring budget: an internal ceiling of 5,000 requests a day and
  // a 5-per-minute normal throttle. Internal limits, not Reddit guarantees —
  // the provider's own headers always win when they are stricter.
  daily_cap: 5000,
  requests_per_minute: 5,
  rate_cooldown_until: null,
  retention_days: 400,
  retention_post_days: 180,
  // One scan a day for everything; twice for high priority. Busy
  // communities earn shorter gaps via the activity scale; the 80–95%
  // spread keeps due times from arriving in one wave.
  high_interval_minutes: 720,
  medium_interval_minutes: 1440,
  low_interval_minutes: 1440,
  min_mentions: 3,
  breakout_interest: 76,
  breakout_growth: 1,
  alert_growth_pct: 150,
  alert_velocity: 500,
  alert_spread: 3,
  alerts_enabled: true,
  adult_enabled: true,
  // The section is adult-communities-only: collection and every view are
  // scoped to them.
  adult_only: true,
  export_raw_enabled: false,
  attestations: {
    app_registered: false,
    oauth_scopes: false,
    analytics_permitted: false,
    commercial_written: false,
    adult_authorized: false,
  },
  // The requirements board starts gentle: every community once a day (the
  // spread keeps the wave from arriving at once), a small budget per pass so
  // a manual run answers within seconds, and enough samples to estimate
  // without owning the rate limit.
  requirements_enabled: true,
  requirements_interval_minutes: 1440,
  requirements_budget_per_run: 60,
  requirements_sample_size: 25,
  requirements_profile_batch: 20,
  // The daily hunt for new NSFW communities: up to 1,000 requests a day,
  // every one of them a subreddit search page, paced by the shared client
  // and counted against the same daily cap as everything else.
  discovery_enabled: true,
  discovery_daily_cap: 1000,
  discovery_per_pass: 25,
  discovery_min_subscribers: 500,
}

export const DEFAULT_PREFERENCES: RedditPreferences = {
  range: '24h',
  from: null,
  to: null,
  saved_searches: [],
  density: 'comfortable',
}

export async function getSettings(): Promise<RedditSettings> {
  const rows = await q<{ values: Partial<RedditSettings> }>(
    `select values from reddit.settings where id = 'global'`,
  )
  const stored = rows[0]?.values ?? {}
  return {
    ...DEFAULT_SETTINGS,
    ...stored,
    adult_only: true,
    attestations: { ...DEFAULT_SETTINGS.attestations, ...(stored.attestations ?? {}) },
  }
}

export async function saveSettings(patch: Partial<RedditSettings>): Promise<RedditSettings> {
  const current = await getSettings()
  const next: RedditSettings = {
    ...current,
    ...patch,
    adult_only: true,
    attestations: { ...current.attestations, ...(patch.attestations ?? {}) },
  }
  await sql.query(
    `insert into reddit.settings (id, values, updated_at)
     values ('global', $1::jsonb, now())
     on conflict (id) do update set values = excluded.values, updated_at = now()`,
    [JSON.stringify(next)],
  )
  return next
}

export async function getPreferences(): Promise<RedditPreferences> {
  const rows = await q<{ prefs: Partial<RedditPreferences> }>(
    `select prefs from reddit.user_tracking_preferences where id = 'owner'`,
  )
  return { ...DEFAULT_PREFERENCES, ...(rows[0]?.prefs ?? {}) }
}

export async function savePreferences(patch: Partial<RedditPreferences>): Promise<RedditPreferences> {
  const current = await getPreferences()
  const next: RedditPreferences = { ...current, ...patch }
  await sql.query(
    `insert into reddit.user_tracking_preferences (id, prefs, updated_at)
     values ('owner', $1::jsonb, now())
     on conflict (id) do update set prefs = excluded.prefs, updated_at = now()`,
    [JSON.stringify(next)],
  )
  return next
}

/** Effective interval for a priority, from settings. */
export function intervalFor(settings: RedditSettings, priority: 'high' | 'medium' | 'low'): number {
  if (priority === 'high') return settings.high_interval_minutes
  if (priority === 'low') return settings.low_interval_minutes
  return settings.medium_interval_minutes
}

/** The setup checklist, as the Settings page renders it. Each line is
 *  either verifiable by us (credentials, token, read access) or an
 *  attestation a human ticks; nothing is auto-certified. */
export type SetupCheck = {
  id: string
  label: string
  detail: string
  verifiable: boolean
}

export const SETUP_CHECKS: SetupCheck[] = [
  {
    id: 'app_registered',
    label: 'Reddit application registered and API access approved',
    detail: 'An app of type "script" or "web app" in your Reddit account, with its client id and secret.',
    verifiable: false,
  },
  {
    id: 'oauth_scopes',
    label: 'OAuth credentials configured with read scope only',
    detail: 'REDDIT_CLIENT_ID and REDDIT_CLIENT_SECRET reach the server; the token exchange succeeds.',
    verifiable: true,
  },
  {
    id: 'analytics_permitted',
    label: 'Permission for this analytics use case',
    detail: 'Reddit\'s terms and your app approval cover trend analytics of public posts.',
    verifiable: false,
  },
  {
    id: 'commercial_written',
    label: 'Written commercial-use authorization, where required',
    detail: 'If this collects data for a commercial product, keep the written authorization on file.',
    verifiable: false,
  },
  {
    id: 'adult_authorized',
    label: 'Authorization for any adult/restricted community data',
    detail: 'Required before adult-category tracking can be enabled; the API must also grant access.',
    verifiable: false,
  },
]
