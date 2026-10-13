/** The app-accounts list, composed server-side (Geno, 2026-10-13).
 *
 * Accounts and passwords live in Supabase (`lib/model-accounts.ts`); the
 * model each one is linked to — her name and photo — lives in Neon. The two
 * meet at the model id. Read by the page's first render and by the tab's
 * refresh after an action, so both always agree.
 */
import { appEmailConfigured } from '@/lib/app-email'
import { sql } from '@/lib/db'
import { listAccounts, type ModelAccount } from '@/lib/model-accounts'

export type AppAccountRow = ModelAccount & {
  modelName: string | null
  modelPhoto: string | null
}

export async function loadAppAccounts(): Promise<{ accounts: AppAccountRow[]; emailConfigured: boolean }> {
  const accounts = await listAccounts()

  const modelIds = [...new Set(accounts.map((account) => account.modelId).filter((id): id is string => Boolean(id)))]
  const people = new Map<string, { name: string; photo: string | null }>()
  if (modelIds.length > 0) {
    const rows = await sql.query(
      `select id, name, photo_url from transcriber.models where id = any($1::text[])`,
      [modelIds],
    )
    for (const row of rows) {
      people.set(String(row.id), {
        name: String(row.name),
        photo: row.photo_url ? String(row.photo_url) : null,
      })
    }
  }

  return {
    accounts: accounts.map((account) => {
      const person = account.modelId ? people.get(account.modelId) : undefined
      return { ...account, modelName: person?.name ?? null, modelPhoto: person?.photo ?? null }
    }),
    emailConfigured: appEmailConfigured(),
  }
}
