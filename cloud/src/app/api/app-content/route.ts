import { guardAccess } from '@/lib/access'
import { NextResponse } from 'next/server'
import { currentSession } from '@/lib/auth'
import { APP_CONTENT_KEYS, defaultDoc, isAppContentKey, normalizeDoc } from '@/lib/app-content'
import { AppContentStoreError, loadContent, resetContent, saveContent } from '@/lib/app-content-store'
import { canEdit, canView, contentPageKey } from '@/lib/permissions'

/**
 * The console's side of the app content (Geno, 2026-10-14): read every
 * document as the app would see it, publish one, or drop an edit back to the
 * built-in default.
 *
 * Publishing is per document on purpose — the FAQ and the agreement are
 * different decisions, and a half-finished SOP draft should never ride out
 * on the back of a FAQ fix.
 *
 * A database that has not run the migration answers reads with the built-in
 * defaults and `migrated: false`; a write then says exactly what to run.
 *
 * Per-page permissions (2026-10-18): the read carries only the documents the
 * member may view, and a write checks Edit on that document's own page — six
 * separate doors, not one.
 */

function storeFailure(error: unknown) {
  if (error instanceof AppContentStoreError) {
    return NextResponse.json({ error: error.message }, { status: 503 })
  }
  throw error
}

export async function GET(request: Request) {
  const denied = await guardAccess(request)
  if (denied) return denied
  const session = await currentSession()
  const snapshot = await loadContent()
  if (!session) return denied ?? NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const docs = Object.fromEntries(
    APP_CONTENT_KEYS.filter((key) => canView(session.permissions, contentPageKey(key)))
      .map((key) => [key, snapshot.docs[key]]),
  ) as typeof snapshot.docs
  const meta = Object.fromEntries(
    APP_CONTENT_KEYS.filter((key) => canView(session.permissions, contentPageKey(key)))
      .map((key) => [key, snapshot.meta[key]]),
  ) as typeof snapshot.meta
  return NextResponse.json({ ...snapshot, docs, meta })
}

export async function PUT(request: Request) {
  const session = await currentSession()
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
  const key = body.key
  if (!isAppContentKey(key)) return NextResponse.json({ error: 'unknown document' }, { status: 400 })
  if (!canEdit(session.permissions, contentPageKey(key))) {
    return NextResponse.json({ error: 'no access to that page', page: contentPageKey(key), need: 'edit' }, { status: 403 })
  }

  const doc = normalizeDoc(key, body.doc)
  if (!doc) return NextResponse.json({ error: 'that document does not fit its shape' }, { status: 400 })

  try {
    const meta = await saveContent(key, doc, session.name || session.email)
    return NextResponse.json({ doc, meta })
  } catch (error) {
    return storeFailure(error)
  }
}

export async function DELETE(request: Request) {
  const denied = await guardAccess(request)
  if (denied) return denied

  const key = new URL(request.url).searchParams.get('key')
  if (!isAppContentKey(key)) return NextResponse.json({ error: 'unknown document' }, { status: 400 })
  const session = await currentSession()
  if (session && !canEdit(session.permissions, contentPageKey(key))) {
    return NextResponse.json({ error: 'no access to that page', page: contentPageKey(key), need: 'edit' }, { status: 403 })
  }

  try {
    await resetContent(key)
  } catch (error) {
    return storeFailure(error)
  }
  return NextResponse.json({
    doc: defaultDoc(key),
    meta: { updatedAt: null, updatedBy: null, edited: false },
  })
}
