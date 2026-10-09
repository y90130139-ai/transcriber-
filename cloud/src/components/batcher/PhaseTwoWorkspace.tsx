'use client'

import { memo } from 'react'
import { Icon, type IconName } from '@/components/console/ConsoleIcons'

type PhaseTwoProps = {
  kind: 'captions' | 'audio' | 'watermark'
}

const CONTENT: Record<PhaseTwoProps['kind'], {
  icon: IconName
  title: string
  summary: string
  points: string[]
}> = {
  captions: {
    icon: 'type',
    title: 'Captions',
    summary: 'A caption pool where each variation draws one line — deterministically, without repeats until the pool is used.',
    points: [
      'Add / edit / select a library of caption lines',
      'Font, size, colour, outline, shadow and background controls',
      'Drag the caption in a live preview; position stored normalized 0–1',
      'Rendered inside the same single-pass filter graph — no extra encode',
    ],
  },
  audio: {
    icon: 'music',
    title: 'Audio',
    summary: 'Keep the original, replace it from a track library, or mix the two — per variation, by seed.',
    points: [
      'Track library with random start offset and looping',
      'Volume, pitch and basic EQ ranges',
      'Avoid-repeats selection with deterministic permutations',
      'Speed changes keep audio in sync automatically',
    ],
  },
  watermark: {
    icon: 'image',
    title: 'Watermark',
    summary: 'An image mark over every variation, positioned once and sampled per variation.',
    points: [
      'Scale, opacity and rotation ranges',
      '9-position grid presets plus free drag',
      'Position stored normalized, previewed in the browser',
      'Composited in the same pass as the effects',
    ],
  },
}

/** Honest placeholders for the Phase 2 workspaces: the tabs exist so the
 *  structure is visible and stable, and each says exactly what is coming and
 *  on what foundation. No dead controls, no pretend settings. */
export const PhaseTwoWorkspace = memo(function PhaseTwoWorkspace({ kind }: PhaseTwoProps) {
  const content = CONTENT[kind]
  return (
    <div className="vb-phase2">
      <div className="vb-phase2-card">
        <span className="vb-phase2-icon">
          <Icon name={content.icon} size={20} />
        </span>
        <div className="vb-phase2-copy">
          <span className="vb-phase2-chip">Phase 2</span>
          <h3>{content.title}</h3>
          <p>{content.summary}</p>
          <ul>
            {content.points.map((point) => (
              <li key={point}>{point}</li>
            ))}
          </ul>
          <p className="vb-phase2-note">
            Phase 1 — sources, effects, deterministic variations, the worker queue and Exports — is live now.
          </p>
        </div>
      </div>
    </div>
  )
})
