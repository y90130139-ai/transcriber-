import { guardAccess } from '@/lib/access'
import { NextResponse } from 'next/server'
import { nanoid } from 'nanoid'
import { sql } from '@/lib/db'
import { mapIntake, readAnswers } from '@/lib/intake'

type Params = { params: Promise<{ id: string }> }


/** Big enough for any form, small enough that a wrong URL cannot fill a
 *  function's memory. Matches the parser's own ceiling. */
const MAX_BYTES = 400_000

/** Extensions whose bytes are text. A PDF is stored and not read — see the
 *  upload route for why. */
const READABLE = /\.(txt|md|markdown|csv|tsv|json|text)$/i

/** Does this look like text rather than a container we cannot open? Content
 *  type first, because Blob serves what the browser declared; the extension is
 *  the fallback for the several ways a phone mislabels a plain text file. */
function isReadable(contentType: string | null, url: string): boolean {
  if (contentType && /^text\/|application\/json/i.test(contentType)) return true
  if (contentType && /pdf|msword|officedocument|rtf/i.test(contentType)) return false
  return READABLE.test(new URL(url).pathname)
}

/** The latest form of hers, and what was made of it. */
export async function GET(request: Request, { params }: Params) {
  const denied = await guardAccess(request)
  if (denied) return denied
  const { id } = await params

  const [intake] = await sql.query(
    `select id, source_url, filename, parsed, applied_at, created_at
       from transcriber.model_intake
      where model_id = $1
      order by created_at desc
      limit 1`,
    [id],
  )
  return NextResponse.json({ intake: intake ?? null })
}

/**
 * Read a form and propose a profile from it.
 *
 * Takes either `text` pasted into the sheet or the `url` of a file already
 * uploaded to Blob — the second is the record of what she submitted, the first
 * is how a PDF gets read. Both are stored.
 *
 * **This writes nothing to her profile.** It stores the form and returns the
 * proposal; the sheet shows it with every inference unticked and the profile
 * is saved by the same PUT a hand edit uses. That is deliberate: a wrong
 * `formats` array is invisible and steers every recommendation she gets.
 */
export async function POST(request: Request, { params }: Params) {
  const denied = await guardAccess(request)
  if (denied) return denied
  const { id } = await params

  const [model] = await sql.query(`select id from transcriber.models where id = $1`, [id])
  if (!model) return NextResponse.json({ error: 'not found' }, { status: 404 })

  const body = await request.json().catch(() => ({}))
  const pasted = typeof body.text === 'string' ? body.text : null
  const url = typeof body.url === 'string' ? body.url : null
  const filename = typeof body.filename === 'string' ? body.filename.slice(0, 200) : null

  let raw = pasted?.slice(0, MAX_BYTES) ?? ''
  let readable = raw.trim().length > 0

  if (!readable && url) {
    if (!/^https:\/\/[\w.-]+\.(?:vercel-storage\.com|public\.blob\.vercel-storage\.com)\//.test(url)) {
      return NextResponse.json({ error: 'that file is not in our own storage' }, { status: 400 })
    }
    const response = await fetch(url).catch(() => null)
    if (!response?.ok) {
      return NextResponse.json({ error: 'could not read that file back' }, { status: 400 })
    }
    readable = isReadable(response.headers.get('content-type'), url)
    raw = readable ? (await response.text()).slice(0, MAX_BYTES) : ''
  }

  // A file we cannot open is still worth keeping — it is what she submitted —
  // but it is not worth pretending to have read. Nothing is stored until there
  // is either text or a file, and an unreadable file says so rather than
  // returning an empty profile that looks like a finding.
  if (!readable) {
    return NextResponse.json({
      intake: null,
      readable: false,
      source_url: url,
      filename,
      error: 'That file is stored, but its text cannot be read here. Paste the answers in and I will read those.',
    })
  }

  const answers = readAnswers(raw)
  const parsed = mapIntake(answers)

  const [intake] = await sql.query(
    `insert into transcriber.model_intake (id, model_id, source_url, filename, raw, parsed)
     values ($1, $2, $3, $4, $5, $6::jsonb)
     returning id, source_url, filename, parsed, applied_at, created_at`,
    [nanoid(12), id, url, filename, raw, JSON.stringify(parsed)],
  )

  return NextResponse.json({ intake, readable: true })
}

/** Mark a form as the one her profile was actually built from. Stamped by the
 *  sheet after the save succeeds, so a form that was read and then ignored
 *  stays distinguishable from one that landed. */
export async function PATCH(request: Request, { params }: Params) {
  const denied = await guardAccess(request)
  if (denied) return denied
  const { id } = await params
  const body = await request.json().catch(() => ({}))
  if (typeof body.id !== 'string') return NextResponse.json({ error: 'which form' }, { status: 400 })

  await sql.query(
    `update transcriber.model_intake set applied_at = now()
      where id = $1 and model_id = $2`,
    [body.id, id],
  )
  return NextResponse.json({ ok: true })
}
