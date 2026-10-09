/**
 * Unsaved edits on a week, kept on this device until the server has them.
 *
 * Every field in the plan dialog saves itself a beat after typing stops; this
 * is the net under that. A value is written here on every keystroke and only
 * dropped once a save with that exact value came back ok — so a closed tab, a
 * dropped connection or a crashed laptop leaves the words here, and the next
 * open of the week offers them back.
 */

export type DraftEntry = { value: string; at: number }
export type Drafts = Record<string, DraftEntry>

const PREFIX = 'plan-draft:v1:'
/** Older than this and nobody remembers typing it — not worth offering. */
const KEEP_MS = 7 * 24 * 60 * 60_000

function storageKey(planId: string) {
  return `${PREFIX}${planId}`
}

export function readDrafts(planId: string): Drafts {
  if (typeof window === 'undefined') return {}
  try {
    const parsed = JSON.parse(window.localStorage.getItem(storageKey(planId)) ?? '{}') as Drafts
    const now = Date.now()
    return Object.fromEntries(
      Object.entries(parsed).filter(([, entry]) =>
        entry && typeof entry.value === 'string' && now - entry.at < KEEP_MS),
    )
  } catch {
    return {}
  }
}

function writeDrafts(planId: string, drafts: Drafts) {
  try {
    if (Object.keys(drafts).length === 0) window.localStorage.removeItem(storageKey(planId))
    else window.localStorage.setItem(storageKey(planId), JSON.stringify(drafts))
  } catch {
    // Storage full or blocked: the server save still runs, there is just no net.
  }
}

export function putDraft(planId: string, field: string, value: string) {
  const drafts = readDrafts(planId)
  drafts[field] = { value, at: Date.now() }
  writeDrafts(planId, drafts)
}

/** Drop a field once it is safe. With `value`, only when what is held is
 *  still that value — a newer keystroke since the save keeps its draft. */
export function dropDraft(planId: string, field: string, value?: string) {
  const drafts = readDrafts(planId)
  if (!(field in drafts)) return
  if (value !== undefined && drafts[field].value !== value) return
  delete drafts[field]
  writeDrafts(planId, drafts)
}

export function draftValue(planId: string, field: string): string | undefined {
  return readDrafts(planId)[field]?.value
}

export function clearDrafts(planId: string, fields?: string[]) {
  if (!fields) return writeDrafts(planId, {})
  const drafts = readDrafts(planId)
  for (const field of fields) delete drafts[field]
  writeDrafts(planId, drafts)
}
