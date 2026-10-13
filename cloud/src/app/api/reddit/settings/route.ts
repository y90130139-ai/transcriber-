import { NextResponse } from 'next/server'
import { isSignedIn } from '@/lib/auth'
import { redditConfigured } from '@/lib/reddit/client'
import {
  DEFAULT_SETTINGS,
  getSettings,
  saveSettings,
  SETUP_CHECKS,
  type SetupCheck,
} from '@/lib/reddit/settings'
import {
  disableAdultSubreddits,
  enableValidatedAdultSubreddits,
  registryCounts,
} from '@/lib/reddit/store'
import { q } from '@/lib/db'

type SettingsPayload = Awaited<ReturnType<typeof getSettings>> & {
  setup_checks: SetupCheck[]
  connection: {
    configured: boolean
    last_validated_at: string | null
    last_run_at: string | null
    last_run_state: string | null
  }
  registry: { candidates: number; unique: number; tracked: number }
}

async function payload(): Promise<SettingsPayload> {
  const [settings, validation, lastRun, tracked] = await Promise.all([
    getSettings(),
    q<{ at: string | null }>(`select max(validated_at) as at from reddit.tracked_subreddits where adult`),
    q<{ started_at: string; state: string }>(
      `select started_at, state from reddit.collector_runs order by started_at desc limit 1`,
    ),
    q<{ n: number }>(`select count(*)::int as n from reddit.tracked_subreddits where adult`),
  ])
  return {
    ...settings,
    setup_checks: SETUP_CHECKS,
    connection: {
      configured: redditConfigured(),
      last_validated_at: validation[0]?.at ?? null,
      last_run_at: lastRun[0]?.started_at ?? null,
      last_run_state: lastRun[0]?.state ?? null,
    },
    registry: { ...registryCounts(), tracked: Number(tracked[0]?.n ?? 0) },
  }
}

export async function GET() {
  if (!(await isSignedIn())) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  try {
    return NextResponse.json(await payload())
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 })
  }
}

const clamp = (value: number, lo: number, hi: number, fallback: number) =>
  Number.isFinite(value) ? Math.min(hi, Math.max(lo, Math.round(value))) : fallback

/** Save the knobs. The adult and raw-export gates have attestation
 *  prerequisites and are refused without them — the API enforces what the
 *  checklist states, rather than trusting the UI. */
