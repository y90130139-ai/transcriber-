/**
 * Browser capability detection (§37). Never assumes an API exists; every
 * feature the engine leans on is probed once and reported to the UI. The
 * console shows plain language; the diagnostics drawer shows this object.
 */
import type { Capabilities } from './types'

type NavigatorWithHints = Navigator & {
  deviceMemory?: number
  userAgentData?: { platform?: string }
}

export function detectCapabilities(): Capabilities {
  const nav = navigator as NavigatorWithHints
  const isolated = typeof self !== 'undefined' && self.crossOriginIsolated === true
  return {
    wasm: typeof WebAssembly === 'object',
    workers: typeof Worker !== 'undefined',
    sharedArrayBuffer: isolated && typeof SharedArrayBuffer !== 'undefined',
    crossOriginIsolated: isolated,
    opfs: typeof navigator.storage?.getDirectory === 'function',
    // The sync access handle is worker-only; the processing worker reports
    // whether its first write used one. Optimistic default for display.
    opfsSyncAccess: typeof navigator.storage?.getDirectory === 'function',
    fileSystemAccess: typeof (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker === 'function',
    webCodecs: typeof (self as unknown as { VideoDecoder?: unknown }).VideoDecoder !== 'undefined',
    hardwareConcurrency: Math.max(1, nav.hardwareConcurrency || 4),
    deviceMemoryGb: typeof nav.deviceMemory === 'number' ? nav.deviceMemory : null,
    storageQuotaBytes: null,
  }
}

export async function enrichStorageQuota(capabilities: Capabilities): Promise<Capabilities> {
  try {
    const estimate = await navigator.storage?.estimate?.()
    return { ...capabilities, storageQuotaBytes: estimate?.quota ?? null }
  } catch {
    return capabilities
  }
}

/**
 * Worker-count policy (§8). Conservative by design — too many concurrent
 * FFmpeg instances make a machine slower, not faster, because each instance
 * owns a full wasm heap and they fight for the same cores.
 */
export function recommendedWorkers(
  capabilities: Capabilities,
  multithreaded: boolean,
  weight: { megapixels: number; durationSeconds: number | null; fileBytes: number },
): { workers: number; threadsPerJob: number; reason: string | null } {
  const cores = capabilities.hardwareConcurrency
  let workers = multithreaded
    ? cores >= 16
      ? 3
      : cores >= 8
        ? 2
        : 1
    : cores >= 16
      ? 4
      : cores >= 8
        ? 3
        : cores >= 4
          ? 2
          : 1
  let reason: string | null = null

  if (capabilities.deviceMemoryGb != null) {
    if (capabilities.deviceMemoryGb <= 2 && workers > 1) {
      workers = 1
      reason = 'low memory reported by the browser'
    } else if (capabilities.deviceMemoryGb <= 4 && workers > 2) {
      workers = 2
      reason = 'limited memory reported by the browser'
    }
  }

  const heavy =
    weight.megapixels >= 7 ||
    (weight.durationSeconds != null && weight.durationSeconds > 240) ||
    weight.fileBytes > 1.5 * 1024 * 1024 * 1024
  if (heavy && workers > 2) {
    workers = 2
    reason = 'large source detected'
  }
  const veryHeavy = weight.megapixels >= 12 || weight.fileBytes > 3 * 1024 * 1024 * 1024
  if (veryHeavy && workers > 1) {
    workers = 1
    reason = 'very large source detected'
  }

  const threadsPerJob = multithreaded ? Math.max(1, Math.min(4, Math.floor(cores / workers))) : 1
  return { workers, threadsPerJob, reason }
}

export function resolutionCategory(probe: { width: number | null; height: number | null }): string {
  const shorter = Math.min(probe.width ?? 0, probe.height ?? 0)
  if (shorter >= 2160) return '4k'
  if (shorter >= 1440) return '1440p'
  if (shorter >= 1080) return '1080p'
  if (shorter >= 720) return '720p'
  if (shorter > 0) return 'sd'
  return 'unknown'
}
