/**
 * Why a winner worked, in words. Pure, so the creator sheet, the item view and
 * the weekly digest all say it the same way — the numbers come from `why.ts`.
 *
 * Every reason is something measured from outside the account, never a guess
 * at intent: a sound other creators were on, a streak she was already riding,
 * a format that has won for her before, a share rate in the top tenth. When
 * none of those fired the honest reading is "new concept" — the idea itself
 * carried it, and that is the kind worth stealing for the 10%.
 */
import { labelOf } from './taxonomy'

export type Reason =
  | { kind: 'sound'; title: string; creators: number }
  | { kind: 'run'; hits: number }
  | { kind: 'format'; format: string; times: number }
  | { kind: 'shared'; per1k: number }
  | { kind: 'new' }

export type Why = {
  /** Plays over her own median plays, from the sweep. Null when unswept. */
  multiple: number | null
  reasons: Reason[]
  /** False when the sweep never saw this post, so "new concept" cannot be claimed. */
  measured: boolean
}

export const REASON_NAME: Record<Reason['kind'], string> = {
  sound: 'Trending sound',
  run: 'Heat run',
  format: 'Proven format',
  shared: 'Shared widely',
  new: 'New concept',
}

/** The chip text: short enough for a phone. */
export function reasonChip(reason: Reason): string {
  switch (reason.kind) {
    case 'sound': return `Trending sound · ${reason.creators} creators`
    case 'run': return `Heat run · ${reason.hits} hits that week`
    case 'format': return `Proven ${labelOf('format', reason.format).toLowerCase()}`
    case 'shared': return `Shared widely · ${reason.per1k}/1k`
    case 'new': return 'New concept'
  }
}

/** The sentence behind the chip, for a tooltip and for the digest. */
export function reasonLine(reason: Reason): string {
  switch (reason.kind) {
    case 'sound':
      return `Rode "${reason.title}", which ${reason.creators} watched creators used within two weeks of it.`
    case 'run':
      return `She was already hot: ${reason.hits} other reel${reason.hits === 1 ? '' : 's'} passed 3× her median in the week before.`
    case 'format':
      return `${reason.times} more of her reels in the library are ${labelOf('format', reason.format).toLowerCase()} — the format keeps paying for her.`
    case 'shared':
      return `${reason.per1k} shares per 1,000 plays — top tenth of every reel swept. People sent it on.`
    case 'new':
      return 'No trending sound, no streak, no repeat format. The idea carried it.'
  }
}
