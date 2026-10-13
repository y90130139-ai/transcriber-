import { sql } from './db'
import { newId } from './models'

/**
 * The team inbox (Geno, 2026-10-12): threads between the team and their
 * models, and group chats mixing both. One engine, two doors — the console
 * (team session) and the app (model session) call the same functions, so the
 * two sides can never disagree about what a thread is.
 *
 * Members: models are `transcriber.models` ids; team members are Supabase
 * `team_members` ids — `member_type` says which world an id belongs to.
 * Unread is counted from each member's own `seen_at`.
 */

export type ThreadMember = {
  type: 'model' | 'team'
  id: string
  name: string | null
  /** Each side's last-seen stamp — the app's "Seen" receipt reads it
   *  (2026-10-13). Null until that side ever opened the thread. */
  seen_at?: string | null
}

/** One emoji's tally on a message, as one viewer sees it (2026-10-13). */
export type MessageReaction = { emoji: string; count: number; mine: boolean }

/** What a reply quotes — everything a bubble needs to draw it (2026-10-13). */
export type ReplyPreview = {
  id: string
  author_type: 'model' | 'team'
  author_name: string | null
  body: string
  attachment_type: string | null
  deleted: boolean
}

export type ThreadMessage = {
  id: string
  author_type: 'model' | 'team'
  author_id: string | null
  author_name: string | null
  body: string
  attachment_key: string | null
  attachment_type: string | null
  attachment_name: string | null
  /** 'system' notes ("Geno has been added") render centred, never counted. */
  kind: 'user' | 'system'
  /** True once the author edited it — the room marks it (2026-10-13). */
  edited: boolean
  /** True once the author deleted it — a tombstone, not a hole (2026-10-13). */
  deleted: boolean
  /** The tapbacks on this message, one entry per emoji (2026-10-13). */
  reactions: MessageReaction[]
  /** The message this one answers, if any (2026-10-13). */
  reply_to: ReplyPreview | null
  /** A forwarded copy keeps the original's words and gets a mark. */
  forwarded: boolean
  at: string
}

export type ThreadSummary = {
  id: string
  title: string | null
  /** The group's picture, an inbox key both doors can read (2026-10-13). */
  photo: string | null
  members: ThreadMember[]
  last: {
    body: string
    author_type: 'team' | 'model' | null
    author_name: string | null
    attachment_type: string | null
    deleted: boolean
    at: string
  } | null
  unread: number
  /** Muted threads keep their place but stop demanding attention — the team
   *  mutes the whole thread, a model mutes their own seat (2026-10-13). */
  muted: boolean
  /** How many files and messages the whole thread holds — the list's tabs
   *  and the details rail read them (2026-10-12). */
  files: number
  messages_count: number
  created_at: string
}

const TIME = (column: string) => `to_char(${column} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`

/** The JSON shape of one message row — shared by the thread read, the send
 *  answer and the info lookup, so every door sees the same fields
 *  (reactions, reply, forwarded — 2026-10-13). `$2` is the viewer kind and
 *  `$3` their id; `mine` marks a reaction the viewer placed. */
const MESSAGE_JSON = `json_build_object(
  'id', x.id, 'author_type', x.author_type, 'author_id', x.author_id, 'author_name', x.author_name,
  'body', x.body, 'attachment_key', x.attachment_key, 'attachment_type', x.attachment_type,
  'attachment_name', x.attachment_name, 'kind', x.kind,
  'edited', x.edited_at is not null,
  'deleted', x.deleted_at is not null,
  'forwarded', x.forwarded,
  'at', ${TIME('x.created_at')},
  'reactions', coalesce((
    select json_agg(json_build_object('emoji', r.emoji, 'count', r.count, 'mine', r.mine) order by r.first_at)
      from (
        select rr.emoji, count(*)::int as count,
               bool_or(rr.member_type = $2 and ($3::text is null or rr.member_id = $3)) as mine,
               min(rr.created_at) as first_at
          from transcriber.thread_reactions rr
         where rr.message_id = x.id
         group by rr.emoji
      ) r
  ), '[]'::json),
  'reply_to', (
    select json_build_object('id', y.id, 'author_type', y.author_type, 'author_name', y.author_name,
                             'body', y.body, 'attachment_type', y.attachment_type,
                             'deleted', y.deleted_at is not null)
      from transcriber.thread_messages y where y.id = x.reply_to_id
  ))`

