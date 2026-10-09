/**
 * Effect definitions, ranges and validation — ported from the desktop app
 * (video-batcher src/lib/effect-defs.ts) so a batch planned in either product
 * means the same thing. Phase 1 carries the §15 set: color, framing, timing,
 * detail. Audio processing arrives with the Audio workspace.
 */
import type { EffectId, EffectSetting } from './types'

export type EffectDefinition = {
  id: EffectId
  label: string
  description: string
  unit: string
  /** Safe randomized range, used by "Randomize All". */
  safeRange: [number, number]
  /** Hard validation bounds enforced in the UI. */
  hardRange: [number, number]
  step: number
  decimals: number
  defaultValue: [number, number]
  enabledByDefault: boolean
}

export type EffectSection = {
  id: string
  title: string
  effects: EffectId[]
}

export const EFFECT_DEFINITIONS: Record<EffectId, EffectDefinition> = {
  brightness: {
    id: 'brightness',
    label: 'Brightness',
    description: 'Overall luminance shift',
    unit: '%',
    safeRange: [-3, 3],
    hardRange: [-30, 30],
    step: 0.1,
    decimals: 2,
    defaultValue: [-5, 5],
    enabledByDefault: true,
  },
  contrast: {
    id: 'contrast',
    label: 'Contrast',
    description: 'Tonal contrast',
    unit: '%',
    safeRange: [-3, 3],
    hardRange: [-30, 30],
    step: 0.1,
    decimals: 2,
    defaultValue: [-5, 5],
    enabledByDefault: true,
  },
  saturation: {
    id: 'saturation',
    label: 'Saturation',
    description: 'Color intensity',
    unit: '%',
    safeRange: [-3, 3],
    hardRange: [-50, 50],
    step: 0.1,
    decimals: 2,
    defaultValue: [-5, 5],
    enabledByDefault: true,
  },
  hue: {
    id: 'hue',
    label: 'Hue',
    description: 'Hue rotation',
    unit: '°',
    safeRange: [-2, 2],
    hardRange: [-180, 180],
    step: 0.1,
    decimals: 2,
    defaultValue: [-5, 5],
    enabledByDefault: true,
  },
  colorTemperature: {
    id: 'colorTemperature',
    label: 'Color Temperature',
    description: 'Warm / cool tint',
    unit: 'K',
    safeRange: [-150, 150],
    hardRange: [-2000, 2000],
    step: 10,
    decimals: 0,
    defaultValue: [-300, 300],
    enabledByDefault: false,
  },
  gamma: {
    id: 'gamma',
    label: 'Gamma',
    description: 'Mid-tone curve',
    unit: '',
    safeRange: [0.97, 1.03],
    hardRange: [0.5, 2],
    step: 0.005,
    decimals: 3,
    defaultValue: [0.98, 1.02],
    enabledByDefault: false,
  },
  zoom: {
    id: 'zoom',
    label: 'Zoom',
    description: 'Scale factor',
    unit: 'x',
    safeRange: [1.0, 1.04],
    hardRange: [1, 1.5],
    step: 0.001,
    decimals: 3,
    defaultValue: [1.0, 1.05],
    enabledByDefault: true,
  },
  pixelShiftX: {
    id: 'pixelShiftX',
    label: 'Pixel Shift X',
    description: 'Horizontal offset',
    unit: '%',
    safeRange: [-1, 1],
    hardRange: [-10, 10],
    step: 0.05,
    decimals: 2,
    defaultValue: [-2, 2],
    enabledByDefault: true,
  },
  pixelShiftY: {
    id: 'pixelShiftY',
    label: 'Pixel Shift Y',
    description: 'Vertical offset',
    unit: '%',
    safeRange: [-1, 1],
    hardRange: [-10, 10],
    step: 0.05,
    decimals: 2,
    defaultValue: [-2, 2],
    enabledByDefault: true,
  },
  rotation: {
    id: 'rotation',
    label: 'Rotation',
    description: 'Rotation angle',
    unit: '°',
    safeRange: [-0.5, 0.5],
    hardRange: [-15, 15],
    step: 0.01,
    decimals: 2,
    defaultValue: [-1, 1],
    enabledByDefault: true,
  },
  mirror: {
    id: 'mirror',
    label: 'Mirror',
    description: 'Flip horizontally or vertically',
    unit: '',
    safeRange: [0, 1],
    hardRange: [0, 1],
    step: 1,
    decimals: 0,
    defaultValue: [0, 1],
    enabledByDefault: false,
  },
  cutStart: {
    id: 'cutStart',
    label: 'Cut Start',
    description: 'Seconds trimmed from the beginning',
    unit: 's',
    safeRange: [0, 0.5],
    hardRange: [0, 600],
    step: 0.1,
    decimals: 2,
    defaultValue: [0, 1],
    enabledByDefault: false,
  },
  cutEnd: {
    id: 'cutEnd',
    label: 'Cut End',
    description: 'Seconds trimmed from the end',
    unit: 's',
    safeRange: [0, 0.5],
    hardRange: [0, 600],
    step: 0.1,
    decimals: 2,
    defaultValue: [0, 1],
    enabledByDefault: false,
  },
  speed: {
    id: 'speed',
    label: 'Speed',
    description: 'Playback speed factor',
    unit: 'x',
    safeRange: [0.99, 1.01],
    hardRange: [0.25, 4],
    step: 0.001,
    decimals: 3,
    defaultValue: [0.98, 1.02],
    enabledByDefault: true,
  },
  sharpen: {
    id: 'sharpen',
    label: 'Sharpen',
    description: 'Unsharp mask amount',
    unit: '',
    safeRange: [0, 0.4],
    hardRange: [0, 2],
    step: 0.05,
    decimals: 2,
    defaultValue: [0.2, 0.8],
    enabledByDefault: false,
  },
  noise: {
    id: 'noise',
    label: 'Noise / Grain',
    description: 'Additive film grain',
    unit: '',
    safeRange: [0, 4],
    hardRange: [0, 30],
    step: 0.5,
    decimals: 1,
    defaultValue: [2, 6],
    enabledByDefault: false,
  },
}

