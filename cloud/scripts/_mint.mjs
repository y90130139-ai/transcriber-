// Scratch session minter for local smoke tests (remove after use). Mirrors
// issueToken() in src/lib/auth.ts exactly, without importing next/headers.
import { loadEnv } from './env.mjs'
import { createHmac } from 'node:crypto'

loadEnv()
const secret = process.env.SESSION_SECRET
if (!secret) throw new Error('SESSION_SECRET missing from env')
const expires = Date.now() + 3_600_000
const sig = createHmac('sha256', secret).update(String(expires)).digest('base64url')
console.log(`${expires}.${sig}`)