/** One raw row of MESSAGE_JSON, into the typed message every screen reads. */
function toThreadMessage(raw: Record<string, unknown>): ThreadMessage {
  const reactions = Array.isArray(raw.reactions)
    ? (raw.reactions as Record<string, unknown>[])
        .map((one) => ({ emoji: String(one.emoji ?? ''), count: Number(one.count ?? 0), mine: Boolean(one.mine) }))
        .filter((one) => one.emoji.length > 0 && one.count > 0)
    : []
  const reply = raw.reply_to && typeof raw.reply_to === 'object' ? (raw.reply_to as Record<string, unknown>) : null
  return {
    id: String(raw.id),
    author_type: raw.author_type === 'team' ? 'team' : 'model',
    author_id: (raw.author_id as string | null) ?? null,
    author_name: (raw.author_name as string | null) ?? null,
    body: String(raw.body ?? ''),
    attachment_key: (raw.attachment_key as string | null) ?? null,
    attachment_type: (raw.attachment_type as string | null) ?? null,
    attachment_name: (raw.attachment_name as string | null) ?? null,
    kind: raw.kind === 'system' ? 'system' : 'user',
    edited: Boolean(raw.edited),
    deleted: Boolean(raw.deleted),
    reactions,
    reply_to: reply
      ? {
          id: String(reply.id ?? ''),
          author_type: reply.author_type === 'team' ? 'team' : 'model',
          author_name: (reply.author_name as string | null) ?? null,
          body: String(reply.body ?? ''),
          attachment_type: (reply.attachment_type as string | null) ?? null,
          deleted: Boolean(reply.deleted),
        }
      : null,
    forwarded: Boolean(raw.forwarded),
    at: String(raw.at),
  }
}

/** Shared thread list: every thread this side may see, newest activity first,
 *  with members, last message and this side's unread count. A "deleted" chat
 *  is hidden per seat — a message newer than the hide brings it back. */
async function listThreads(kind: 'team' | 'model', memberId: string | null): Promise<ThreadSummary[]> {
  const rows = await sql.query(
    `select t.id, t.title, t.photo_key, ${TIME('t.created_at')} as created_at,
            case when $1 = 'team' then t.muted
                 else coalesce((select m4.muted from transcriber.thread_members m4
                                 where m4.thread_id = t.id and m4.member_type = 'model' and m4.member_id = $2), false)
            end as muted,
            coalesce((
              select json_agg(json_build_object('type', m.member_type, 'id', m.member_id, 'name', m.display_name))
                from transcriber.thread_members m where m.thread_id = t.id
            ), '[]'::json) as members,
            (
              select json_build_object(
                       'body', x.body,
                       'author_type', x.author_type,
                       'author_name', x.author_name,
                       'attachment_type', x.attachment_type,
                       'deleted', x.deleted_at is not null,
                       'at', ${TIME('x.created_at')})
                from transcriber.thread_messages x
               where x.thread_id = t.id
               order by x.created_at desc limit 1
            ) as last,
            (
              select count(*)::int from transcriber.thread_messages x
               where x.thread_id = t.id
                 and x.author_type <> $1
                 and x.kind = 'user'
                 and x.created_at > coalesce((
                   select max(m2.seen_at) from transcriber.thread_members m2
                    where m2.thread_id = t.id and m2.member_type = $1
                      and ($1 = 'team' or m2.member_id = $2)
                 ), 'epoch'::timestamptz)
            ) as unread,
            (
              select count(*)::int from transcriber.thread_messages x
               where x.thread_id = t.id and x.attachment_key is not null
            ) as files,
            (
              select count(*)::int from transcriber.thread_messages x
               where x.thread_id = t.id
            ) as messages_count
       from transcriber.threads t
      where ($1 = 'team'
              and not exists (
                select 1 from transcriber.thread_hides h
                 where h.thread_id = t.id
                   and h.member_type = 'team'
                   and h.member_id = $2
                   and h.hidden_at >= coalesce(
                     (select max(x.created_at) from transcriber.thread_messages x where x.thread_id = t.id),
                     t.created_at
                   )
              ))
         or ($1 = 'model'
              and exists (select 1 from transcriber.thread_members m3
                           where m3.thread_id = t.id and m3.member_type = 'model' and m3.member_id = $2)
              and not exists (
                select 1 from transcriber.thread_hides h
                 where h.thread_id = t.id
                   and h.member_type = 'model'
                   and h.member_id = $2
                   and h.hidden_at >= coalesce(
                     (select max(x.created_at) from transcriber.thread_messages x where x.thread_id = t.id),
                     t.created_at
                   )
              ))
      order by coalesce(t.last_message_at, t.created_at) desc
      limit 100`,
    [kind, memberId],
  )
  return rows.map((row) => ({
    id: String(row.id),
    title: (row.title as string | null) ?? null,
    photo: (row.photo_key as string | null) ?? null,
    members: Array.isArray(row.members) ? (row.members as ThreadMember[]) : [],
    last: row.last ?? null,
    unread: Number(row.unread ?? 0),
    muted: Boolean(row.muted),
    files: Number(row.files ?? 0),
    messages_count: Number(row.messages_count ?? 0),
    created_at: String(row.created_at),
  }))
}

