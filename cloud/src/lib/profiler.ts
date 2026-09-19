/**
 * Who is this creator, and why — proposed, never decided.
 *
 * Persona is the most load-bearing tag in the system: it is inherited by
 * everything a creator posts and it drives which model gets shown her work.
 * It is also the emptiest — 18 of 196 watched creators had one, and reading
 * 178 accounts by hand is not a plan.
 *
 * So the profiler proposes. For each creator it gathers what the sweep already
 * holds — her bio, her best reels' still frames, her captions, and any
 * on-screen text — asks a vision model to choose from **our own vocabulary**,
 * and files the answer with its reasons for a human to take, edit or reject.
 * Nothing reaches `creators.persona` without that tap.
 *
 * Why a model at all, when rule 3 of the constitution says deterministic:
 * because the evidence here is pixels. A lexicon cannot see that a room is
 * black-walled or that the clothes are latex, and in this niche the bios are
 * deliberately empty ("check highlights ↓" — 148 bios, 5 mention goth). The
 * discipline is kept where it matters: a fixed vocabulary, the evidence shown
 * beside the answer, and a human deciding. Same shape as `brief.ts` drafting.
 */
import { sql } from './db'
import taxonomy from './taxonomy.json'

const MODEL = '@cf/mistralai/mistral-small-3.1-24b-instruct'
const API = 'https://api.cloudflare.com/client/v4'

/** Frames carry most of the signal, and each one costs tokens. Eight covers a
 *  creator's range without paying for her whole feed. */
const FRAMES = 8
const CAPTIONS = 15
const MAX_FRAME_BYTES = 900_000
/** At most three: persona is a claim about a person, and a creator described
 *  five ways is described none. */
const MAX_TAGS = 3

export type Proposal = {
  handle: string
  tags: string[]
  why: string
  evidence: { frames: number; captions: number; bio: string | null; followers: number | null }
}

const PERSONA = (taxonomy as { persona: { tags: { id: string; label: string; desc?: string }[] } }).persona.tags
const VALID = new Set(PERSONA.map((tag) => tag.id))

function account(): string {
  const id = process.env.CLOUDFLARE_ACCOUNT_ID ?? process.env.R2_ACCOUNT_ID
  if (!id) throw new Error('no Cloudflare account id')
  return id
}

export function profilerReady(): boolean {
  return Boolean(process.env.CLOUDFLARE_AI_TOKEN && (process.env.CLOUDFLARE_ACCOUNT_ID ?? process.env.R2_ACCOUNT_ID))
}

/** Creators worth profiling: watched, no persona yet, no open proposal, and
 *  enough of a footprint in the sweep to say anything at all. */
export async function unprofiled(limit: number): Promise<string[]> {
  const rows = await sql.query(
    `select c.handle
       from transcriber.creators c
      where c.watch = 'watching'
        and cardinality(c.persona) = 0
        and not exists (select 1 from transcriber.creator_proposals p
                         where p.handle = c.handle and p.decided_at is null)
        and exists (select 1 from transcriber.sightings s
                     where s.handle = c.handle and s.poster_url is not null
                       and s.media_until > now())
      order by (select count(*) from transcriber.sightings s2 where s2.handle = c.handle) desc
      limit $1`,
    [limit],
  )
  return rows.map((row) => String(row.handle))
}

async function frames(handle: string): Promise<string[]> {
  const rows = await sql.query(
    `select poster_url from transcriber.sightings
      where handle = $1 and poster_url is not null and media_until > now()
      order by plays desc nulls last
      limit $2`,
    [handle, FRAMES],
  )
  const out: string[] = []
  for (const row of rows) {
    try {
      const response = await fetch(String(row.poster_url))
      if (!response.ok) continue
      const bytes = Buffer.from(await response.arrayBuffer())
      if (bytes.byteLength > MAX_FRAME_BYTES) continue
      out.push(`data:${response.headers.get('content-type') ?? 'image/jpeg'};base64,${bytes.toString('base64')}`)
    } catch {
      // A dead CDN link is one frame fewer, not a failed profile.
    }
  }
  return out
}

function promptFor(
  handle: string,
  who: { bio: string | null; category: string | null; followers: number | null },
  captions: string[],
  onScreen: string[],
  frameCount: number,
): string {
  const vocabulary = PERSONA.map((tag) => `${tag.id}: ${tag.desc ?? tag.label}`).join('\n')
  const said = captions.map((line) => `- ${line.replace(/\s+/g, ' ').slice(0, 160)}`).join('\n')
  const screen = onScreen.length > 0
    ? `\nText shown on screen in her reels:\n${onScreen.map((t) => `- ${t.replace(/\s+/g, ' ').slice(0, 120)}`).join('\n')}`
    : ''
  return `You label Instagram creators for a talent agency's research library, so that a creator's work is shown to the right performer. Choose ONLY ids from this vocabulary:
${vocabulary}

The creator: @${handle}${who.followers ? ` · ${who.followers.toLocaleString()} followers` : ''}
Bio: ${who.bio ? `"${who.bio.replace(/\s+/g, ' ').slice(0, 300)}"` : '(empty — common here, judge from the frames instead)'}${who.category ? `\nAccount category: ${who.category}` : ''}

${frameCount} still frames from her best-performing reels are attached.

Her captions:
${said || '(none)'}${screen}

Judge how she is POSITIONED — the look, the setting, the recurring bit — not one video. Reply with STRICT JSON and nothing else:
{"tags":["id","id"],"why":"one sentence naming what in the evidence decided it"}
At most ${MAX_TAGS} ids, strongest first. If the evidence does not support any id, reply {"tags":[],"why":"not enough to go on"}.`
}

