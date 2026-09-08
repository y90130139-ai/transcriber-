/** SQL fragments shared by the read routes. */

// The stored transcript carries its own furniture — `[0:03] Speaker 1: ` in
// front of every turn. A card preview should show the words, not the
// scaffolding. Backslashes are doubled because this is a template literal:
// Postgres must receive \d and \s, not d and s.
const TURN_PREFIX = `'\\[\\d+:\\d{2}(:\\d{2})?\\]\\s*(Speaker\\s*\\d+\\s*:\\s*)?'`

/** The opening words of `column`, capped at `length` characters. */
export function preview(column: string, length: number): string {
  return `left(regexp_replace(coalesce(${column}, ''), ${TURN_PREFIX}, '', 'g'), ${length})`
}

/** `column` with the transcript's own furniture stripped, in full. */
export function spoken(column: string): string {
  return `regexp_replace(coalesce(${column}, ''), ${TURN_PREFIX}, '', 'g')`
}