export const threadsForTeam = (memberId: string | null) => listThreads('team', memberId)
export const threadsForModel = (modelId: string) => listThreads('model', modelId)

/** The thread and its messages — membership enforced for models, flat 404 on
 *  anything that is not theirs. One query does it all (Geno, 2026-10-13):
 *  the seen stamp rides in a data-modifying CTE, so opening a thread costs
 *  a single round trip to Neon instead of four. */
export async function readThread(
  threadId: string,
  kind: 'team' | 'model',
  memberId: string | null,
): Promise<{ thread: ThreadSummary; messages: ThreadMessage[] } | null> {
  const [row] = await sql.query(
    `with touch as (
       update transcriber.thread_members set seen_at = now()
        where thread_id = $1 and member_type = $2
          and ($2 = 'team' or member_id = $3)
     ),
     t as (
       select threads.id, threads.title, threads.photo_key,
              case when $2 = 'team' then threads.muted
                   else coalesce((select m4.muted from transcriber.thread_members m4
                                   where m4.thread_id = threads.id and m4.member_type = 'model' and m4.member_id = $3), false)
              end as muted,
               ${TIME('threads.created_at')} as created_at,
               coalesce((
                 select json_agg(json_build_object('type', m.member_type, 'id', m.member_id, 'name', m.display_name,
                                                   'seen_at', ${TIME('m.seen_at')}))
                   from transcriber.thread_members m where m.thread_id = threads.id
               ), '[]'::json) as members
          from transcriber.threads
        where threads.id = $1
          and ($2 = 'team' or exists (
                select 1 from transcriber.thread_members mm
                 where mm.thread_id = threads.id and mm.member_type = 'model' and mm.member_id = $3
              ))
     )
     select
       (select row_to_json(t) from t) as thread,
       coalesce((
         select json_agg(${MESSAGE_JSON} order by x.created_at)
            from (select * from transcriber.thread_messages
                   where thread_id = $1 order by created_at limit 500) x
        ), '[]'::json) as messages`,
    [threadId, kind, memberId],
  )

  if (!row || !row.thread) return null
  const thread = row.thread as {
    id: string
    title: string | null
    photo_key: string | null
    muted: boolean
    created_at: string
    members: ThreadMember[]
  }
  const raw = Array.isArray(row.messages) ? (row.messages as Record<string, unknown>[]) : []
  const messages: ThreadMessage[] = raw.map(toThreadMessage)

  return {
    thread: {
      id: String(thread.id),
      title: thread.title ?? null,
      photo: thread.photo_key ?? null,
      members: Array.isArray(thread.members) ? thread.members : [],
      last: null,
      unread: 0,
      muted: Boolean(thread.muted),
      files: messages.filter((message) => message.kind === 'user' && message.attachment_key !== null).length,
      messages_count: messages.length,
      created_at: String(thread.created_at),
    },
    messages,
  }
}

