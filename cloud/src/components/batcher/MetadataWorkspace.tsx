'use client'

import { memo } from 'react'
import { getBatcherEngine } from '@/lib/batcher/engine'
import { useBatcher } from '@/lib/batcher/use-batcher'

/** Metadata — the legitimate controls (§22): preserve, strip location data,
 *  title/comment, and the deterministic per-variation provenance tag. */
export const MetadataWorkspace = memo(function MetadataWorkspace() {
  const metadata = useBatcher((snapshot) => snapshot.config.metadata)
  const engine = getBatcherEngine()

  return (
    <div className="vb-metadata">
      <div className="vb-effects-head">
        <div className="vb-effects-title">
          <h3>Metadata</h3>
          <p>What the exported file carries. These are ordinary container tags — nothing is faked.</p>
        </div>
      </div>

      <div className="vb-card">
        <header className="vb-card-head">
          <h4>Privacy</h4>
        </header>
        <div className="vb-card-body">
          <label className="vb-toggle">
            <input
              type="checkbox"
              checked={metadata.stripGps}
              onChange={(event) => engine.setMetadata({ stripGps: event.target.checked })}
            />
            <span>
              <b>Strip location metadata</b>
              <em>Removes GPS / location tags from the source when writing the output.</em>
            </span>
          </label>
        </div>
      </div>

      <div className="vb-card">
        <header className="vb-card-head">
          <h4>Tags</h4>
        </header>
        <div className="vb-card-body">
          <label className="vb-text-row">
            <span>Title</span>
            <input
              className="field"
              value={metadata.title}
              placeholder="Leave empty to keep the source title"
              onChange={(event) => engine.setMetadata({ title: event.target.value })}
            />
          </label>
          <label className="vb-text-row">
            <span>Comment</span>
            <input
              className="field"
              value={metadata.comment}
              placeholder="Optional"
              onChange={(event) => engine.setMetadata({ comment: event.target.value })}
            />
          </label>
          <label className="vb-toggle">
            <input
              type="checkbox"
              checked={metadata.variationTag}
              onChange={(event) => engine.setMetadata({ variationTag: event.target.checked })}
            />
            <span>
              <b>Tag each variation</b>
              <em>Writes “variation 3 seed 481… batch 9f2…” into the file’s description — provenance for a batch.</em>
            </span>
          </label>
        </div>
      </div>
    </div>
  )
})
