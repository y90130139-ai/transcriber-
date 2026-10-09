/**
 * IndexedDB for local project state (§25). localStorage is never used for
 * anything but the smallest flags. Stores:
 *
 *   config  — the frozen effects/render/metadata configuration.
 *   outputs — metadata for every finished variation in OPFS (bytes stay in
 *             OPFS; this is only enough to draw the list).
 *   batches — batch plan summaries: seed, variation manifests and status,
 *             so a batch's deterministic identity survives a reload.
 */

const DB_NAME = 'video-batcher'
const DB_VERSION = 1

let dbPromise: Promise<IDBDatabase> | null = null

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv')
      if (!db.objectStoreNames.contains('outputs')) db.createObjectStore('outputs', { keyPath: 'id' })
      if (!db.objectStoreNames.contains('batches')) db.createObjectStore('batches', { keyPath: 'id' })
      if (!db.objectStoreNames.contains('presets')) db.createObjectStore('presets', { keyPath: 'id' })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
    request.onblocked = () => reject(new Error('indexeddb blocked'))
  })
  return dbPromise
}

function tx<T>(store: string, mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(store, mode)
        const request = run(transaction.objectStore(store))
        request.onsuccess = () => resolve(request.result as T)
        request.onerror = () => reject(request.error)
      }),
  )
}

export function kvGet<T>(key: string): Promise<T | null> {
  return tx<T | undefined>('kv', 'readonly', (store) => store.get(key) as IDBRequest<T | undefined>).then(
    (value) => value ?? null,
  )
}

export function kvSet(key: string, value: unknown): Promise<void> {
  return tx('kv', 'readwrite', (store) => store.put(value, key) as IDBRequest<IDBValidKey>).then(() => undefined)
}

export function outputsAll<T>(): Promise<T[]> {
  return tx<T[]>('outputs', 'readonly', (store) => store.getAll() as IDBRequest<T[]>)
}

export function outputsPut(record: { id: string }): Promise<void> {
  return tx('outputs', 'readwrite', (store) => store.put(record) as IDBRequest<IDBValidKey>).then(() => undefined)
}

export function outputsDelete(id: string): Promise<void> {
  return tx('outputs', 'readwrite', (store) => store.delete(id) as IDBRequest<undefined>).then(() => undefined)
}

export function outputsClear(): Promise<void> {
  return tx('outputs', 'readwrite', (store) => store.clear() as IDBRequest<undefined>).then(() => undefined)
}

export function batchPut(record: { id: string; [key: string]: unknown }): Promise<void> {
  return tx('batches', 'readwrite', (store) => store.put(record) as IDBRequest<IDBValidKey>).then(() => undefined)
}

export function batchGet<T>(id: string): Promise<T | null> {
  return tx<T | undefined>('batches', 'readonly', (store) => store.get(id) as IDBRequest<T | undefined>).then(
    (value) => value ?? null,
  )
}

export function batchesAll<T>(): Promise<T[]> {
  return tx<T[]>('batches', 'readonly', (store) => store.getAll() as IDBRequest<T[]>)
}

/* ---------------------------------------------------------------- presets */

export type StoredPreset = {
  id: string
  name: string
  createdAt: number
  updatedAt: number
  config: unknown
}

export function presetsAll(): Promise<StoredPreset[]> {
  return tx<StoredPreset[]>('presets', 'readonly', (store) => store.getAll() as IDBRequest<StoredPreset[]>)
}

export function presetPut(record: StoredPreset): Promise<void> {
  return tx('presets', 'readwrite', (store) => store.put(record) as IDBRequest<IDBValidKey>).then(() => undefined)
}

export function presetDelete(id: string): Promise<void> {
  return tx('presets', 'readwrite', (store) => store.delete(id) as IDBRequest<undefined>).then(() => undefined)
}
