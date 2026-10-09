import { neon } from '@neondatabase/serverless'

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set')

export const sql = neon(process.env.DATABASE_URL)

/**
 * A parameterised query with typed rows.
 *
 * Neon's own `sql.query<T>` generic is the `fullResults` flag, not the row
 * shape — `sql.query<MyRow>` fails to compile and `sql.query` alone types
 * rows as `Record<string, any>`. The cast lives here exactly once so every
 * caller gets a row type without repeating it.
 */
export async function q<T>(queryText: string, params: unknown[] = []): Promise<T[]> {
  const rows = await sql.query(queryText, params as never[])
  return rows as unknown as T[]
}
