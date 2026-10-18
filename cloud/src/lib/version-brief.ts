import { findFormatReel } from './formats'
import { findGerman, germanVersionAt } from './german'
import type { CardVersion } from './styles'
import { versionOf } from './styles'

export type VersionBrief = {
  number: number
  current: string | null
  previous: string | null
  direction: string | null
}

type VersionRow = { outfit?: string | null; caption?: string | null } | null | undefined

function rowText(row: VersionRow): string | null {
  if (!row) return null
  const text = [row.outfit, row.caption]
    .map((value) => (typeof value === 'string' ? value.trim() : ''))
    .filter(Boolean)
    .join(' · ')
  return text || null
}

/** Resolve the selected take from saved version rows or the numbered playbook.
 *  A numbered title such as `FORMAT #6 (V2)` can still be made actionable when
 *  it predates structured version rows. */
export function versionBriefFor(
  title: string | null | undefined,
  savedVersions: CardVersion[] | null | undefined,
  savedDirection: string | null | undefined,
): VersionBrief | null {
  const number = versionOf(title)
  if (number === null) return null

  const titleText = String(title ?? '')
  const numberedFormat = titleText.match(/\b(?:german(?:\s+format)?|format(?:\s+reel)?)\s*#?\s*(\d+[a-z]?)\b/i)
  const formatNo = numberedFormat?.[1]

  const reel = formatNo ? findFormatReel(formatNo) : null
  const german = formatNo ? findGerman(formatNo) : undefined
  const catalogRow = (at: number): VersionRow => {
    if (at < 1) return null
    if (reel) return reel.versions[at - 1] ?? null
    if (german) return germanVersionAt(german.versions, at)
    return null
  }

  const savedRow = (at: number): VersionRow =>
    at > 0 && Array.isArray(savedVersions) ? savedVersions[at - 1] : null

  const current = rowText(savedRow(number)) ?? rowText(catalogRow(number))
  const previous = number > 1
    ? rowText(savedRow(number - 1)) ?? rowText(catalogRow(number - 1))
    : null

  return {
    number,
    current,
    previous,
    direction: (savedDirection ?? '').trim() || reel?.dir || german?.direction || null,
  }
}
