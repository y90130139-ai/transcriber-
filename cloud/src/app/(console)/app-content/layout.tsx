import type { AppContentSnapshot } from '@/lib/app-content'
import { APP_CONTENT_KEYS } from '@/lib/app-content'
import { loadContent } from '@/lib/app-content-store'
import { currentSession } from '@/lib/auth'
import { firstAllowedPath } from '@/lib/permissions'
import { redirect } from 'next/navigation'
import AppContentShell from '@/components/console/AppContentEditor'

/**
 * App Content's shell (Geno, 2026-10-14).
 *
 * Server side: every document is read here — once — and handed to the client
 * shell inside the first payload, so the pages never wait on a fetch. The
 * shell below stays mounted while you move between the document pages, keeps
 * unpublished drafts, and draws the read view as plain HTML; the BlockNote
 * editor only loads when Edit is pressed.
 *
 * If the store cannot be reached at render time the shell is handed null and
 * falls back to its own client read (with its retry), rather than taking the
 * whole section down with an error page.
 *
 * Per-page permissions (2026-10-18): the payload carries only the documents
 * the member may view — six documents, six doors.
 */
export default async function AppContentLayout({ children }: { children: React.ReactNode }) {
  const session = await currentSession()
  if (!session) redirect('/')
  const viewable = APP_CONTENT_KEYS.filter((key) => {
    const level = session.permissions[`content_${key}`]
    return level === 'read' || level === 'edit'
  })
  if (viewable.length === 0) redirect(firstAllowedPath(session.permissions) ?? '/')

  let initial: AppContentSnapshot | null = null
  try {
    initial = await loadContent()
    initial = {
      ...initial,
      docs: Object.fromEntries(viewable.map((key) => [key, initial!.docs[key]])) as AppContentSnapshot['docs'],
      meta: Object.fromEntries(viewable.map((key) => [key, initial!.meta[key]])) as AppContentSnapshot['meta'],
    }
  } catch {
    initial = null
  }
  return <AppContentShell initial={initial}>{children}</AppContentShell>
}
