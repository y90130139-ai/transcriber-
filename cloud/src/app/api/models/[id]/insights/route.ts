import { guardAccess } from '@/lib/access'
import { NextResponse } from 'next/server'
import { sql } from '@/lib/db'
import { insightsFor } from '@/lib/insights'
import { isValidTag } from '@/lib/taxonomy'

type Params = { params: Promise<{ id: string }> }

/** Her level, verticals, similar creators and won't-do proposals — worked out
 *  from her accounts, never typed. */
export async function GET(request: Request, { params }: Params) {
  const denied = await guardAccess(request)
  if (denied) return denied
  const { id } = await params
  const insights = await insightsFor(id)
  if (!insights) return NextResponse.json({ error: 'not found' }, { status: 404 })
  const [model] = await sql.query(
    `select verticals, similar_creators, formats, wont_do from transcriber.models where id = $1`, [id],
  )
  // Her niche as SHE votes it (Geno, 2026-10-07): the tags of the reels she
  // says yes to — 👍, "I'll do this", stars — counted. Read, never typed.
  const picks = await sql.query(
    `select g.axis, g.tag, count(*)::int as n
       from transcriber.plan_items i
       join transcriber.plans p on p.id = i.plan_id
       join transcriber.tags g on g.job_id = i.job_id
      where p.model_id = $1 and (i.rating = 1 or i.accepted_at is not null)
        and g.axis in ('topic', 'format') and g.tag <> 'unknown'
      group by g.axis, g.tag
      order by n desc
      limit 8`,
    [id],
  )
  return NextResponse.json({ ...insights, accepted: model ?? null, her_picks: picks })
}

/**
 * The taps. Each one accepts a proposal; nothing here invents a value.
 *
 *   verticals  { verticals: [{format, name, tier}] } — also becomes her
 *              `formats`, which is what matching reads
 *   similar    { handles: string[] }
 *   wont_do    { format: string } — added to the list she is never sent
 */
export async function POST(request: Request, { params }: Params) {
  const denied = await guardAccess(request)
  if (denied) return denied
  const { id } = await params
  const body = await request.json().catch(() => ({}))

  if (body.action === 'verticals' && Array.isArray(body.verticals)) {
    const clean = body.verticals
      .filter((v: unknown): v is { format: string; name?: unknown; tier?: unknown } =>
        typeof v === 'object' && v !== null && typeof (v as { format?: unknown }).format === 'string')
      .filter((v: { format: string }) => isValidTag('format', v.format))
      .slice(0, 5)
      .map((v: { format: string; name?: unknown; tier?: unknown }) => ({
        format: v.format,
        name: typeof v.name === 'string' ? v.name.slice(0, 80) : v.format,
        tier: v.tier === 'A' || v.tier === 'B' || v.tier === 'C' ? v.tier : null,
      }))
    await sql.query(
      `update transcriber.models set verticals = $2::jsonb, formats = $3::text[], updated_at = now()
        where id = $1`,
      [id, JSON.stringify(clean), clean.map((v: { format: string }) => v.format)],
    )
    return NextResponse.json({ ok: true, verticals: clean })
  }

  if (body.action === 'similar' && Array.isArray(body.handles)) {
    const handles = body.handles
      .filter((h: unknown): h is string => typeof h === 'string' && /^[a-z0-9._]{1,30}$/.test(h))
      .slice(0, 3)
    await sql.query(`update transcriber.models set similar_creators = $2::text[], updated_at = now() where id = $1`, [id, handles])
    return NextResponse.json({ ok: true, similar: handles })
  }

  if (body.action === 'wont_do' && typeof body.format === 'string' && isValidTag('format', body.format)) {
    await sql.query(
      `update transcriber.models
          set wont_do = (select array_agg(distinct x) from unnest(wont_do || array[$2]::text[]) x),
              updated_at = now()
        where id = $1`,
      [id, body.format],
    )
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: 'unknown action' }, { status: 400 })
}
