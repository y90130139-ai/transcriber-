/** The agreement's fill-in fields, kept on the model row (2026-10-19).
 *
 * The console captures these the moment an invite goes out; the app reads
 * them through `/api/app/me` so the Independent Contractor Agreement renders
 * with her details already in it — never a raw {{PLACEHOLDER}}.
 *
 * They live in Neon beside the rest of the model, not in the Supabase
 * account store: the agreement is a fact about the engagement, and the
 * account store is only the app's door. `agreement_sent_at` is stamped on
 * the first invite and kept on later re-sends, so the Effective Date the
 * agreement states does not drift.
 */
import { sql } from './db'

export type ModelAgreement = {
  clientLegalName: string | null
  clientStageName: string | null
  laterServiceStartDate: string | null
  /** When the invite was first sent — the agreement's Effective Date. */
  sentAt: string | null
}

/** One line of agreement text — trimmed, newlines flattened, capped. An
 *  empty answer is null so callers can tell "not given" from "given". */
function text(value: unknown, limit: number): string | null {
  if (typeof value !== 'string') return null
  const clean = value.replace(/[\r\n]+/g, ' ').trim().slice(0, limit)
  return clean.length > 0 ? clean : null
}

export async function readAgreement(modelId: string): Promise<ModelAgreement | null> {
  if (!modelId) return null
  const [row] = await sql.query(
    `select client_legal_name, client_stage_name, later_service_start_date,
            to_char(agreement_sent_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as sent_at
       from transcriber.models
      where id = $1`,
    [modelId],
  )
  if (!row) return null
  return {
    clientLegalName: row.client_legal_name ? String(row.client_legal_name) : null,
    clientStageName: row.client_stage_name ? String(row.client_stage_name) : null,
    laterServiceStartDate: row.later_service_start_date ? String(row.later_service_start_date) : null,
    sentAt: row.sent_at ? String(row.sent_at) : null,
  }
}

/**
 * Record what the invite dialog captured. A non-empty answer replaces the
 * stored one; an empty one leaves it alone, so re-sending an invite never
 * erases a legal name somebody already typed. The sent date is written only
 * when none is held yet.
 */
export async function saveAgreementDetails(
  modelId: string,
  input: {
    clientLegalName?: unknown
    clientStageName?: unknown
    laterServiceStartDate?: unknown
    sentAt?: string | null
  },
): Promise<void> {
  if (!modelId) return
  await sql.query(
    `update transcriber.models
        set client_legal_name        = coalesce($2, client_legal_name),
            client_stage_name        = coalesce($3, client_stage_name),
            later_service_start_date = coalesce($4, later_service_start_date),
            agreement_sent_at        = coalesce(agreement_sent_at, $5::timestamptz),
            updated_at               = now()
      where id = $1`,
    [
      modelId,
      text(input.clientLegalName, 160),
      text(input.clientStageName, 120),
      text(input.laterServiceStartDate, 80),
      input.sentAt ?? null,
    ],
  )
}
