'use client'

import { useSyncExternalStore } from 'react'
import { getBatcherEngine, type BatcherSnapshot } from './engine'

/**
 * Subscribe to the batcher engine with a selector. Progress ticks at ~4/s
 * (§28) and only components whose selected slice changed re-render — the
 * console around the page is never touched.
 */
export function useBatcher<T>(selector: (snapshot: BatcherSnapshot) => T): T {
  const engine = getBatcherEngine()
  return useSyncExternalStore(
    engine.store.subscribe,
    () => selector(engine.store.getSnapshot()),
    () => selector(engine.store.getSnapshot()),
  )
}

export function useBatcherSnapshot(): BatcherSnapshot {
  return useBatcher((snapshot) => snapshot)
}
