'use client'

import { useCallback, useEffect, useState } from 'react'
import type { Standing } from '@/lib/standing'

/** Every model's standing, keyed by id. Fetched on its own, like the sweep, so
 *  a slow or failed read never holds up the roster it decorates. */
export function useStanding(): { standing: Record<string, Standing>; reload: () => Promise<void> } {
  const [standing, setStanding] = useState<Record<string, Standing>>({})

  const reload = useCallback(async () => {
    const response = await fetch('/api/standing')
    if (response.ok) setStanding((await response.json()).standing ?? {})
  }, [])

  useEffect(() => { void reload() }, [reload])
  return { standing, reload }
}
