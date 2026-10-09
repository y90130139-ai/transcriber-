'use client'

import { memo, useMemo } from 'react'
import { getBatcherEngine } from '@/lib/batcher/engine'
import { useBatcher } from '@/lib/batcher/use-batcher'
import { Icon } from '@/components/console/ConsoleIcons'
import {
  EFFECT_DEFINITIONS,
  EFFECT_SECTIONS,
  buildDefaultEffectSettings,
  buildRandomizedEffectSettings,
  validateEffectSetting,
  type EffectDefinition,
} from '@/lib/batcher/effect-defs'
import type { EffectSetting } from '@/lib/batcher/types'

function EffectRow({
  setting,
  definition,
  onChange,
}: {
  setting: EffectSetting
  definition: EffectDefinition
  onChange: (next: EffectSetting) => void
}) {
  const error = setting.enabled ? validateEffectSetting(setting) : null

  const commit = (patch: Partial<EffectSetting>) => {
    const next = { ...setting, ...patch }
    onChange(next)
  }

  const parse = (value: string, fallback: number): number => {
    const parsed = Number.parseFloat(value)
    return Number.isFinite(parsed) ? parsed : fallback
  }

  return (
    <div className="vb-effect" data-on={setting.enabled} data-error={error ? 'true' : undefined}>
      <label className="vb-effect-check">
        <input
          type="checkbox"
          checked={setting.enabled}
          onChange={(event) => commit({ enabled: event.target.checked })}
          aria-label={`Enable ${definition.label}`}
        />
      </label>
      <div className="vb-effect-copy">
        <b>{definition.label}</b>
        <span>{definition.description}</span>
      </div>
      <div className="vb-effect-range">
        <span className="vb-effect-word">min</span>
        <input
          type="number"
          inputMode="decimal"
          step={definition.step}
          disabled={!setting.enabled}
          value={setting.min}
          onChange={(event) => commit({ min: parse(event.target.value, setting.min) })}
          onBlur={() => {
            const [hardMin, hardMax] = definition.hardRange
            const min = Math.min(hardMax, Math.max(hardMin, setting.min))
            if (min !== setting.min) commit({ min })
          }}
        />
        <span className="vb-effect-word">max</span>
        <input
          type="number"
          inputMode="decimal"
          step={definition.step}
          disabled={!setting.enabled}
          value={setting.max}
          onChange={(event) => commit({ max: parse(event.target.value, setting.max) })}
          onBlur={() => {
            const [hardMin, hardMax] = definition.hardRange
            const max = Math.min(hardMax, Math.max(hardMin, setting.max))
            if (max !== setting.max) commit({ max })
          }}
        />
        <span className="vb-effect-unit">{definition.unit}</span>
      </div>
      {setting.id === 'mirror' && (
        <select
          className="vb-select vb-effect-mode"
          value={setting.mode ?? 'horizontal'}
          disabled={!setting.enabled}
          onChange={(event) => commit({ mode: event.target.value as 'horizontal' | 'vertical' })}
          aria-label="Mirror mode"
        >
          <option value="horizontal">Horizontal</option>
          <option value="vertical">Vertical</option>
        </select>
      )}
      {error && <span className="vb-effect-error">{error}</span>}
    </div>
  )
}

export const EffectsWorkspace = memo(function EffectsWorkspace() {
  const effects = useBatcher((snapshot) => snapshot.config.effects)
  const seed = useBatcher((snapshot) => snapshot.config.render.seed)
  const engine = getBatcherEngine()

  const enabledCount = useMemo(
    () => effects.settings.filter((setting) => setting.enabled).length,
    [effects],
  )

  const update = (next: EffectSetting) => {
    engine.setEffects({
      settings: effects.settings.map((setting) => (setting.id === next.id ? next : setting)),
    })
  }

  return (
    <div className="vb-effects">
      <div className="vb-effects-head">
        <div className="vb-effects-title">
          <h3>Media Effects &amp; Editing</h3>
          <p>Each variation samples one value inside every enabled range — deterministically, from the batch seed.</p>
        </div>
        <div className="vb-effects-actions">
          <div className="vb-seed">
            <span>Seed</span>
            <input
              className="vb-seed-input"
              value={seed ?? 'random'}
              onChange={(event) => {
                const value = event.target.value.trim()
                const parsed = value === '' || value === 'random' ? null : Number.parseInt(value, 10)
                engine.setRender({ seed: parsed === null || Number.isNaN(parsed) || parsed < 0 ? null : parsed })
              }}
              title="Master seed for this batch. 'random' draws a new one each batch."
            />
            <button
              type="button"
              className="vb-iconbtn"
              title="Randomize the batch seed"
              aria-label="Randomize seed now"
              onClick={() => engine.setRender({ seed: Math.floor(Math.random() * 2 ** 31) })}
            >
              <Icon name="dice" size={14} />
            </button>
          </div>
          <button type="button" className="pill" onClick={() => engine.setEffects({ settings: buildDefaultEffectSettings() })}>
            <Icon name="refresh" size={13} /> Reset
          </button>
          <button
            type="button"
            className="pill"
            data-primary="true"
            onClick={() => engine.setEffects({ settings: buildRandomizedEffectSettings() })}
          >
            <Icon name="dice" size={13} /> Randomize All
          </button>
        </div>
      </div>

      <div className="vb-effects-meta">
        <span className="chip chip-static">
          <b>{enabledCount}</b> effects enabled
        </span>
        <span className="vb-effects-hint">Disabled effects are skipped entirely — no filter, no cost.</span>
      </div>

      <div className="vb-effect-grid">
        {EFFECT_SECTIONS.map((section) => {
          const settings = section.effects
            .map((id) => effects.settings.find((setting) => setting.id === id))
            .filter((setting): setting is EffectSetting => Boolean(setting))
          const active = settings.filter((setting) => setting.enabled).length
          return (
            <section className="vb-card" key={section.id}>
              <header className="vb-card-head">
                <h4>{section.title}</h4>
                <span>
                  {active}/{settings.length} on
                </span>
              </header>
              <div className="vb-card-body">
                {settings.map((setting) => (
                  <EffectRow
                    key={setting.id}
                    setting={setting}
                    definition={EFFECT_DEFINITIONS[setting.id]}
                    onChange={update}
                  />
                ))}
              </div>
            </section>
          )
        })}
      </div>
    </div>
  )
})
