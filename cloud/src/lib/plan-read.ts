import { sql } from './db'
import { alsoOn } from './match'
import { preview } from './sql'

/** Every week a model has had, counted — the plan editor's week rail. */
export function planWeeks(modelId: string) {
  return sql.query(
    `select p.id, to_char(p.week_of, 'YYYY-MM-DD') as week_of,
            to_char(p.due_date, 'YYYY-MM-DD') as due_date,
            p.title, p.status, p.sent_at,
            count(i.id)::int as items,
            count(i.id) filter (where i.filmed_at is not null)::int as filmed,
            count(i.id) filter (where i.uploaded_at is null and i.r2_purged_at is null)::int as waiting,
            count(i.id) filter (where i.model_note is not null and i.seen_at is null)::int as unread
       from transcriber.plans p
       left join transcriber.plan_items i on i.plan_id = p.id
      where p.model_id = $1
      group by p.id
      order by p.week_of desc`,
    [modelId],
  )
}

/** One plan, as the editor needs it: the week, the model, and every item with
 *  enough of its library row attached to be recognisable at a glance. The two
 *  reads are independent, so they go out together — the editor's first paint
 *  waits on the slower of them, not on both in a row. */
export async function readPlan(id: string) {
  const [[plan], items] = await Promise.all([
    sql.query(
      `select p.id, p.model_id, to_char(p.week_of, 'YYYY-MM-DD') as week_of,
              to_char(p.due_date, 'YYYY-MM-DD') as due_date,
              p.title, p.intro, p.status, p.sent_at, p.target, p.style_targets,
              m.name as model_name, m.access_token, m.token_revoked_at,
              m.weekly_target, m.timezone, m.filming_days, m.standing_rules,
              m.wont_do, m.plan_template,
              p.telegram_state, p.telegram_variant, p.telegram_done_at, p.telegram_error,
              m.telegram_chat_id, g.title as telegram_title, g.skip_campaigns as telegram_skips
         from transcriber.plans p
         join transcriber.models m on m.id = p.model_id
         left join transcriber.telegram_groups g on g.chat_id = m.telegram_chat_id
        where p.id = $1`,
      [id],
    ),
    sql.query(
      `select i.id, i.job_id, i.position, i.notes, i.notes_to_model, i.editing_notes, i.editor_id,
              i.wardrobe, i.camera, i.takes, i.sound, i.hook, i.caption,
              -- t.title below is the reference's own title on Instagram, so the
              -- card's own name has to arrive under a different one.
              i.card_no, i.title as item_title, i.location, i.bucket, i.style, i.source_post, i.repurposed_at, i.rating, i.made_at, i.made_url,
              i.versions,
              i.source, i.twist, i.hide_film, i.hide_captions,
              i.filmed_at, i.posted_at, i.post_url,
              i.model_note, i.model_note_at, i.seen_at,
              i.accepted_at, i.declined_at, i.decline_reason, i.decline_code,
              i.r2_key, i.r2_bytes, i.uploaded_at, i.r2_purged_at,
              i.take_key, i.take_bytes, i.take_duration_sec, i.take_uploaded_at,
              t.author, t.title, t.webpage_url, t.duration_sec, t.folder,
              -- A card pasted a minute ago has no transcript row yet; the job's
              -- own status is what tells "still downloading" from "no video".
              j.status as job_status,
              (t.thumbnail is not null) as has_thumb,
              ${preview('t.plain', 160, 't.on_screen_text')} as preview,
              -- Who else is carrying this same reel. The editor flags it rather
              -- than refusing it: two creators on one trend is sometimes the
              -- point, and it is only a mistake when nobody knew.
              ${alsoOn('i.job_id', 'pl.model_id')} as also_on,
              coalesce(m.messages, '[]'::json) as messages,
              coalesce(m.unread, 0)::int as unread
         from transcriber.plan_items i
         join transcriber.plans pl on pl.id = i.plan_id
         left join transcriber.transcripts t on t.job_id = i.job_id
         left join transcriber.jobs j on j.id = i.job_id
         left join lateral (
           select json_agg(json_build_object(
                    'id',     n.id,
                    'author', n.author,
                    'body',   n.body,
                    'at',     to_char(n.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
                    'seen',   n.seen_at is not null
                  ) order by n.created_at) as messages,
                  -- Unread here is the mirror of her side: what she has said
                  -- that Geno has not read.
                  count(*) filter (where n.author = 'model' and n.seen_at is null) as unread
             from transcriber.plan_messages n
            where n.item_id = i.id
         ) m on true
        where i.plan_id = $1
        order by i.position, i.created_at`,
      [id],
    ),
  ])
  return plan ? { plan, items } : null
}

/**
 * Every card a model has ever been sent, flat and searchable (Geno,
 * 2026-10-11): she answers by label — "V-87" — and the card she means can sit
 * on any week she has ever had. One read of her history, held on the client and
 * filtered there by `card-find`, is what turns that label back into a video.
 *
 * Thin on purpose. This is the row a search result draws, not the card editor's
 * row: enough to recognise it, plus the week and item id needed to jump to it.
 */
export function findableCards(modelId: string) {
  return sql.query(
    `select i.id as item_id, i.plan_id, to_char(p.week_of, 'YYYY-MM-DD') as week_of,
            i.card_no, i.title as item_title, i.hook, i.caption, i.notes,
            i.location, i.wardrobe, i.job_id,
            i.model_note, i.model_note_at, i.decline_reason,
            i.filmed_at is not null as filmed,
            case when i.declined_at is not null then 'declined'
                 when i.accepted_at is not null then 'accepted'
                 else 'open' end as verdict,
            -- Unread is hers unanswered: she said something and nobody has
            -- opened it. It is both a sort key and the badge on the button.
            (i.model_note is not null and i.seen_at is null) as unread,
            t.author, t.title as reel_title, t.webpage_url,
            (t.thumbnail is not null) as has_thumb,
            ${preview('t.plain', 120, 't.on_screen_text')} as preview
       from transcriber.plan_items i
       join transcriber.plans p on p.id = i.plan_id
       left join transcriber.transcripts t on t.job_id = i.job_id
      where p.model_id = $1
      order by p.week_of desc, i.position, i.created_at`,
    [modelId],
  )
}
