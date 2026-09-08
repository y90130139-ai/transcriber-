// Load cloud/.env.local into process.env for the standalone scripts.
// Vercel's `env pull` quotes values, so strip a matching pair of quotes.
import { readFileSync } from 'node:fs'

export function loadEnv(url = new URL('../.env.local', import.meta.url)) {
  let text
  try {
    text = readFileSync(url, 'utf8')
  } catch {
    return // Vercel already has the real environment; a missing file is fine.
  }
  for (const line of text.split('\n')) {
    const at = line.indexOf('=')
    if (at < 1 || line.startsWith('#')) continue
    const key = line.slice(0, at).trim()
    let value = line.slice(at + 1).trim()
    if (value.length > 1 && value[0] === value.at(-1) && (value[0] === '"' || value[0] === "'")) {
      value = value.slice(1, -1)
    }
    process.env[key] ??= value
  }
}
