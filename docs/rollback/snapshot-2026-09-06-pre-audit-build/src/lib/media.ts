/** Signed links to the videos, which never leave the Mac.
 *
 * The app knows a video only as a folder name on the worker's disk. It mints a
 * short-lived HMAC signature that the Mac's media server checks, so the tunnel
 * hostname being publicly resolvable does not make the library publicly
 * readable. The signing key is WORKER_SECRET, already shared by both sides.
 */
import { createHmac } from 'node:crypto'
import { sql } from './db'

const LINK_TTL_SEC = 6 * 60 * 60
// A ping older than this means the Mac — and with it every video — is offline.
const MEDIA_STALE_SEC = 300

function sign(scope: string, expires: number): string {
  const secret = process.env.WORKER_SECRET
  if (!secret) throw new Error('WORKER_SECRET is not set')
  return createHmac('sha256', secret).update(`${scope}:${expires}`).digest('base64url')
}

function signed(base: string, path: string, scope: string, query = ''): string {
  const expires = Math.floor(Date.now() / 1000) + LINK_TTL_SEC
  const prefix = query ? `${query}&` : ''
  return `${base}${path}?${prefix}exp=${expires}&sig=${sign(scope, expires)}`
}

/** Where the worker says its videos are reachable right now, if anywhere.
 *
 * A quick tunnel is handed a new hostname each time cloudflared restarts, so
 * this is read fresh per request rather than configured. */
export async function mediaBase(): Promise<string | null> {
  const [row] = await sql.query(
    `select media_url, extract(epoch from (now() - seen_at)) as age
       from transcriber.worker_pings where id = 1`,
  )
  if (!row?.media_url) return null
  if (Number(row.age) > MEDIA_STALE_SEC) return null
  return String(row.media_url).replace(/\/+$/, '')
}

export type MediaLinks = { video: string; poster: string; captions: string; download: string }

export function linksFor(base: string, folder: string): MediaLinks {
  const scope = `v/${folder}`
  return {
    video: signed(base, `/v/${folder}/video`, scope),
    poster: signed(base, `/v/${folder}/poster`, scope),
    captions: signed(base, `/v/${folder}/captions`, scope),
    download: signed(base, `/v/${folder}/download`, scope),
  }
}

/** One zip for a multi-select, rather than twenty browser downloads. */
export function bundleLink(base: string, folders: string[]): string {
  const list = folders.join(',')
  return signed(base, '/bundle', `bundle/${list}`, `f=${encodeURIComponent(list)}`)
}
