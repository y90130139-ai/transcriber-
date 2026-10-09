'use client'

import { useCallback, useEffect, useState } from 'react'

/** The one data hook every Reddit Trends page uses: fetch JSON, keep the
 *  loading/error state honest, expose a reload for the refresh button. */
export function useJson<T>(url: string | null): {
  data: T | null
  error: string | null
  loading: boolean
  reload: () => void
} {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(Boolean(url))
  const [nonce, setNonce] = useState(0)

  useEffect(() => {
    if (!url) return
    let alive = true
    setLoading(true)
    fetch(url)
      .then(async (response) => {
        const body = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(body?.error ?? `Request failed (${response.status})`)
        return body as T
      })
      .then((body) => {
        if (!alive) return
        setData(body)
        setError(null)
      })
      .catch((reason) => {
        if (!alive) return
        setError(reason instanceof Error ? reason.message : String(reason))
      })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [url, nonce])

  const reload = useCallback(() => setNonce((value) => value + 1), [])
  return { data, error, loading, reload }
}

/** POST helper with the same error discipline. */
export async function postJson<T>(url: string, body: unknown = {}): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const parsed = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(parsed?.error ?? `Request failed (${response.status})`)
  return parsed as T
}

export async function putJson<T>(url: string, body: unknown = {}): Promise<T> {
  const response = await fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const parsed = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(parsed?.error ?? `Request failed (${response.status})`)
  return parsed as T
}
