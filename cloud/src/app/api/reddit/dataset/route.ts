import { NextResponse } from 'next/server'
import { isSignedIn } from '@/lib/auth'
import { datasetStats, exportRows, toCsv, type ExportKind } from '@/lib/reddit/queries'

const KINDS: ExportKind[] = ['topics', 'subreddits', 'posts']

/**
 * The dataset record, and CSV export.
 *
 * Exports default to aggregates and post metadata. Raw-content export is a
 * separate, admin-enabled switch (Settings → Data), because bulk
 * redistribution of Reddit content needs more than a button — see the
 * licence note on the Dataset page.
 */
export async function GET(request: Request) {
  if (!(await isSignedIn())) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const params = new URL(request.url).searchParams
  const exportKind = params.get('export')
  try {
    if (exportKind) {
      const kind = KINDS.includes(exportKind as ExportKind) ? (exportKind as ExportKind) : 'topics'
      const stats = await datasetStats()
      if (kind === 'posts' && !stats.retention.export_raw_enabled) {
        return NextResponse.json(
          { error: 'Raw post export is disabled. Enable it in Settings after confirming your Reddit data licence allows redistribution.' },
          { status: 403 },
        )
      }
      const rows = await exportRows(kind)
      const csv = toCsv(rows)
      const stamp = new Date().toISOString().slice(0, 10)
      return new NextResponse(csv, {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="reddit-${kind}-${stamp}.csv"`,
        },
      })
    }
    return NextResponse.json(await datasetStats())
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 })
  }
}
