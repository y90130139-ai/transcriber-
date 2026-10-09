/**
 * Batcher telemetry (§44) — a hard allowlist, local only.
 *
 * The console has no client-side event pipeline, so the batcher does not
 * invent one: events are validated against an allowlist, kept in a small
 * in-memory ring for the diagnostics drawer, and logged in development.
 * Media bytes, captions, local paths and full filenames never enter here by
 * construction — there is no property on the allowlist that can carry them.
 */

export type BatcherEvent =
  | 'video_batcher_opened'
  | 'engine_loaded'
  | 'batch_started'
  | 'variation_completed'
  | 'batch_completed'
  | 'batch_failed'

const ALLOWED_EVENTS = new Set<BatcherEvent>([
  'video_batcher_opened',
  'engine_loaded',
  'batch_started',
  'variation_completed',
  'batch_completed',
  'batch_failed',
])

const ALLOWED_PROPERTIES = new Set([
  'engine_load_ms',
  'processing_seconds',
  'variation_count',
  'resolution_category',
  'engine',
  'workers',
  'quality',
  'error_kind',
  'completed',
  'failed',
])

export type TelemetryRecord = { at: number; event: BatcherEvent; props: Record<string, string | number> }

const ring: TelemetryRecord[] = []
const DEV = process.env.NODE_ENV !== 'production'

export function track(event: BatcherEvent, props: Record<string, unknown> = {}): void {
  if (!ALLOWED_EVENTS.has(event)) return
  const safe: Record<string, string | number> = {}
  for (const [key, value] of Object.entries(props)) {
    if (!ALLOWED_PROPERTIES.has(key)) continue
    if (typeof value === 'number' && Number.isFinite(value)) safe[key] = Math.round(value * 100) / 100
    else if (typeof value === 'string') safe[key] = value.slice(0, 40)
  }
  const record: TelemetryRecord = { at: Date.now(), event, props: safe }
  ring.push(record)
  if (ring.length > 50) ring.shift()
  if (DEV) console.debug('[batcher]', event, safe)
}

export function telemetryLog(): TelemetryRecord[] {
  return ring.slice()
}
