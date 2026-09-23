/** SQL fragments shared by the read routes. */

// The stored transcript carries its own furniture — `[0:03] Speaker 1: ` in
// front of every turn. A card preview should show the words, not the
// scaffolding. Backslashes are doubled because this is a template literal:
// Postgres must receive \d and \s, not d and s.
const TURN_PREFIX = `'\\[\\d+:\\d{2}(:\\d{2})?\\]\\s*(Speaker\\s*\\d+\\s*:\\s*)?'`

/** `column` with the transcript's own furniture stripped, in full. */
export function spoken(column: string): string {
  return `regexp_replace(coalesce(${column}, ''), ${TURN_PREFIX}, '', 'g')`
}

/** The ` | ` between on-screen readings is our own join for a wrapped line, not
 *  something anybody typed. It collapses back to a space before it is shown.
 *  Doubled backslashes for the same reason as above. */
const unpiped = (column: string) =>
  `regexp_replace(coalesce(${column}, ''), '\\s*\\|\\s*', ' ', 'g')`

/** Bare `btrim` strips spaces and nothing else, so a transcript holding a lone
 *  newline — which is exactly what a video nobody speaks in holds — survives it
 *  and tests as non-empty, and the fallback below never fires. Measured: with
 *  the default, 0 of 54 blank previews were filled. Name the characters. */
const trimmed = (expression: string) => `btrim(${expression}, E' \\t\\r\\n')`

/**
 * The opening words of `column`, capped at `length` characters, falling back to
 * whatever was written on the screen.
 *
 * A card with no description line describes nothing. 29% of this library is
 * video nobody speaks in, so `t.plain` is empty for all of it and every one of
 * those cards rendered as an author and a duration and no words at all —
 * measured 2026-09-06, 13 of the top 40 suggestions for the one active model,
 * and the same hole on her plan page, the library grid and the creator sheet.
 * Since the visual pass there is something honest to put there instead.
 *
 * `screen` stays optional so a surface that genuinely wants only what was said
 * can still ask for exactly that.
 */
export function preview(column: string, length: number, screen?: string): string {
  const said = trimmed(spoken(column))
  const body = screen ? `coalesce(nullif(${said}, ''), ${trimmed(unpiped(screen))})` : said
  return `left(${body}, ${length})`
}

/**
 * A job whose URL is this post's shortcode.
 *
 * `like '%/CODE/%'` was wrong and quietly so: half the library is stored as
 * `instagram.com/reel/CODE` with no trailing slash, so Kaytie's two winners
 * sat in the library with their files while the editor queue, the download
 * fallback and the re-queue all reported nothing (measured 2026-09-22).
 *
 * Anchored on the slash before the code and on the end of the code, so a
 * shortcode cannot match a longer one that merely starts with it.
 */
export const jobMatchesCode = (source: string, code: string) =>
  `${source} ~ ('/' || ${code} || '/?([?#].*)?$')`
