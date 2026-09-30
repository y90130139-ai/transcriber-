/**
 * The Infloww open API, read-only (2026-09-30).
 *
 * Only two endpoints are used: the creator list and transactions. Auth is the
 * raw key in `Authorization` (no "Bearer") plus the agency id in `x-oid`; get
 * either wrong and Cloudflare answers with a 403 HTML page rather than a 401,
 * so a 403 is reported as a credentials problem.
 *
 * 60 requests a minute per agency, shared by every key. Each call waits on
 * `x-ratelimit-remaining` and backs off on 429. Pages are followed until
 * `hasMore` is false — never capped — because a busy account runs to 25+ pages
 * a month and a capped loop silently under-reports her.
 */
import type { RawTxn } from './days'

const BASE = 'https://openapi.infloww.com'
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36'
const RETRIES = 5
const BACKOFF_MS = 5_000

export type InflowwCreator = { id: string; name: string; userName: string }

export class OutOfTime extends Error {}

function credentials() {
  const key = process.env.INFLOWW_API_KEY
  const oid = process.env.INFLOWW_OID
  if (!key || !oid) throw new Error('INFLOWW_API_KEY and INFLOWW_OID must both be set')
  return { key, oid }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

let nextAllowed = 0

async function get(path: string, deadline: number): Promise<any> {
  const { key, oid } = credentials()
  for (let attempt = 0; attempt < RETRIES; attempt++) {
    const wait = nextAllowed - Date.now()
    if (Date.now() + Math.max(wait, 0) > deadline) throw new OutOfTime(path)
    if (wait > 0) await sleep(wait)

    const res = await fetch(`${BASE}${path}`, {
      headers: { Authorization: key, 'x-oid': oid, Accept: 'application/json', 'User-Agent': UA },
      cache: 'no-store',
    })
    if (res.status === 429) {
      nextAllowed = Date.now() + BACKOFF_MS
      continue
    }
    if (res.status === 401 || res.status === 403) {
      throw new Error(`Infloww refused the credentials (HTTP ${res.status}) — check INFLOWW_API_KEY and INFLOWW_OID`)
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`Infloww ${res.status} on ${path.split('?')[0]}: ${body.slice(0, 200)}`)
    }
    const remaining = Number(res.headers.get('x-ratelimit-remaining') ?? '60')
    nextAllowed = Date.now() + (remaining < 10 ? 2_000 : remaining < 20 ? 1_200 : 1_100)
    return res.json()
  }
  throw new Error(`Infloww kept rate-limiting ${path.split('?')[0]}`)
}

export async function listCreators(deadline = Date.now() + 60_000): Promise<InflowwCreator[]> {
  const out: InflowwCreator[] = []
  let cursor: string | null = null
  do {
    const d = await get(`/v1/creators?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`, deadline)
    for (const c of d?.data?.list ?? []) out.push({ id: String(c.id), name: String(c.name ?? ''), userName: String(c.userName ?? '') })
    cursor = d?.hasMore ? d.cursor : null
  } while (cursor)
  return out
}

/** Every transaction for one account in [startMs, endMs). Only the fields
 *  the day fold reads are kept; fan fields are dropped here, at the door. */
export async function transactions(creatorId: string, startMs: number, endMs: number, deadline: number): Promise<RawTxn[]> {
  const out: RawTxn[] = []
  let cursor: string | null = null
  do {
    const d = await get(
      `/v1/transactions?creatorId=${encodeURIComponent(creatorId)}&startTime=${startMs}&endTime=${endMs}&limit=100`
        + (cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''),
      deadline,
    )
    for (const t of d?.data?.list ?? []) {
      out.push({ createdTime: t.createdTime, type: t.type, status: t.status, amount: t.amount, net: t.net })
    }
    cursor = d?.hasMore ? d.cursor : null
  } while (cursor)
  return out
}
