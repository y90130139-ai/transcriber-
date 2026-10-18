import { guardAccess } from '@/lib/access'
import { NextResponse } from 'next/server'
import { bankFor } from '@/lib/bank'
import { sql } from '@/lib/db'
import { verticalsFor } from '@/lib/insights'
import { isTemplate, suggestedTemplate } from '@/lib/template'

type Params = { params: Promise<{ id: string }> }

/**
 * Her winning verticals, for the plan editor's template row: how many of her
 * own reels are winners, which formats they prove out, and which template the
 * ladder suggests. Read-only — setting the template is its own route.
 */
export async function GET(request: Request, { params }: Params) {
  const denied = await guardAccess(request)
  if (denied) return denied
  const { id } = await params

  // Her row and her reel bank are independent reads — one wait (2026-10-09).
  const [[model], bank] = await Promise.all([
    sql.query(
      `select m.persona, m.plan_template,
              (select count(*)::int from transcriber.plans p
                where p.model_id = m.id and p.status = 'sent') as sent
         from transcriber.models m where m.id = $1`,
      [id],
    ),
    bankFor(id),
  ])
  if (!model) return NextResponse.json({ error: 'not found' }, { status: 404 })

  const winners = bank?.winners ?? []
  const verticals = bank ? await verticalsFor(id, bank, (model.persona as string[]) ?? []) : []

  return NextResponse.json({
    winners_count: winners.length,
    winners: winners.slice(0, 5),
    // Only what her own reels prove — the starter fill-ins are for planning,
    // not for telling the operator she has winning verticals she does not.
    verticals: verticals.filter((vertical) => vertical.source === 'her-winners'),
    suggested: suggestedTemplate(winners.length, Number(model.sent ?? 0)),
    template: isTemplate(model.plan_template) ? model.plan_template : null,
  })
}