/** Opening a thread is reading it: stamps this side's seen. */
export async function markThreadSeen(threadId: string, kind: 'team' | 'model', memberId: string | null): Promise<void> {
  if (kind === 'team') {
    await sql.query(
      `update transcriber.thread_members set seen_at = now()
        where thread_id = $1 and member_type = 'team'`,
      [threadId],
    )
    return
  }
  await sql.query(
    `update transcriber.thread_members set seen_at = now()
      where thread_id = $1 and member_type = 'model' and member_id = $2`,
    [threadId, memberId],
  )
}

/** Is this side in the thread at all? The gate every per-message action
 *  passes before it may touch anything (2026-10-13). */
export async function isThreadMember(
  threadId: string,
  kind: 'team' | 'model',
  memberId: string | null,
): Promise<boolean> {
  const rows = await sql.query(
    `select 1 from transcriber.thread_members
      where thread_id = $1 and member_type = $2
        and ($2 = 'team' or member_id = $3)`,
    [threadId, kind, memberId],
  )
  return rows.length > 0
}

export async function sendThreadMessage({
  threadId,
  authorType,
  authorId,
  authorName,
  body,
  attachment,
  replyToId,
  forwarded = false,
}: {
  threadId: string
  authorType: 'team' | 'model'
  authorId: string | null
  authorName: string | null
  body: string
  attachment?: { key: string; type: string; name: string | null } | null
  /** The message this one answers — validated to live in the same thread. */
  replyToId?: string | null
  forwarded?: boolean
}): Promise<ThreadMessage | null> {
  const [exists] = await sql.query(`select id from transcriber.threads where id = $1`, [threadId])
  if (!exists) return null

  // A quote must point at a message in this very thread - anything else is
  // dropped quietly, never trusted (2026-10-13).
  let reply: string | null = null
  if (replyToId) {
    const [target] = await sql.query(
      `select id from transcriber.thread_messages where id = $1 and thread_id = $2 and kind = 'user'`,
      [replyToId, threadId],
    )
    if (target) reply = replyToId
  }

  const id = newId()
  await sql.query(
    `insert into transcriber.thread_messages
       (id, thread_id, author_type, author_id, author_name, body,
        attachment_key, attachment_type, attachment_name, reply_to_id, forwarded)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      id,
      threadId,
      authorType,
      authorId,
      authorName,
      body.slice(0, 4000),
      attachment?.key ?? null,
      attachment?.type ?? null,
      attachment?.name ?? null,
      reply,
      forwarded,
    ],
  )
  await sql.query(
    `update transcriber.threads
        set last_message_at = now(), updated_at = now()
      where id = $1`,
    [threadId],
  )
  // The author has obviously read their own thread.
  if (authorType === 'team') {
    await sql.query(`update transcriber.thread_members set seen_at = now() where thread_id = $1 and member_type = 'team'`, [threadId])
  } else if (authorId) {
    await sql.query(
      `update transcriber.thread_members set seen_at = now() where thread_id = $1 and member_type = 'model' and member_id = $2`,
      [threadId, authorId],
    )
  }
  return singleThreadMessage(threadId, id, authorType, authorId)
}

/** One message, freshly written or looked up — same JSON as the thread read,
 *  so the app can splice it straight into its list (2026-10-13). */
export async function singleThreadMessage(
  threadId: string,
  messageId: string,
  kind: 'team' | 'model',
  memberId: string | null,
): Promise<ThreadMessage | null> {
  const [row] = await sql.query(
    `select ${MESSAGE_JSON} as message
       from transcriber.thread_messages x
      where x.id = $1 and x.thread_id = $4`,
    [messageId, kind, memberId, threadId],
  )
  if (!row?.message) return null
  return toThreadMessage(row.message as Record<string, unknown>)
}

/** A tapback (2026-10-13): one reaction per member per message — the same
 *  emoji again removes it, a different one replaces it. Null when the
 *  message is not theirs to react to; otherwise the new tally, as the
 *  actor's own side sees it (with `mine`). */
export async function toggleThreadReaction({
  threadId,
  messageId,
  memberType,
  memberId,
  emoji,
}: {
  threadId: string
  messageId: string
  memberType: 'team' | 'model'
  memberId: string
  emoji: string
}): Promise<MessageReaction[] | null> {
  const clean = emoji.trim().slice(0, 16)
  if (!clean) return null

  const [target] = await sql.query(
    `select id from transcriber.thread_messages
      where id = $1 and thread_id = $2 and kind = 'user' and deleted_at is null`,
    [messageId, threadId],
  )
  if (!target) return null

  const [current] = await sql.query(
    `select emoji from transcriber.thread_reactions
      where message_id = $1 and member_type = $2 and member_id = $3`,
    [messageId, memberType, memberId],
  )
  if (current && current.emoji === clean) {
    await sql.query(
      `delete from transcriber.thread_reactions
        where message_id = $1 and member_type = $2 and member_id = $3`,
      [messageId, memberType, memberId],
    )
  } else {
    await sql.query(
      `insert into transcriber.thread_reactions (message_id, thread_id, member_type, member_id, emoji)
       values ($1, $2, $3, $4, $5)
       on conflict (message_id, member_type, member_id)
       do update set emoji = $5, created_at = now()`,
      [messageId, threadId, memberType, memberId, clean],
    )
  }
  return reactionsFor(messageId, memberType, memberId)
}

/** One message's tally, as one side sees it. */
export async function reactionsFor(
  messageId: string,
  kind: 'team' | 'model',
  memberId: string | null,
): Promise<MessageReaction[]> {
  const rows = await sql.query(
    `select emoji, count(*)::int as count,
            bool_or(member_type = $2 and ($3::text is null or member_id = $3)) as mine
       from transcriber.thread_reactions
      where message_id = $1
      group by emoji
      order by min(created_at)`,
    [messageId, kind, memberId],
  )
  return rows.map((row) => ({
    emoji: String(row.emoji ?? ''),
    count: Number(row.count ?? 0),
    mine: Boolean(row.mine),
  }))
}

/** Forward (2026-10-13): the message lands in another thread as a new copy,
 *  marked forwarded. The words and the file ride along; editing or deleting
 *  the original never touches the copy, and vice versa. */
export async function forwardThreadMessage({
  fromThreadId,
  messageId,
  toThreadId,
  authorType,
  authorId,
  authorName,
}: {
  fromThreadId: string
  messageId: string
  toThreadId: string
  authorType: 'team' | 'model'
  authorId: string | null
  authorName: string | null
}): Promise<ThreadMessage | null> {
  if (fromThreadId === toThreadId) return null
  const [source] = await sql.query(
    `select body, attachment_key, attachment_type, attachment_name, kind, deleted_at
       from transcriber.thread_messages
      where id = $1 and thread_id = $2`,
    [messageId, fromThreadId],
  )
  if (!source || source.kind !== 'user' || source.deleted_at) return null
  const key = (source.attachment_key as string | null) ?? null
  return sendThreadMessage({
    threadId: toThreadId,
    authorType,
    authorId,
    authorName,
    body: String(source.body ?? ''),
    attachment: key
      ? {
          key,
          type: (source.attachment_type as string | null) ?? 'image/jpeg',
          name: (source.attachment_name as string | null) ?? null,
        }
      : null,
    forwarded: true,
  })
}

/** Who has seen one message (2026-10-13). Each side carries its own
 *  `seen_at`; a message is seen when that stamp is at or past it. The team
 *  shares one seen state (any member's open counts for all), so its people
 *  collapse into a single entry — the room never claims a person saw
 *  something the team read as one. */
export async function messageSeenBy(
  threadId: string,
  messageId: string,
): Promise<{ sent_at: string; seen_by: { type: 'model' | 'team'; id: string; name: string | null; at: string }[] } | null> {
  const [message] = await sql.query(
    `select ${TIME('created_at')} as sent_at from transcriber.thread_messages
      where id = $1 and thread_id = $2`,
    [messageId, threadId],
  )
  if (!message) return null

  const rows = await sql.query(
    `select member_type, member_id, display_name, ${TIME('seen_at')} as seen_at
       from transcriber.thread_members
      where thread_id = $1 and seen_at is not null`,
    [threadId],
  )

  const sent = new Date(String(message.sent_at)).getTime()
  const seenBy: { type: 'model' | 'team'; id: string; name: string | null; at: string }[] = []
  const team: { names: (string | null)[]; at: string } = { names: [], at: '' }
  for (const row of rows) {
    const at = String(row.seen_at)
    if (new Date(at).getTime() < sent) continue
    if (row.member_type === 'team') {
      team.names.push((row.display_name as string | null) ?? null)
      if (!team.at || at > team.at) team.at = at
    } else {
      seenBy.push({
        type: 'model',
        id: String(row.member_id),
        name: (row.display_name as string | null) ?? null,
        at,
      })
    }
  }
  if (team.at) {
    seenBy.push({
      type: 'team',
      id: 'team',
      name: team.names.length === 1 ? team.names[0] : 'The team',
      at: team.at,
    })
  }
  seenBy.sort((a, b) => a.at.localeCompare(b.at))
  return { sent_at: String(message.sent_at), seen_by: seenBy }
}

/** A new thread. The creator is added as a member by the caller. */
export async function createThread({
  title,
  createdBy,
  members,
}: {
  title: string | null
  createdBy: string | null
  members: ThreadMember[]
}): Promise<string> {
  const id = newId()
  await sql.query(`insert into transcriber.threads (id, title, created_by) values ($1, $2, $3)`, [
    id,
    title?.trim() || null,
    createdBy,
  ])
  await addThreadMembers(id, members)
  return id
}

/** Joins people to a thread. With an `actor`, whoever is NEW earns a system
 *  note in the stream — "Geno has been added" (Geno, 2026-10-13) — so the
 *  room reads the way WhatsApp taught everyone to read it. */
export async function addThreadMembers(
  threadId: string,
  members: ThreadMember[],
  actor?: { name: string | null },
): Promise<ThreadMember[]> {
  const clean = members.filter((member) => member.id && (member.type === 'model' || member.type === 'team'))
  if (clean.length === 0) return []
  const joined = await sql.query(
    `insert into transcriber.thread_members (thread_id, member_type, member_id, display_name)
     select $1, unnest($2::text[]), unnest($3::text[]), unnest($4::text[])
     on conflict (thread_id, member_type, member_id) do nothing
     returning member_type, member_id, display_name`,
    [
      threadId,
      clean.map((member) => member.type),
      clean.map((member) => member.id),
      clean.map((member) => member.name ?? null),
    ],
  )
  if (!actor) return joined.map((row) => ({
    type: row.member_type === 'model' ? ('model' as const) : ('team' as const),
    id: String(row.member_id),
    name: (row.display_name as string | null) ?? null,
  }))

  const added = joined.map((row) => ({
    type: row.member_type === 'model' ? ('model' as const) : ('team' as const),
    id: String(row.member_id),
    name: (row.display_name as string | null) ?? null,
  }))
  for (const member of added) {
    const who = member.name ?? member.id
    await sql.query(
      `insert into transcriber.thread_messages
         (id, thread_id, author_type, author_id, author_name, body, kind)
       values ($1, $2, 'team', null, null, $3, 'system')`,
      [newId(), threadId, `${actor.name ?? 'The team'} added ${who}`],
    )
    await sql.query(`update transcriber.threads set updated_at = now() where id = $1`, [threadId])
  }
  return added
}

/* --------------------------------------------------- thread operations
   The console's right-click menu (Geno, 2026-10-13): delete, mute, and
   mark-unread. All team-side; the app never calls these. */

/** Delete chat, for one seat only (Geno, 2026-10-13): a hide. Nobody else
 *  loses anything, and any message newer than the hide brings it back —
 *  for this seat alone. */
export async function hideThreadForMember(
  threadId: string,
  memberType: 'team' | 'model',
  memberId: string,
): Promise<void> {
  await sql.query(
    `insert into transcriber.thread_hides (thread_id, member_type, member_id, hidden_at)
     values ($1, $2, $3, now())
     on conflict (thread_id, member_type, member_id) do update set hidden_at = now()`,
    [threadId, memberType, memberId],
  )
}

/** Mute (or unmute) the whole thread for the team. */
export async function setThreadMuted(threadId: string, muted: boolean): Promise<void> {
  await sql.query(`update transcriber.threads set muted = $2, updated_at = now() where id = $1`, [threadId, muted])
}

/** Mute just one model's seat - her own switch in the app (2026-10-13). */
export async function setMemberMuted(threadId: string, memberId: string, muted: boolean): Promise<void> {
  await sql.query(
    `update transcriber.thread_members set muted = $3
      where thread_id = $1 and member_type = 'model' and member_id = $2`,
    [threadId, memberId, muted],
  )
}

/** Rename a group (or clear the name with null). */
export async function setThreadTitle(threadId: string, title: string | null): Promise<void> {
  const clean = title?.trim().slice(0, 80) || null
  await sql.query(`update transcriber.threads set title = $2, updated_at = now() where id = $1`, [threadId, clean])
}

/** Set (or clear) the group's picture - a key both doors can read. */
export async function setThreadPhoto(threadId: string, photoKey: string | null): Promise<void> {
  await sql.query(`update transcriber.threads set photo_key = $2, updated_at = now() where id = $1`, [
    threadId,
    photoKey,
  ])
}

/** Mark unread for one seat: rewind this side's seen stamp to just before
 *  the latest message from the other side, so it reads unread again. */
export async function markThreadUnread(
  threadId: string,
  kind: 'team' | 'model',
  memberId: string | null,
): Promise<void> {
  await sql.query(
    `update transcriber.thread_members
        set seen_at = (
          select greatest(max(x.created_at) - interval '1 second', 'epoch'::timestamptz)
            from transcriber.thread_messages x
           where x.thread_id = $1 and x.author_type <> $2
        )
      where thread_id = $1 and member_type = $2
        and ($2 = 'team' or member_id = $3)`,
    [threadId, kind, memberId],
  )
}

/** Your own message, edited — each side only ever touches its own, and a
 *  system note is nobody's to touch (2026-10-13). False when not allowed. */
export async function editThreadMessage(
  threadId: string,
  messageId: string,
  authorType: 'team' | 'model',
  body: string,
): Promise<boolean> {
  const rows = await sql.query(
    `update transcriber.thread_messages
        set body = $4, edited_at = now()
      where id = $2 and thread_id = $1 and author_type = $3 and kind = 'user' and deleted_at is null
      returning id`,
    [threadId, messageId, authorType, body.slice(0, 4000)],
  )
  if (rows.length === 0) return false
  await sql.query(`update transcriber.threads set updated_at = now() where id = $1`, [threadId])
  return true
}

/** Your own message, deleted — a tombstone, not a hole (Geno, 2026-10-13):
 *  the words and the file go, the place in the timeline stays, and both
 *  sides render "this message was deleted" in place. */
export async function deleteThreadMessage(
  threadId: string,
  messageId: string,
  authorType: 'team' | 'model',
): Promise<boolean> {
  const rows = await sql.query(
    `update transcriber.thread_messages
        set deleted_at = now(),
            body = '',
            attachment_key = null,
            attachment_type = null,
            attachment_name = null
      where id = $2 and thread_id = $1 and author_type = $3 and kind = 'user' and deleted_at is null
      returning id`,
    [threadId, messageId, authorType],
  )
  if (rows.length === 0) return false
  await sql.query(`update transcriber.threads set updated_at = now() where id = $1`, [threadId])
  return true
}

/** The models in a thread — who a team message pushes to. A seat that
 *  muted the chat keeps its quiet: it is not phoned (2026-10-13). */
export async function modelMembersOf(threadId: string): Promise<string[]> {
  const rows = await sql.query(
    `select member_id from transcriber.thread_members
      where thread_id = $1 and member_type = 'model' and muted = false`,
    [threadId],
  )
  return rows.map((row) => String(row.member_id))
}

/** Is this key one of ours? Attachment reads and writes both check. */
export const isInboxKey = (key: string) => /^inbox\/[A-Za-z0-9_-]{4,64}\/[A-Za-z0-9_-]{4,64}\.[a-z0-9]{2,5}$/.test(key)
export const threadIdOfKey = (key: string) => key.split('/')[1] ?? ''
