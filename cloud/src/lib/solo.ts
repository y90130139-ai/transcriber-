/**
 * Filming alone: which references need someone else on camera, read from what
 * the library knows. The rule itself is `needsOthers` in `week-shape.ts`; this
 * is the part that needs the database.
 *
 * Susanna declined couple reels three weeks running ("I don't do reels with
 * other people") and they kept coming, because nothing on a reel says how
 * many people are in it. What does say it: models turning an account's reels
 * down as "Needs another person", and accounts whose own captions keep saying
 * couple.
 */
import { sql } from './db'
import { COUPLE_WORDS, needsOthers } from './week-shape'
import { instagramAccounts, readSocials } from './socials'

/** A decline that says "other people" in her words, not only by code. */
const PEOPLE_REASON = '(other people|another person|with (a|my) (partner|boyfriend|husband|man|guy)|couples?|by myself|alone|solo)'
/** Captions from one account that say couple before the whole account is
 *  treated as a couple account. */
const COUPLE_CAPTIONS_MIN = 2

let cached: { at: number; accounts: Set<string> } | null = null
const CACHE_MS = 5 * 60 * 1000

/** Accounts whose reels need two people. Cached for a few minutes: her page
 *  asks on every load, and the answer moves only when someone declines. */
export async function coupleAccounts(): Promise<Set<string>> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.accounts
  const declined = await sql.query(
    `select distinct lower(t.author) as author
       from transcriber.declines d
       join transcriber.transcripts t on t.job_id = d.job_id
      where t.author is not null
        and (d.code = 'needs-another-person' or coalesce(d.reason, '') ~* $1)`,
    [PEOPLE_REASON],
  )
  const captions = await sql.query(
    `select lower(author) as author, caption from transcriber.transcripts
      where author is not null and coalesce(caption, '') <> ''`,
  )
  const counts = new Map<string, number>()
  for (const row of captions) {
    if (!COUPLE_WORDS.test(String(row.caption))) continue
    const author = String(row.author)
    counts.set(author, (counts.get(author) ?? 0) + 1)
  }
  const accounts = new Set<string>(declined.map((row) => String(row.author)))
  for (const [author, n] of counts) if (n >= COUPLE_CAPTIONS_MIN) accounts.add(author)
  cached = { at: Date.now(), accounts }
  return accounts
}

/** The library reels among these that need someone else on camera. */
export async function jobsNeedingOthers(jobIds: string[]): Promise<Set<string>> {
  if (!jobIds.length) return new Set()
  const [accounts, rows] = await Promise.all([
    coupleAccounts(),
    sql.query(
      `select t.job_id, t.author, t.caption, t.speaker_count,
              coalesce((select array_agg(g.tag) from transcriber.tags g
                         where g.job_id = t.job_id and g.axis = 'format'), '{}') as formats
         from transcriber.transcripts t where t.job_id = any($1::text[])`,
      [jobIds],
    ),
  ])
  const out = new Set<string>()
  for (const row of rows) {
    if (needsOthers({
      author: row.author ? String(row.author) : null,
      rawCaption: row.caption ? String(row.caption) : null,
      speakerCount: row.speaker_count === null ? null : Number(row.speaker_count),
      formats: (row.formats as string[]) ?? [],
    }, accounts)) out.add(String(row.job_id))
  }
  return out
}

/** Every Instagram account of hers, lowercased — the tested reader in
 *  `socials.ts`, fed straight from the stored row. */
export function ownHandlesOf(handle: unknown, socials: unknown): string[] {
  return instagramAccounts(typeof handle === 'string' ? handle : null, readSocials(socials))
}
