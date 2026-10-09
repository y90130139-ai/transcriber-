/**
 * Tiny external store so the batcher's high-frequency state (job progress)
 * never re-renders the console. React subscribes through useSyncExternalStore;
 * the engine replaces the snapshot object when — and only when — something
 * actually changed.
 */
export type Listener = () => void

export class ExternalStore<T> {
  private listeners = new Set<Listener>()
  private snapshot: T

  constructor(initial: T) {
    this.snapshot = initial
  }

  getSnapshot = (): T => this.snapshot

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  set(next: T): void {
    this.snapshot = next
    for (const listener of this.listeners) listener()
  }
}
