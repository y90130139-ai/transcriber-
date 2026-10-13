'use client'

import { useEffect, useState } from 'react'
import type { SetupCheck } from '@/lib/reddit/settings'
import type { RedditSettings } from '@/lib/reddit/types'
import { timeAgo } from './bits'
import { postJson, putJson, useJson } from './useReddit'

type SettingsPayload = RedditSettings & {
  setup_checks: SetupCheck[]
  connection: {
    configured: boolean
    last_validated_at: string | null
    last_run_at: string | null
    last_run_state: string | null
  }
  registry: { candidates: number; unique: number; tracked: number }
}

type Draft = RedditSettings

/** Settings: connection and the setup checklist, the collector's budget and
 *  cadence, the engine's thresholds, alerts, the adult gate and retention.
 *  Everything here is what the server actually enforces — the page writes
 *  the same object the collector reads. */
export default function RedditSettings() {
  const { data, error, loading, reload } = useJson<SettingsPayload>('/api/reddit/settings')
  const [draft, setDraft] = useState<Draft | null>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [test, setTest] = useState<{ ok: boolean; detail: string; ms: number } | null>(null)

  useEffect(() => {
    if (data && !draft) {
      const { setup_checks, connection, registry, ...settings } = data
      void setup_checks; void connection; void registry
      setDraft(settings)
    }
  }, [data, draft])

  function set<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((current) => (current ? { ...current, [key]: value } : current))
  }

  function setAttestation(key: keyof Draft['attestations'], value: boolean) {
    setDraft((current) => current ? { ...current, attestations: { ...current.attestations, [key]: value } } : current)
  }

  async function save() {
    if (!draft) return
    setBusy(true)
    setNotice(null)
    try {
      const body = await putJson<{ settings: RedditSettings; adult_change: { enabled?: number; disabled?: number } }>(
        '/api/reddit/settings',
        {
          paused: draft.paused,
          emergency_stop: draft.emergency_stop,
          budget_per_run: draft.budget_per_run,
          min_interval_ms: draft.min_interval_ms,
          safety_ratio: draft.safety_ratio,
          retention_days: draft.retention_days,
          retention_post_days: draft.retention_post_days,
          high_interval_minutes: draft.high_interval_minutes,
          medium_interval_minutes: draft.medium_interval_minutes,
          low_interval_minutes: draft.low_interval_minutes,
          min_mentions: draft.min_mentions,
          breakout_interest: draft.breakout_interest,
          breakout_growth: draft.breakout_growth,
          alert_growth_pct: draft.alert_growth_pct,
          alert_velocity: draft.alert_velocity,
          alert_spread: draft.alert_spread,
          alerts_enabled: draft.alerts_enabled,
          adult_enabled: draft.adult_enabled,
          export_raw_enabled: draft.export_raw_enabled,
          attestations: draft.attestations,
          requirements_enabled: draft.requirements_enabled,
          requirements_interval_minutes: draft.requirements_interval_minutes,
          requirements_budget_per_run: draft.requirements_budget_per_run,
          requirements_sample_size: draft.requirements_sample_size,
          requirements_profile_batch: draft.requirements_profile_batch,
          discovery_enabled: draft.discovery_enabled,
          discovery_daily_cap: draft.discovery_daily_cap,
          discovery_per_pass: draft.discovery_per_pass,
          discovery_pages_per_keyword: draft.discovery_pages_per_keyword,
          discovery_min_subscribers: draft.discovery_min_subscribers,
          discovery_max_communities: draft.discovery_max_communities,
          content_scan_percent: draft.content_scan_percent,
        },
      )
      const change = body.adult_change?.enabled !== undefined ? ` · ${body.adult_change.enabled} adult communities enabled`
        : body.adult_change?.disabled !== undefined ? ` · ${body.adult_change.disabled} adult communities disabled` : ''
      setNotice(`Settings saved${change}.`)
      reload()
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy(false)
    }
  }

  async function testConnection() {
    setBusy(true)
    setTest(null)
    try {
      setTest(await postJson<{ ok: boolean; detail: string; ms: number }>('/api/reddit/collect', { mode: 'test' }))
    } catch (reason) {
      setTest({ ok: false, detail: reason instanceof Error ? reason.message : String(reason), ms: 0 })
    } finally {
      setBusy(false)
    }
  }

  if (error) return <div className="rt-page"><div className="rt-error"><b>Could not load settings</b><p>{error}</p></div></div>
  if (loading && !data) return <div className="rt-page"><div className="rt-skel"><i /><i /><i /><i /></div></div>
  if (!draft || !data) return null

  const connectionOk = data.connection.configured && data.connection.last_validated_at !== null

  return (
    <div className="rt-page">
      <div className="rt-toolbar">
        <div className="rt-toolbar-left">
          <span className="rt-health" data-tone={!data.connection.configured ? 'bad' : connectionOk ? 'ok' : 'warn'}>
            <i className="rt-beacon" aria-hidden />
            {!data.connection.configured ? 'Credentials not configured'
              : connectionOk ? 'Connected' : 'Not verified'}
          </span>
          <span className="rt-stamp">
            validated {timeAgo(data.connection.last_validated_at)} · run {timeAgo(data.connection.last_run_at)} ({data.connection.last_run_state ?? 'none'})
          </span>
        </div>
        <div className="rt-toolbar-right">
          <button type="button" className="rt-btn rt-btn-quiet" onClick={testConnection} disabled={busy}>Test connection</button>
          <button type="button" className="rt-btn" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save settings'}</button>
        </div>
      </div>

      {notice && <p className="rt-notice">{notice}</p>}
      {test && (
        <p className={`rt-notice ${test.ok ? '' : 'rt-notice-bad'}`}>
          {test.ok ? '✓' : '✕'} {test.detail}{test.ms ? ` (${test.ms}ms)` : ''}
        </p>
      )}

      <section className="rt-panel">
        <div className="rt-panel-head"><h2>Setup checklist</h2></div>
        <ul className="rt-checklist">
          {(data.setup_checks ?? []).map((item) => {
            const checked = item.verifiable
              ? data.connection.configured
              : draft.attestations[item.id as keyof Draft['attestations']] === true
            return (
              <li key={item.id}>
                <label>
                  <input type="checkbox" checked={checked} disabled={item.verifiable}
                    onChange={(event) => {
                      if (!item.verifiable) setAttestation(item.id as keyof Draft['attestations'], event.target.checked)
                    }} />
                  <span>
                    <b>{item.label}</b>
                    <span className="rt-dim">{item.detail}</span>
                  </span>
                </label>
              </li>
            )
          })}
        </ul>
        {!data.connection.configured && (
          <p className="rt-error-inline">
            Set REDDIT_CLIENT_ID and REDDIT_CLIENT_SECRET on the server, then Test connection.
          </p>
        )}
      </section>

      <div className="rt-columns">
        <section className="rt-panel">
          <div className="rt-panel-head"><h2>Collector</h2></div>
          <div className="rt-form">
            <label className="rt-switch"><input type="checkbox" checked={draft.paused} onChange={(event) => set('paused', event.target.checked)} /><span>Pause collection</span></label>
            <label className="rt-switch"><input type="checkbox" checked={draft.emergency_stop} onChange={(event) => set('emergency_stop', event.target.checked)} /><span>Emergency stop</span></label>
            <NumberField label="Requests per run" value={draft.budget_per_run} min={1} max={600} onChange={(value) => set('budget_per_run', value)} />
            <NumberField label="Minimum interval (ms)" value={draft.min_interval_ms} min={100} max={60000} onChange={(value) => set('min_interval_ms', value)} />
            <NumberField label="Rate-limit safety ratio (0.05–1)" value={draft.safety_ratio} min={0.05} max={1} step={0.05} onChange={(value) => set('safety_ratio', value)} />
            <NumberField label="High priority interval (min)" value={draft.high_interval_minutes} min={15} max={1440} onChange={(value) => set('high_interval_minutes', value)} />
            <NumberField label="Medium priority interval (min)" value={draft.medium_interval_minutes} min={15} max={1440} onChange={(value) => set('medium_interval_minutes', value)} />
            <NumberField label="Low priority interval (min)" value={draft.low_interval_minutes} min={15} max={1440} onChange={(value) => set('low_interval_minutes', value)} />
          </div>
        </section>

        <section className="rt-panel">
          <div className="rt-panel-head"><h2>Trend detection</h2></div>
          <div className="rt-form">
            <NumberField label="Minimum mentions for a loud status" value={draft.min_mentions} min={1} max={100} onChange={(value) => set('min_mentions', value)} />
            <NumberField label="Breakout interest threshold (0–100)" value={draft.breakout_interest} min={50} max={100} onChange={(value) => set('breakout_interest', value)} />
            <NumberField label="Breakout growth threshold (1 = +100%)" value={draft.breakout_growth} min={0} max={10} step={0.1} onChange={(value) => set('breakout_growth', value)} />
          </div>
        </section>

        <section className="rt-panel">
          <div className="rt-panel-head"><h2>Alerts</h2></div>
          <div className="rt-form">
            <label className="rt-switch"><input type="checkbox" checked={draft.alerts_enabled} onChange={(event) => set('alerts_enabled', event.target.checked)} /><span>Write alerts</span></label>
            <NumberField label="Growth alert threshold (%)" value={draft.alert_growth_pct} min={10} max={10000} onChange={(value) => set('alert_growth_pct', value)} />
            <NumberField label="Velocity alert threshold (units/hour)" value={draft.alert_velocity} min={10} max={1000000} onChange={(value) => set('alert_velocity', value)} />
            <NumberField label="Cross-community spread alert (communities)" value={draft.alert_spread} min={2} max={50} onChange={(value) => set('alert_spread', value)} />
          </div>
        </section>

        <section className="rt-panel">
          <div className="rt-panel-head"><h2>Adult content</h2></div>
          <div className="rt-form">
            <label className="rt-switch">
              <input type="checkbox" checked={draft.adult_enabled}
                onChange={(event) => {
                  if (event.target.checked && !draft.attestations.adult_authorized) {
                    setNotice('Tick the adult authorization attestation first.')
                    return
                  }
                  set('adult_enabled', event.target.checked)
                }} />
              <span>Enable adult-category tracking</span>
            </label>
            <label className="rt-switch">
              <input type="checkbox" checked={draft.attestations.adult_authorized}
                onChange={(event) => setAttestation('adult_authorized', event.target.checked)} />
              <span>Adult data authorization on file</span>
            </label>
          </div>
        </section>

        <section className="rt-panel">
          <div className="rt-panel-head"><h2>Data &amp; retention</h2></div>
          <div className="rt-form">
            <NumberField label="Aggregate retention (days)" value={draft.retention_days} min={30} max={3650} onChange={(value) => set('retention_days', value)} />
            <NumberField label="Post retention (days)" value={draft.retention_post_days} min={7} max={3650} onChange={(value) => set('retention_post_days', value)} />
            <label className="rt-switch">
              <input type="checkbox" checked={draft.export_raw_enabled}
                onChange={(event) => {
                  if (event.target.checked && !draft.attestations.commercial_written) {
                    setNotice('Tick the commercial-use attestation first.')
                    return
                  }
                  set('export_raw_enabled', event.target.checked)
                }} />
              <span>Allow post-metadata CSV export</span>
            </label>
          </div>
        </section>

        <section className="rt-panel">
          <div className="rt-panel-head"><h2>Registry</h2></div>
          <div className="rt-metrics">
            <div className="rt-metric"><span className="rt-metric-label">Starter candidates</span><b className="rt-metric-value">{data.registry.candidates}</b></div>
            <div className="rt-metric"><span className="rt-metric-label">Unique communities</span><b className="rt-metric-value">{data.registry.unique}</b></div>
            <div className="rt-metric"><span className="rt-metric-label">Tracked</span><b className="rt-metric-value">{data.registry.tracked}</b></div>
          </div>
        </section>

        <section className="rt-panel">
          <div className="rt-panel-head"><h2>Requirements board</h2></div>
          <div className="rt-form">
            <label className="rt-switch">
              <input type="checkbox" checked={draft.requirements_enabled}
                onChange={(event) => set('requirements_enabled', event.target.checked)} />
              <span>Requirements board</span>
            </label>
            <NumberField label="Sample cadence (min)" value={draft.requirements_interval_minutes} min={15} max={1440} onChange={(value) => set('requirements_interval_minutes', value)} />
            <NumberField label="Requests per pass" value={draft.requirements_budget_per_run} min={2} max={600} onChange={(value) => set('requirements_budget_per_run', value)} />
            <NumberField label="Posts per community" value={draft.requirements_sample_size} min={5} max={100} onChange={(value) => set('requirements_sample_size', value)} />
            <NumberField label="Account reads per community" value={draft.requirements_profile_batch} min={0} max={60} onChange={(value) => set('requirements_profile_batch', value)} />
          </div>
        </section>

        <section className="rt-panel">
          <div className="rt-panel-head"><h2>NSFW discovery</h2></div>
          <div className="rt-form">
            <label className="rt-switch">
              <input type="checkbox" checked={draft.discovery_enabled}
                onChange={(event) => set('discovery_enabled', event.target.checked)} />
              <span>Daily discovery sweep</span>
            </label>
            <NumberField label="Daily allowance (requests)" value={draft.discovery_daily_cap} min={1} max={5000} onChange={(value) => set('discovery_daily_cap', value)} />
            <NumberField label="Requests per sweep" value={draft.discovery_per_pass} min={1} max={500} onChange={(value) => set('discovery_per_pass', value)} />
            <NumberField label="Pages per keyword" value={draft.discovery_pages_per_keyword} min={1} max={10} onChange={(value) => set('discovery_pages_per_keyword', value)} />
            <NumberField label="Min. subscribers" value={draft.discovery_min_subscribers} min={0} max={1000000} onChange={(value) => set('discovery_min_subscribers', value)} />
            <NumberField label="Max communities (0 = no cap)" value={draft.discovery_max_communities} min={0} max={100000} onChange={(value) => set('discovery_max_communities', value)} />
            <NumberField label="Content share (%)" value={draft.content_scan_percent} min={0} max={100} onChange={(value) => set('content_scan_percent', value)} />
          </div>
        </section>
      </div>
    </div>
  )
}

function NumberField({
  label, hint, value, min, max, step = 1, onChange,
}: {
  label: string
  hint?: string
  value: number
  min: number
  max: number
  step?: number
  onChange: (value: number) => void
}) {
  return (
    <label className="rt-field">
      <span className="rt-field-label">{label}</span>
      <input className="rt-input" type="number" value={value} min={min} max={max} step={step}
        onChange={(event) => onChange(Number(event.target.value))} />
      {hint && <span className="rt-field-hint">{hint}</span>}
    </label>
  )
}
