import { NextResponse } from 'next/server'
import { sql } from '@/lib/db'
import { modelSessionFrom } from '@/lib/model-auth'
import { cleanStyle, PALETTES } from '@/lib/portal-style'

const PAL_KEYS = new Set<string>(PALETTES.map((palette) => palette.key))

/**
 * Her colour, saved where the console and the web portal already read it
 * (Geno, 2026-10-12): `transcriber.models.portal_style` is one source, and
 * every surface — her app, her `/p/<token>` page — shows the same look.
 *
 * Presets only; the house ember is carried as absence, exactly like the web
 * sheet writes it, so both sides speak one dialect.
 */
export async function POST(request: Request) {
  const session = await modelSessionFrom(request)
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => null)
  const asked = typeof body?.pal === 'string' ? body.pal.trim() : ''
  if (asked && asked !== 'ember' && !PAL_KEYS.has(asked)) {
    return NextResponse.json({ error: 'Unknown colour.' }, { status: 400 })
  }

  const [current] = await sql.query(
    `select portal_style from transcriber.models where id = $1`,
    [session.modelId],
  )
  if (!current) return NextResponse.json({ error: 'no_model' }, { status: 404 })

  const merged = cleanStyle({
    ...(current.portal_style ?? {}),
    pal: asked === '' || asked === 'ember' ? undefined : asked,
  })

  await sql.query(
    `update transcriber.models set portal_style = $2::jsonb, updated_at = now() where id = $1`,
    [session.modelId, JSON.stringify(merged)],
  )
  return NextResponse.json({ ok: true, portal_style: merged })
}
