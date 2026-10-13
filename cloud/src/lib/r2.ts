/** Presigned reads from Cloudflare R2, where plan videos live.
 *
 * The library's own videos stay on the Mac behind the tunnel, which costs
 * nothing and is fine for research. A plan is different: she may open it at 2am
 * with the Mac asleep, and a dead player is not an acceptable thing to hand a
 * client. So the videos that land on a plan — and only those — are copied to R2
 * by the worker, and this file mints the short-lived URLs that read them back.
 *
 * Presigned, not public. A public bucket needs either the rate-limited r2.dev
 * subdomain or a custom domain, and a custom domain needs a zone on Cloudflare;
 * sinauraco.com is on Vercel nameservers and its apex must not move.
 *
 * This is a hand-rolled SigV4 signer rather than the AWS SDK. One signed GET
 * does not justify pulling a few megabytes of client into the bundle.
 */
import { createHash, createHmac } from 'node:crypto'

const ALGORITHM = 'AWS4-HMAC-SHA256'
const REGION = 'auto'
const SERVICE = 's3'
/** Long enough to watch a plan through; short enough that a copied URL is not
 *  a permanent handout. Matches the tunnel's own six-hour ceiling. */
export const R2_URL_TTL_SEC = 6 * 60 * 60

export type R2Config = {
  accountId: string
  accessKeyId: string
  secretAccessKey: string
  bucket: string
}

/** Null when a bucket is not set up yet, which is a state the app has to survive. */
function configFrom(prefix: string): R2Config | null {
  const accountId = process.env[`${prefix}_ACCOUNT_ID`]
  const accessKeyId = process.env[`${prefix}_ACCESS_KEY_ID`]
  const secretAccessKey = process.env[`${prefix}_SECRET_ACCESS_KEY`]
  const bucket = process.env[`${prefix}_BUCKET`]
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) return null
  return { accountId, accessKeyId, secretAccessKey, bucket }
}

/** R2 bucket used for plans and user-managed media. */
export const r2Config = () => configFrom('R2')

/** The scraper's separate bucket, where OFMPro media copies are written. */
export const ofmproR2Config = () => configFrom('OFMPRO_R2')

export const r2Endpoint = (accountId: string) => `https://${accountId}.r2.cloudflarestorage.com`

/** The object key for one plan item. Stable, so a re-upload replaces in place. */
export const r2KeyFor = (planId: string, jobId: string) => `plans/${planId}/${jobId}.mp4`

/** AWS's encoding rules, which are stricter than encodeURIComponent's. */
function encodeRfc3986(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  )
}

const encodePath = (path: string) => path.split('/').map(encodeRfc3986).join('/')

const sha256Hex = (value: string) => createHash('sha256').update(value).digest('hex')

function hmac(key: Buffer | string, value: string): Buffer {
  return createHmac('sha256', key).update(value).digest()
}

function signingKey(secret: string, datestamp: string): Buffer {
  return hmac(hmac(hmac(hmac(`AWS4${secret}`, datestamp), REGION), SERVICE), 'aws4_request')
}

/**
 * A presigned URL for one object, valid for `ttlSec`.
 *
 * `extraQuery` is signed along with everything else, which is what makes
 * `response-content-disposition` usable for a download link. `method` is part
 * of the signature, so a PUT link (how the cloud fallback uploads a plan's
 * video when the Mac is not there to) must be signed as PUT.
 */
export function presign(
  config: R2Config,
  key: string,
  {
    ttlSec = R2_URL_TTL_SEC,
    extraQuery = {},
    method = 'GET',
  }: { ttlSec?: number; extraQuery?: Record<string, string>; method?: 'GET' | 'PUT' } = {},
): string {
  const host = `${config.accountId}.r2.cloudflarestorage.com`
  const canonicalUri = `/${encodePath(config.bucket)}/${encodePath(key)}`

  const stamp = new Date().toISOString().replace(/[-:]|\.\d{3}/g, '')
  const datestamp = stamp.slice(0, 8)

  const query: Record<string, string> = {
    ...extraQuery,
    'X-Amz-Algorithm': ALGORITHM,
    'X-Amz-Credential': `${config.accessKeyId}/${datestamp}/${REGION}/${SERVICE}/aws4_request`,
    'X-Amz-Date': stamp,
    'X-Amz-Expires': String(Math.min(Math.max(Math.round(ttlSec), 1), 604_800)),
    'X-Amz-SignedHeaders': 'host',
  }

  const canonicalQuery = Object.keys(query)
    .sort()
    .map((name) => `${encodeRfc3986(name)}=${encodeRfc3986(query[name])}`)
    .join('&')

  const canonicalRequest = [
    method,
    canonicalUri,
    canonicalQuery,
    `host:${host}\n`,
    'host',
    'UNSIGNED-PAYLOAD',
  ].join('\n')

  const toSign = [
    ALGORITHM,
    stamp,
    `${datestamp}/${REGION}/${SERVICE}/aws4_request`,
    sha256Hex(canonicalRequest),
  ].join('\n')

  const signature = createHmac('sha256', signingKey(config.secretAccessKey, datestamp))
    .update(toSign)
    .digest('hex')

  return `https://${host}${canonicalUri}?${canonicalQuery}&X-Amz-Signature=${signature}`
}

/** The read link the app hands out. Unchanged behaviour; `presign` grew a
 *  method so uploads could share the signing. */
export function presignGet(
  config: R2Config,
  key: string,
  options: { ttlSec?: number; extraQuery?: Record<string, string> } = {},
): string {
  return presign(config, key, { ...options, method: 'GET' })
}

export type PlanMedia = { video: string; download: string }

/** What the share page hands one item: a player source and a save-to-phone link. */
export function planMediaFor(config: R2Config, key: string, filename: string): PlanMedia {
  return {
    video: presignGet(config, key),
    download: presignGet(config, key, {
      extraQuery: {
        'response-content-disposition': `attachment; filename="${filename.replace(/["\\]/g, '')}"`,
      },
    }),
  }
}
