'use client'

import { memo } from 'react'
import { useBatcher } from '@/lib/batcher/use-batcher'
import { telemetryLog } from '@/lib/batcher/telemetry'
import { formatBytes, formatDuration } from './format'

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="vb-diag-row">
      <span>{label}</span>
      <b>{value}</b>
    </div>
  )
}

/** Diagnostics — the technical truth, collapsed by default (§38). The engine
 *  chip in plain language is for everyone; this drawer is for whoever needs
 *  to know why a machine is running in limited mode. */
export const Diagnostics = memo(function Diagnostics() {
  const capabilities = useBatcher((snapshot) => snapshot.capabilities)
  const perf = useBatcher((snapshot) => snapshot.perf)
  const multithreaded = useBatcher((snapshot) => snapshot.multithreaded)
  const engineDetail = useBatcher((snapshot) => snapshot.engineDetail)

  const events = telemetryLog().slice(-8).reverse()

  return (
    <details className="vb-diag">
      <summary>Diagnostics</summary>
      <div className="vb-diag-body">
        {engineDetail && <p className="vb-diag-detail">{engineDetail}</p>}
        <div className="vb-diag-cols">
          <div>
            <h5>Browser</h5>
            {capabilities ? (
              <>
                <Row label="WebAssembly" value={capabilities.wasm ? 'yes' : 'no'} />
                <Row label="Web Workers" value={capabilities.workers ? 'yes' : 'no'} />
                <Row label="SharedArrayBuffer" value={capabilities.sharedArrayBuffer ? 'yes' : 'no (single-threaded)'} />
                <Row label="OPFS" value={capabilities.opfs ? 'yes' : 'no'} />
                <Row label="OPFS sync writes" value={capabilities.opfsSyncAccess ? 'yes' : 'no'} />
                <Row label="File System Access" value={capabilities.fileSystemAccess ? 'yes' : 'no'} />
                <Row label="WebCodecs" value={capabilities.webCodecs ? 'yes' : 'no'} />
                <Row label="CPU threads" value={String(capabilities.hardwareConcurrency)} />
                <Row label="Device memory" value={capabilities.deviceMemoryGb ? `≥ ${capabilities.deviceMemoryGb} GB` : 'not reported'} />
                <Row label="Storage quota" value={formatBytes(capabilities.storageQuotaBytes)} />
              </>
            ) : (
              <p className="vb-diag-detail">Detecting…</p>
            )}
          </div>
          <div>
            <h5>Engine</h5>
            <Row label="Mode" value={multithreaded ? 'multithreaded WASM' : 'single-threaded WASM'} />
            <Row label="Engine load" value={perf.engineLoadMs != null ? `${perf.engineLoadMs} ms` : '—'} />
            <Row label="First probe" value={perf.timeToFirstProbeMs != null ? `${perf.timeToFirstProbeMs} ms` : '—'} />
            <Row
              label="First render started"
              value={perf.timeToFirstRenderMs != null ? `${perf.timeToFirstRenderMs} ms after Generate` : '—'}
            />
            <Row label="Last batch" value={perf.lastBatchMs != null ? `${formatDuration(perf.lastBatchMs / 1000)} for ${perf.lastBatchJobs} variations` : '—'} />
            <Row label="Average variation" value={perf.averageJobMs != null ? `${Math.round(perf.averageJobMs / 100) / 10}s` : '—'} />
            <Row label="Completed / failed" value={`${perf.jobsCompleted} / ${perf.jobsFailed}`} />
            <Row label="Memory failures" value={String(perf.memoryFailures)} />
            {perf.lastStages && (
              <Row
                label="Last stages"
                value={`mount ${perf.lastStages.inputWriteMs ?? 0} ms · encode ${perf.lastStages.processingMs ?? 0} ms · write ${perf.lastStages.outputReadMs ?? 0} ms`}
              />
            )}
          </div>
        </div>
        {events.length > 0 && (
          <div>
            <h5>Events (local only)</h5>
            <ul className="vb-diag-events">
              {events.map((event, index) => (
                <li key={`${event.at}-${index}`}>
                  <b>{event.event}</b>
                  <span>
                    {Object.entries(event.props)
                      .map(([key, value]) => `${key}=${value}`)
                      .join(' ')}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </details>
  )
})
