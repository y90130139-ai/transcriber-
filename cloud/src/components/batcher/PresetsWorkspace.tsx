'use client'

import { memo, useState } from 'react'
import { getBatcherEngine } from '@/lib/batcher/engine'
import { useBatcher } from '@/lib/batcher/use-batcher'
import { Icon } from '@/components/console/ConsoleIcons'
import { formatRelative } from './format'

/** Presets — the whole configuration (effects, render, metadata) saved under
 *  a name, in the existing local database stack. Loading is instant and
 *  deterministic: it only ever replaces config, never batch identity. */
export const PresetsWorkspace = memo(function PresetsWorkspace() {
  const presets = useBatcher((snapshot) => snapshot.presets)
  const engine = getBatcherEngine()
  const [name, setName] = useState('')
  const [renaming, setRenaming] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')

  return (
    <div className="vb-presets">
      <div className="vb-effects-head">
        <div className="vb-effects-title">
          <h3>Presets</h3>
          <p>Save the current effects, quality and metadata as a preset for the next batch.</p>
        </div>
        <div className="vb-effects-actions">
          <input
            className="field vb-preset-name"
            placeholder="Preset name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                engine.savePreset(name)
                setName('')
              }
            }}
          />
          <button
            type="button"
            className="pill"
            data-primary="true"
            disabled={!name.trim()}
            onClick={() => {
              engine.savePreset(name)
              setName('')
            }}
          >
            <Icon name="plus" size={13} /> Save current
          </button>
        </div>
      </div>

      {presets.length === 0 ? (
        <div className="vb-empty">
          <p>No presets yet. Configure Effects, then save the setup here under a name.</p>
        </div>
      ) : (
        <ul className="vb-preset-list">
          {presets.map((preset) => (
            <li className="vb-preset" key={preset.id}>
              {renaming === preset.id ? (
                <input
                  className="field"
                  autoFocus
                  value={renameValue}
                  onChange={(event) => setRenameValue(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      engine.renamePreset(preset.id, renameValue)
                      setRenaming(null)
                    }
                    if (event.key === 'Escape') setRenaming(null)
                  }}
                  onBlur={() => {
                    engine.renamePreset(preset.id, renameValue)
                    setRenaming(null)
                  }}
                />
              ) : (
                <div className="vb-preset-copy">
                  <b>{preset.name}</b>
                  <span>updated {formatRelative(preset.updatedAt)}</span>
                </div>
              )}
              <div className="vb-preset-act">
                <button type="button" className="pill" onClick={() => engine.applyPreset(preset.id)}>
                  Load
                </button>
                <button
                  type="button"
                  className="pill"
                  onClick={() => {
                    setRenaming(preset.id)
                    setRenameValue(preset.name)
                  }}
                >
                  Rename
                </button>
                <button type="button" className="pill" onClick={() => engine.duplicatePreset(preset.id)}>
                  Duplicate
                </button>
                <button
                  type="button"
                  className="vb-iconbtn vb-iconbtn-danger"
                  aria-label={`Delete ${preset.name}`}
                  onClick={() => engine.deletePreset(preset.id)}
                >
                  <Icon name="trash" size={13} />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
})
