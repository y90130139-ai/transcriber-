/**
 * Origin Private File System helpers (§11).
 *
 * Sources are mounted zero-copy from the user's File handles, but outputs
 * live here: finished variations are written straight to OPFS by the
 * processing worker, and the UI reads them back as File handles on demand —
 * never as long-lived Blobs in React state.
 */

const EXPORTS_DIR = 'vb-exports'

export function opfsAvailable(): boolean {
  return typeof navigator.storage?.getDirectory === 'function'
}

async function exportsDir(): Promise<FileSystemDirectoryHandle> {
  const root = await navigator.storage.getDirectory()
  return root.getDirectoryHandle(EXPORTS_DIR, { create: true })
}

async function batchDir(batchId: string, create: boolean): Promise<FileSystemDirectoryHandle | null> {
  try {
    const dir = await exportsDir()
    return await dir.getDirectoryHandle(batchId, { create })
  } catch {
    return null
  }
}

export async function readOutput(batchId: string, fileName: string): Promise<File | null> {
  try {
    const dir = await batchDir(batchId, false)
    if (!dir) return null
    const handle = await dir.getFileHandle(fileName)
    return await handle.getFile()
  } catch {
    return null
  }
}

export async function outputExists(batchId: string, fileName: string): Promise<boolean> {
  return (await readOutput(batchId, fileName)) != null
}

export async function deleteOutput(batchId: string, fileName: string): Promise<void> {
  try {
    const dir = await batchDir(batchId, false)
    if (!dir) return
    await dir.removeEntry(fileName)
  } catch {
    /* already gone */
  }
}

export async function clearBatch(batchId: string): Promise<void> {
  try {
    const dir = await exportsDir()
    await dir.removeEntry(batchId, { recursive: true })
  } catch {
    /* already gone */
  }
}

/** Sweep export folders for batches the app no longer knows about. */
export async function listBatchIds(): Promise<string[]> {
  const dir = await exportsDir()
  const ids: string[] = []
  for await (const key of (dir as unknown as { keys(): AsyncIterable<string> }).keys()) {
    ids.push(key)
  }
  return ids
}