export const EFFECT_SECTIONS: EffectSection[] = [
  {
    id: 'color',
    title: 'Color & Tone',
    effects: ['brightness', 'contrast', 'saturation', 'hue', 'colorTemperature', 'gamma'],
  },
  {
    id: 'framing',
    title: 'Framing & Motion',
    effects: ['zoom', 'pixelShiftX', 'pixelShiftY', 'rotation', 'mirror'],
  },
  {
    id: 'timing',
    title: 'Timing & Length',
    effects: ['cutStart', 'cutEnd', 'speed'],
  },
  {
    id: 'texture',
    title: 'Detail & Texture',
    effects: ['sharpen', 'noise'],
  },
]

export const EFFECT_ORDER: EffectId[] = EFFECT_SECTIONS.flatMap((section) => section.effects)

export function buildDefaultEffectSettings(): EffectSetting[] {
  return EFFECT_ORDER.map((id) => {
    const def = EFFECT_DEFINITIONS[id]
    return {
      id,
      enabled: def.enabledByDefault,
      min: def.defaultValue[0],
      max: def.defaultValue[1],
      unit: def.unit,
      mode: id === 'mirror' ? ('horizontal' as const) : null,
    }
  })
}

/** Conservative randomized ranges, used by "Randomize All". */
export function buildRandomizedEffectSettings(): EffectSetting[] {
  return EFFECT_ORDER.map((id) => {
    const def = EFFECT_DEFINITIONS[id]
    return {
      id,
      enabled: def.enabledByDefault,
      min: def.safeRange[0],
      max: def.safeRange[1],
      unit: def.unit,
      mode: id === 'mirror' ? ('horizontal' as const) : null,
    }
  })
}

export function validateEffectSetting(setting: EffectSetting): string | null {
  const def = EFFECT_DEFINITIONS[setting.id]
  if (!def) return `Unknown effect "${setting.id}"`
  const [hardMin, hardMax] = def.hardRange
  if (Number.isNaN(setting.min) || Number.isNaN(setting.max)) return 'Values must be numbers'
  if (setting.min > setting.max) return 'MIN must be less than or equal to MAX'
  if (setting.min < hardMin || setting.max > hardMax) {
    return `Values must stay between ${hardMin} and ${hardMax}${def.unit}`
  }
  return null
}