export async function PUT(request: Request) {
  if (!(await isSignedIn())) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  try {
    const body = await request.json().catch(() => ({}))
    const current = await getSettings()
    const patch: Partial<typeof current> = {}

    for (const key of ['paused', 'emergency_stop', 'alerts_enabled', 'export_raw_enabled', 'requirements_enabled'] as const) {
      if (body[key] !== undefined) patch[key] = Boolean(body[key])
    }
    if (body.budget_per_run !== undefined) patch.budget_per_run = clamp(Number(body.budget_per_run), 1, 600, DEFAULT_SETTINGS.budget_per_run)
    if (body.min_interval_ms !== undefined) patch.min_interval_ms = clamp(Number(body.min_interval_ms), 100, 60_000, DEFAULT_SETTINGS.min_interval_ms)
    if (body.safety_ratio !== undefined) {
      const ratio = Number(body.safety_ratio)
      patch.safety_ratio = Number.isFinite(ratio) ? Math.min(1, Math.max(0.05, ratio)) : DEFAULT_SETTINGS.safety_ratio
    }
    if (body.retention_days !== undefined) patch.retention_days = clamp(Number(body.retention_days), 30, 3650, DEFAULT_SETTINGS.retention_days)
    if (body.retention_post_days !== undefined) patch.retention_post_days = clamp(Number(body.retention_post_days), 7, 3650, DEFAULT_SETTINGS.retention_post_days)
    if (body.high_interval_minutes !== undefined) patch.high_interval_minutes = clamp(Number(body.high_interval_minutes), 15, 1440, DEFAULT_SETTINGS.high_interval_minutes)
    if (body.medium_interval_minutes !== undefined) patch.medium_interval_minutes = clamp(Number(body.medium_interval_minutes), 15, 1440, DEFAULT_SETTINGS.medium_interval_minutes)
    if (body.low_interval_minutes !== undefined) patch.low_interval_minutes = clamp(Number(body.low_interval_minutes), 15, 1440, DEFAULT_SETTINGS.low_interval_minutes)
    if (body.min_mentions !== undefined) patch.min_mentions = clamp(Number(body.min_mentions), 1, 100, DEFAULT_SETTINGS.min_mentions)
    if (body.breakout_interest !== undefined) patch.breakout_interest = clamp(Number(body.breakout_interest), 50, 100, DEFAULT_SETTINGS.breakout_interest)
    if (body.breakout_growth !== undefined) {
      const growth = Number(body.breakout_growth)
      patch.breakout_growth = Number.isFinite(growth) ? Math.min(10, Math.max(0, growth)) : DEFAULT_SETTINGS.breakout_growth
    }
    if (body.alert_growth_pct !== undefined) patch.alert_growth_pct = clamp(Number(body.alert_growth_pct), 10, 10_000, DEFAULT_SETTINGS.alert_growth_pct)
    if (body.alert_velocity !== undefined) patch.alert_velocity = clamp(Number(body.alert_velocity), 10, 1_000_000, DEFAULT_SETTINGS.alert_velocity)
    if (body.alert_spread !== undefined) patch.alert_spread = clamp(Number(body.alert_spread), 2, 50, DEFAULT_SETTINGS.alert_spread)
    if (body.hourly_cap !== undefined) patch.hourly_cap = clamp(Number(body.hourly_cap), 1, 2000, DEFAULT_SETTINGS.hourly_cap)
    if (body.daily_cap !== undefined) patch.daily_cap = clamp(Number(body.daily_cap), 1, 100_000, DEFAULT_SETTINGS.daily_cap)
    if (body.requests_per_minute !== undefined) {
      const rpm = Number(body.requests_per_minute)
      patch.requests_per_minute = Number.isFinite(rpm) ? Math.min(600, Math.max(0.1, rpm)) : DEFAULT_SETTINGS.requests_per_minute
    }
    if (body.requirements_interval_minutes !== undefined) {
      patch.requirements_interval_minutes = clamp(Number(body.requirements_interval_minutes), 15, 1440, DEFAULT_SETTINGS.requirements_interval_minutes)
    }
    if (body.requirements_budget_per_run !== undefined) {
      patch.requirements_budget_per_run = clamp(Number(body.requirements_budget_per_run), 2, 600, DEFAULT_SETTINGS.requirements_budget_per_run)
    }
    if (body.requirements_sample_size !== undefined) {
      patch.requirements_sample_size = clamp(Number(body.requirements_sample_size), 5, 100, DEFAULT_SETTINGS.requirements_sample_size)
    }
    if (body.requirements_profile_batch !== undefined) {
      patch.requirements_profile_batch = clamp(Number(body.requirements_profile_batch), 0, 60, DEFAULT_SETTINGS.requirements_profile_batch)
    }
    if (body.discovery_enabled !== undefined) patch.discovery_enabled = Boolean(body.discovery_enabled)
    if (body.discovery_daily_cap !== undefined) {
      patch.discovery_daily_cap = clamp(Number(body.discovery_daily_cap), 1, 5000, DEFAULT_SETTINGS.discovery_daily_cap)
    }
    if (body.discovery_per_pass !== undefined) {
      patch.discovery_per_pass = clamp(Number(body.discovery_per_pass), 1, 500, DEFAULT_SETTINGS.discovery_per_pass)
    }
    if (body.discovery_pages_per_keyword !== undefined) {
      patch.discovery_pages_per_keyword = clamp(Number(body.discovery_pages_per_keyword), 1, 10, DEFAULT_SETTINGS.discovery_pages_per_keyword)
    }
    if (body.discovery_min_subscribers !== undefined) {
      patch.discovery_min_subscribers = clamp(Number(body.discovery_min_subscribers), 0, 1_000_000, DEFAULT_SETTINGS.discovery_min_subscribers)
    }
    if (body.discovery_max_communities !== undefined) {
      patch.discovery_max_communities = clamp(Number(body.discovery_max_communities), 0, 100_000, DEFAULT_SETTINGS.discovery_max_communities)
    }
    if (body.content_scan_percent !== undefined) {
      patch.content_scan_percent = clamp(Number(body.content_scan_percent), 0, 100, DEFAULT_SETTINGS.content_scan_percent)
    }
    if (body.rate_cooldown_until !== undefined) {
      const value = body.rate_cooldown_until
      patch.rate_cooldown_until = typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? value : null
    }
    if (body.attestations && typeof body.attestations === 'object') {
      patch.attestations = { ...current.attestations, ...body.attestations }
    }

    const attestations = { ...current.attestations, ...(patch.attestations ?? {}) }
    if (body.adult_enabled !== undefined) {
      const wanted = Boolean(body.adult_enabled)
      if (wanted && !attestations.adult_authorized) {
        return NextResponse.json(
          { error: 'Confirm the adult-data authorization attestation before enabling adult categories' },
          { status: 400 },
        )
      }
      patch.adult_enabled = wanted
    }
    if (patch.export_raw_enabled && !attestations.commercial_written) {
      return NextResponse.json(
        { error: 'Raw-content export needs the commercial-use authorization attestation first' },
        { status: 400 },
      )
    }

    const saved = await saveSettings(patch)
    let adultChange: { enabled?: number; disabled?: number } = {}
    if (saved.adult_enabled !== current.adult_enabled) {
      adultChange = saved.adult_enabled
        ? { enabled: await enableValidatedAdultSubreddits() }
        : { disabled: await disableAdultSubreddits() }
    }
    return NextResponse.json({ ok: true, settings: saved, adult_change: adultChange })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 })
  }
}
