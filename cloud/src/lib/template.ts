/**
 * Plan templates — which kind of week the autodraft builds (Geno, 2026-10-08).
 *
 *   sprint   copy-paste. References only, zero writing — new models, D tier.
 *   mix      the 70/20/10 split as it runs today. The default.
 *   winning  weights the week to the verticals her own winners prove out —
 *            unlocked once she has WINNING_MIN winners on her own account.
 *   custom   the team builds the whole week by hand; autodraft skips it.
 *
 * Stored on the model (`models.plan_template`), because a template is a
 * property of the model, not of one week — next Sunday's draft inherits it.
 * Null means auto: `suggestedTemplate` names the rung of the ladder she is
 * on, the editor shows it, and behaviour only changes when a human sets one.
 *
 * Pure on purpose: imported by the editor, the draft path and the tests.
 */

export type PlanTemplate = 'sprint' | 'mix' | 'winning' | 'custom'

export const PLAN_TEMPLATES: readonly PlanTemplate[] = ['sprint', 'mix', 'winning', 'custom']

export function isTemplate(value: unknown): value is PlanTemplate {
  return (PLAN_TEMPLATES as readonly unknown[]).includes(value)
}

/** Winners on her own account before the Winning template means anything.
 *  Below it the "winning verticals" would be one lucky reel. */
export const WINNING_MIN = 3

export const TEMPLATE_TEXT: Record<PlanTemplate, { label: string; line: string }> = {
  sprint: {
    label: '30-Day Sprint',
    line: 'Copy-paste: references only, zero writing. New models and D tier — volume first.',
  },
  mix: {
    label: 'The Mix',
    line: 'The 70/20/10 split: her winners reskinned, iterations, library tests.',
  },
  winning: {
    label: 'Winning Verticals',
    line: `Needs ${WINNING_MIN} winners. Weights the week to the verticals her own reels prove out.`,
  },
  custom: {
    label: 'Custom',
    line: 'The team builds the whole week by hand. Autodraft leaves it alone.',
  },
}

/**
 * The ladder: no winners → Sprint; 3+ → Winning; anything between → the Mix.
 * A model with sent weeks but no winners stays on the Mix rather than being
 * demoted back to a sprint — a sprint is a starting state, not a punishment.
 */
export function suggestedTemplate(winners: number, sentWeeks: number): PlanTemplate {
  if (winners >= WINNING_MIN) return 'winning'
  if (winners === 0 && sentWeeks < 2) return 'sprint'
  return 'mix'
}
