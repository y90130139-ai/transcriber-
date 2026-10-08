'use client'

import { useCallback, useEffect, useReducer } from 'react'

/**
 * The console's reads, kept warm.
 *
 * Opening a model's card used to fire every read its sheet makes on the tap,
 * so the strip under her name, the priority chips and every tab behind them
 * spent their first moments as placeholders — on a page whose whole job is to
 * answer "who needs me" fast, that is the wrong order.
 *
 * This is a read-through cache for the console's own JSON endpoints. A card
 * warms its model's reads on hover (`warm.ts`), the sheet renders from what is
 * already here the moment it mounts, and a tab that has been opened once never
 * asks again. Saves write their response straight back with `put`, so the
 * value a sheet just stored is the value every holder of that URL sees next.
 *
 * Deliberately not SWR: no dependency, no polling, no revalidation storms. A
 * read is fresh for five minutes, and after that the next mount refetches in
 * the background while still rendering what it has.
 */

type Entry = {
  data: unknown
  /** The last failure, cleared by the next success. */
  error: string | null
  /** When this read last settled — success or failure. */
  at: number
  /** A read on its way, so two panels asking at once make one request. */
  promise: Promise<unknown> | null
}

const TTL_MS = 5 * 60_000
const MAX_ENTRIES = 400

const entries = new Map<string, Entry>()
const listeners = new Map<string, Set<() => void>>()

function emit(url: string) {
  const set = listeners.get(url)
  if (!set) return
  for (const notify of set) notify()
}

/** Keep the cache bounded without ever dropping what a mounted panel holds. */
function trim() {
  if (entries.size <= MAX_ENTRIES) return
  const cutoff = Date.now() - TTL_MS
  for (const [url, entry] of entries) {
    if (entry.promise || entry.at > cutoff || listeners.get(url)?.size) continue
    entries.delete(url)
    if (entries.size <= MAX_ENTRIES) return
  }
}

function begin(url: string, force = false): Promise<unknown> {
  const held = entries.get(url)
  if (held?.promise && !force) return held.promise

  const promise = fetch(url)
    .then((response) => {
      if (!response.ok) throw new Error(String(response.status))
      return response.json()
    })
    .then((data) => {
      entries.set(url, { data, error: null, at: Date.now(), promise: null })
      emit(url)
      trim()
      return data
    })
    .catch((error: unknown) => {
      // The old value, when there is one, stays: a failed refresh should not
      // blank a panel that was working a moment ago.
      const current = entries.get(url)
      entries.set(url, {
        data: current?.data,
        error: error instanceof Error ? error.message : 'failed',
        at: Date.now(),
        promise: null,
      })
      emit(url)
      throw error
    })

  entries.set(url, { data: held?.data, error: held?.error ?? null, at: held?.at ?? 0, promise })
  return promise
}

/**
 * Start (or join) the read for each URL now, so the panel that needs them
 * later has them. Fresh values are left alone — hovering a card ten times is
 * one fetch, not ten.
 */
export function prefetch(...urls: (string | null | undefined)[]): void {
  for (const url of urls) {
    if (!url) continue
    const held = entries.get(url)
    if (held?.promise) continue
    if (held?.data !== undefined && Date.now() - held.at < TTL_MS) continue
    void begin(url).catch(() => {})
  }
}

/** Read a URL through the cache, waiting for the one request if needed. */
export function loadJson<T>(url: string): Promise<T | null> {
  const held = entries.get(url)
  if (held?.data !== undefined && !held.promise && Date.now() - held.at < TTL_MS) {
    return Promise.resolve(held.data as T)
  }
  return begin(url).then((data) => data as T).catch(() => null)
}

/** Write what a save returned, so every holder of this URL sees it at once. */
export function put(url: string, data: unknown): void {
  entries.set(url, { data, error: null, at: Date.now(), promise: null })
  emit(url)
  trim()
}

/** Drop a read, so the next holder fetches it afresh. */
export function forget(url: string): void {
  entries.delete(url)
}

/**
 * Render a URL's value, live.
 *
 * Cached data comes back on the first render — no effect, no placeholder, no
 * flash — and a read that is missing or gone stale starts underneath it. The
 * component re-renders when that read settles, and when anybody `put`s.
 */
export function useLive<T>(url: string | null): {
  data: T | null
  error: string | null
  /** True once this URL has an answer — cached or settled — and none on the way. */
  ready: boolean
  reload: () => void
} {
  const [, bump] = useReducer((count: number) => count + 1, 0)

  useEffect(() => {
    if (!url) return
    let set = listeners.get(url)
    if (!set) {
      set = new Set()
      listeners.set(url, set)
    }
    set.add(bump)
    const held = entries.get(url)
    const fresh = held?.data !== undefined && Date.now() - held.at < TTL_MS
    if (!held?.promise && !fresh) void begin(url).catch(() => {})
    return () => { set.delete(bump) }
  }, [url])

  const held = url ? entries.get(url) : undefined
  const reload = useCallback(() => {
    if (!url) return
    void begin(url, true).catch(() => {})
  }, [url])

  return {
    data: (held?.data ?? null) as T | null,
    error: held?.error ?? null,
    ready: Boolean(held && !held.promise),
    reload,
  }
}