/** Profile one creator. Returns null when there was nothing to look at. */
export async function profile(handle: string): Promise<Proposal | null> {
  const [who] = await sql.query(
    `select bio, category, followers from transcriber.creators where handle = $1`,
    [handle],
  )
  const captions = (
    await sql.query(
      `select caption from transcriber.sightings
        where handle = $1 and caption is not null and length(caption) > 10
        order by plays desc nulls last limit $2`,
      [handle, CAPTIONS],
    )
  ).map((row) => String(row.caption))

  const onScreen = (
    await sql.query(
      `select on_screen_text from transcriber.transcripts
        where author = $1 and on_screen_text is not null limit 6`,
      [handle],
    )
  ).map((row) => String(row.on_screen_text))

  const stills = await frames(handle)
  if (stills.length === 0) return null

  const content = [
    { type: 'text', text: promptFor(handle, {
      bio: (who?.bio as string | null) ?? null,
      category: (who?.category as string | null) ?? null,
      followers: who?.followers === null || who?.followers === undefined ? null : Number(who.followers),
    }, captions, onScreen, stills.length) },
    ...stills.map((url) => ({ type: 'image_url', image_url: { url } })),
  ]

  const response = await fetch(`${API}/accounts/${account()}/ai/run/${MODEL}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.CLOUDFLARE_AI_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ messages: [{ role: 'user', content }], max_tokens: 220, temperature: 0.1 }),
  })
  if (!response.ok) throw new Error(`Workers AI ${response.status}: ${(await response.text()).slice(0, 160)}`)

  const body = (await response.json()) as { result?: { choices?: { message?: { content?: string } }[]; response?: string } }
  const said = body.result?.choices?.[0]?.message?.content ?? body.result?.response ?? ''
  const json = /\{[\s\S]*\}/.exec(String(said).replace(/```json|```/g, ''))
  let parsed: { tags?: unknown; why?: unknown } = {}
  try {
    parsed = JSON.parse(json?.[0] ?? '{}')
  } catch {
    parsed = {}
  }

  // Anything outside our vocabulary is dropped rather than coerced: an
  // invented tag would be a tag nothing else in the system understands.
  const tags = (Array.isArray(parsed.tags) ? parsed.tags : [])
    .filter((tag): tag is string => typeof tag === 'string' && VALID.has(tag))
    .slice(0, MAX_TAGS)

  return {
    handle,
    tags,
    why: typeof parsed.why === 'string' ? parsed.why.slice(0, 300) : '',
    evidence: {
      frames: stills.length,
      captions: captions.length,
      bio: (who?.bio as string | null) ?? null,
      followers: who?.followers === null || who?.followers === undefined ? null : Number(who.followers),
    },
  }
}

export async function store(proposal: Proposal): Promise<void> {
  await sql.query(
    `insert into transcriber.creator_proposals (handle, tags, why, evidence, made_at, decided_at, decision)
     values ($1, $2::text[], $3, $4::jsonb, now(), null, null)
     on conflict (handle) do update
        set tags = excluded.tags, why = excluded.why, evidence = excluded.evidence,
            made_at = now(), decided_at = null, decision = null`,
    [proposal.handle, proposal.tags, proposal.why, JSON.stringify(proposal.evidence)],
  )
}

/** Open proposals, newest first, with what the creator looks like so a human
 *  can decide without opening Instagram. */
export async function openProposals(limit = 40) {
  return sql.query(
    `select p.handle, p.tags, p.why, p.evidence, p.made_at,
            c.followers, c.bio,
            (select s.poster_url from transcriber.sightings s
              where s.handle = p.handle and s.poster_url is not null and s.media_until > now()
              order by s.plays desc nulls last limit 1) as poster,
            (select count(*)::int from transcriber.sightings s2 where s2.handle = p.handle) as reels
       from transcriber.creator_proposals p
       join transcriber.creators c on c.handle = p.handle
      where p.decided_at is null
      order by c.followers desc nulls last
      limit $1`,
    [limit],
  )
}

/** Take a proposal (as offered, or edited) onto the creator. */
export async function decide(handle: string, tags: string[] | null): Promise<string[]> {
  const [proposed] = await sql.query(
    `select tags from transcriber.creator_proposals where handle = $1`,
    [handle],
  )
  const offered: string[] = Array.isArray(proposed?.tags) ? proposed.tags.map(String) : []
  const chosen = (tags ?? offered).filter((tag) => VALID.has(tag)).slice(0, 6)
  const decision = tags === null ? 'rejected' : sameSet(chosen, offered) ? 'taken' : 'edited'

  if (decision !== 'rejected' && chosen.length > 0) {
    await sql.query(
      `update transcriber.creators set persona = $2::text[], updated_at = now() where handle = $1`,
      [handle, chosen],
    )
  }
  await sql.query(
    `update transcriber.creator_proposals set decided_at = now(), decision = $2 where handle = $1`,
    [handle, decision],
  )
  return decision === 'rejected' ? [] : chosen
}

function sameSet(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((value) => b.includes(value))
}
