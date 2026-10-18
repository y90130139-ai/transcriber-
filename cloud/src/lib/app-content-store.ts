/**
 * Where the client app's documents are kept (Geno, 2026-10-14).
 *
 * One row per edited document in `transcriber.app_content`; a key with no
 * row is simply the built-in default from `app-content.ts`, which is why
 * "Reset to default" is a delete and why the app and the console can never
 * disagree about what an untouched document says.
 *
 * Read and write are deliberately small and dumb — the shape of a document
 * is `app-content.ts`'s business, not this file's.
 *
 * The table arrives with `npm run migrate`. An environment where that has
 * not run yet (a fresh local database, a deploy ahead of its migration)
 * reads the defaults with `migrated: false` instead of an error, so the
 * console can say exactly what is missing rather than "Could not read the
 * documents."
 */
import { q } from './db'
import {
  APP_CONTENT_KEYS,
  defaultDoc,
  isLegacyTalentManagementAgreement,
  normalizeLegacyOnboardingAgreementTitle,
  normalizeDoc,
  type AppContentKey,
  type AppContentSnapshot,
  type AppDoc,
  type ContentMeta,
} from './app-content'

type Row = { key: string; doc: unknown; updated_at: string; updated_by: string | null }

export type ContentSnapshot = AppContentSnapshot

const NO_META: ContentMeta = { updatedAt: null, updatedBy: null, edited: false }

const MISSING_TABLE = /does not exist|undefined_table|relation .* not found/i

/** The one error worth turning into words a human can act on. */
export class AppContentStoreError extends Error {}

function storeError(error: unknown): AppContentStoreError | null {
  if (MISSING_TABLE.test(String(error))) {
    return new AppContentStoreError(
      'The app_content table is missing — run “npm run migrate” in cloud/, then reload this page.',
    )
  }
  return null
}

function defaults(): { docs: Record<AppContentKey, AppDoc>; meta: Record<AppContentKey, ContentMeta> } {
  const docs = {} as Record<AppContentKey, AppDoc>
  const meta = {} as Record<AppContentKey, ContentMeta>
  for (const key of APP_CONTENT_KEYS) {
    docs[key] = defaultDoc(key)
    meta[key] = NO_META
  }
  return { docs, meta }
}

/** Every document, edited rows merged over the defaults — what the console
 *  edits and what the app reads. */
export async function loadContent(): Promise<ContentSnapshot> {
  let rows: Row[]
  try {
    rows = await q<Row>(
      `select key,
              doc,
              to_char(updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as updated_at,
              updated_by
         from transcriber.app_content`,
    )
  } catch (error) {
    if (storeError(error)) return { ...defaults(), migrated: false }
    throw error
  }

  const { docs, meta } = defaults()

  for (const row of rows) {
    const key = row.key as AppContentKey
    if (!APP_CONTENT_KEYS.includes(key)) continue
    const doc = normalizeDoc(key, row.doc)
    if (!doc) continue
    // Earlier app-content builds may have persisted the shipped legacy copy.
    // Treat it as the new default without deleting the row; a console publish
    // can replace it, and Reset to default still removes it safely.
    if (key === 'agreement' && isLegacyTalentManagementAgreement(doc)) continue
    docs[key] = key === 'onboarding' ? normalizeLegacyOnboardingAgreementTitle(doc) : doc
    meta[key] = { updatedAt: row.updated_at, updatedBy: row.updated_by, edited: true }
  }

  return { docs, meta, migrated: true }
}

/** Publish one document. Returns the stored meta — who saved it and when. */
export async function saveContent(key: AppContentKey, doc: AppDoc, by: string | null): Promise<ContentMeta> {
  let row: Row | undefined
  try {
    ;[row] = await q<Row>(
      `insert into transcriber.app_content (key, doc, updated_at, updated_by)
       values ($1, $2::jsonb, now(), $3)
       on conflict (key) do update
          set doc = excluded.doc, updated_at = now(), updated_by = excluded.updated_by
       returning to_char(updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as updated_at, updated_by`,
      [key, JSON.stringify(doc), by],
    )
  } catch (error) {
    throw storeError(error) ?? error
  }
  return { updatedAt: row?.updated_at ?? null, updatedBy: row?.updated_by ?? by, edited: true }
}

/** Back to the built-in default: drop the row, keep nothing. */
export async function resetContent(key: AppContentKey): Promise<void> {
  try {
    await q(`delete from transcriber.app_content where key = $1`, [key])
  } catch (error) {
    throw storeError(error) ?? error
  }
}
