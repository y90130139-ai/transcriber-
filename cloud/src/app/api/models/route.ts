import { NextResponse } from 'next/server'
import { isSignedIn } from '@/lib/auth'
import { sql } from '@/lib/db'
import { currentWeekOf } from '@/lib/dates'
import { modelsForJob } from '@/lib/match'
import { accountsForModels } from '@/lib/model-accounts'
import { MODEL_COLUMNS, MODEL_COLUMNS_ALIASED, linkedOnlyfans, newId, newToken, readModelInput } from '@/lib/models'

const unauthorized = () => NextResponse.json({ error: 'unauthorized' }, { status: 401 })

/** The roster, each card carrying what this week actually looks like. */
export async function GET(request: Request) {
  if (!(await isSignedIn())) return unauthorized()

  // `?job=` asks a different question — which of our models suit this video —
  // and is answered on its own. Without it the response must stay exactly what
  // the roster grid already expects.
  const job = new URL(request.url).searchParams.get('job')
  if (job) return NextResponse.json({ models: await modelsForJob(job) })

  const models = await sql.query(
    `select ${MODEL_COLUMNS_ALIASED}, ${linkedOnlyfans('m')},
            coalesce(w.items, 0)::int   as week_items,
            coalesce(w.filmed, 0)::int  as week_filmed,
            coalesce(w.waiting, 0)::int as week_waiting,
            w.plan_id, w.plan_status,
            -- Did the link ever reach her. Null on a week sent before the
            -- column existed, which is not the same as "no".
            (w.opened_at is not null) as week_opened,
            coalesce(u.unread, 0)::int  as unread_notes,
            coalesce(d.declined, 0)::int as week_declined,
            -- The figures strip under her name wants her newest readings and
            -- how many of her own posts the library holds — and wants them the
            -- moment her card opens. Carried here for the same reason the week
            -- above is: the sheet's face is drawn from what the grid already
            -- has, and her own reads replace these the moment they land. Forty
            -- is enough for the spark, the delta and the log's first screen.
            fr.readings,
            coalesce(pc.posts, 0)::int as posts_count
       from transcriber.models m
       left join lateral (
         select p.id as plan_id, p.status as plan_status, p.opened_at,
                count(i.id) as items,
                count(i.id) filter (where i.filmed_at is not null) as filmed,
                count(i.id) filter (where i.uploaded_at is null and i.r2_purged_at is null) as waiting
           from transcriber.plans p
           left join transcriber.plan_items i on i.plan_id = p.id
          where p.model_id = m.id and p.week_of = $1::date
          group by p.id
       ) w on true
       left join lateral (
         -- Messages she has sent that have not been read. Counted off the
         -- thread rather than off plan_items.model_note, so three questions
         -- on one card read as three and not as one.
         select count(*) as unread
           from transcriber.plan_messages n
           join transcriber.plan_items i on i.id = n.item_id
           join transcriber.plans p on p.id = i.plan_id
          where p.model_id = m.id and n.author = 'model' and n.seen_at is null
       ) u on true
       left join lateral (
         -- Cards she has turned down. A decline is a hole in the week and it
         -- has to be visible from the roster, not only from inside the plan.
         select count(*) as declined
           from transcriber.plan_items i
           join transcriber.plans p on p.id = i.plan_id
          where p.model_id = m.id and p.week_of = $1::date and i.declined_at is not null
       ) d on true
       left join lateral (
         select json_agg(reading) as readings
           from (
             select f.id, f.platform, f.followers::int as followers, f.source, f.taken_at
               from transcriber.model_followers f
              where f.model_id = m.id
              order by f.taken_at desc
              limit 40
           ) reading
       ) fr on true
       left join lateral (
         select count(*) as posts
           from transcriber.transcripts t
          where lower(t.author) = lower(m.handle)
       ) pc on true
       order by (m.status = 'active') desc, m.name`,
    [currentWeekOf()],
  )

  // Her app account rides along so the roster shows invite state and offers
  // the button without a request per card (Geno, 2026-10-12). An unreadable
  // account store is a normal state here, not an error: the cards simply show
  // no app state.
  let accounts = new Map<string, { email: string; status: string; lastLoginAt: string | null }>()
  try {
    accounts = await accountsForModels(models.map((model) => String(model.id)))
  } catch {
    /* the store is not configured or unreachable — nothing to show */
  }
  const withAccounts = models.map((model) => ({
    ...model,
    app_account: accounts.get(String(model.id)) ?? null,
  }))

  return NextResponse.json({ models: withAccounts, weekOf: currentWeekOf() })
}

/** Add a model. The share token is minted here and never accepted from a client. */
export async function POST(request: Request) {
  if (!(await isSignedIn())) return unauthorized()

  const body = await request.json().catch(() => ({}))
  const input = readModelInput(body)
  if ('error' in input) return NextResponse.json({ error: input.error }, { status: 400 })

  const [model] = await sql.query(
    `insert into transcriber.models
       (id, name, handle, photo_url, persona, formats, hooks, wont_do,
        status, filming_days, weekly_target, timezone, standing_rules, notes,
        access_token, tier, place, drive_url, delivery_note, ig_account_type,
        socials, creator_type)
     values ($1,$2,$3,$4,$5::text[],$6::text[],$7::text[],$8::text[],
             $9,$10::int[],$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21::jsonb,$22)
     returning ${MODEL_COLUMNS}`,
    [
      newId(), input.name, input.handle, input.photo_url,
      input.persona, input.formats, input.hooks, input.wont_do, input.status,
      input.filming_days, input.weekly_target, input.timezone,
      input.standing_rules, input.notes, newToken(), input.tier, input.place,
      // Appended at the end, the way `tier` and `place` were. The PUT below
      // explains why nothing in either list is ever renumbered.
      input.drive_url, input.delivery_note, input.ig_account_type,
      JSON.stringify(input.socials),
      input.creator_type,
    ],
  )
  return NextResponse.json({ model })
}
