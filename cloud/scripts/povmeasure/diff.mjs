// Before/after over the whole corpus for the pov-relatable hook tag.
//
// The two sides are compiled copies of the tagger, not imports: the point is to
// run the OLD rules and the NEW rules over the same rows in one process.
// To rebuild them, from cloud/:
//
//   mkdir -p scripts/povmeasure/old scripts/povmeasure/new
//   git-less repo, so old/ comes from docs/rollback/*.pre-pov-hook:
//   cp ../docs/rollback/autotag.ts.pre-pov-hook scripts/povmeasure/old/autotag.ts
//   cp ../docs/rollback/lexicon.ts.pre-pov-hook scripts/povmeasure/old/lexicon.ts
//   cp ../docs/rollback/taxonomy.json.pre-pov-hook scripts/povmeasure/old/taxonomy.json
//   cp src/lib/taxonomy.ts scripts/povmeasure/old/
//   cp src/lib/{autotag,lexicon,taxonomy}.ts src/lib/taxonomy.json scripts/povmeasure/new/
//   npx tsc --ignoreConfig --module commonjs --target es2022 --resolveJsonModule \
//     --skipLibCheck --esModuleInterop scripts/povmeasure/{old,new}/autotag.ts
//   node --env-file=.env.local scripts/povmeasure/diff.mjs
//
// It must live under cloud/ or @neondatabase/serverless will not resolve.
// Delete old/ and new/ afterwards: tsconfig includes **/*.ts and stale copies
// of the tagger sitting next to the real one is how future-me edits the wrong file.
//
// Reads only. It splits on spoken word count, NOT on has_speech: three rows in
// this corpus are has_speech=true with one spoken word and take the screen
// branch, and calling those spoken makes screen items look like regressions.
import { createRequire } from 'node:module'
import { neon } from '@neondatabase/serverless'

const require = createRequire(import.meta.url)
const OLD = require('./old/autotag.js')
const NEW = require('./new/autotag.js')
const sql = neon(process.env.DATABASE_URL)

const SILENT_WORDS = 4

const rows = await sql.query(`
  select t.job_id, t.plain, t.caption, t.blocks, t.on_screen_text, t.on_screen_captions,
         t.speaker_count, t.word_count, t.duration_sec, t.has_speech
    from transcriber.transcripts t
   order by t.transcribed_at desc`)

const hookOf = (mod, row) => {
  const input = {
    plain: row.plain ?? '',
    caption: row.caption ?? null,
    firstLine: mod.firstLineOf(row.blocks, row.plain ?? ''),
    onScreenText: row.on_screen_text ?? null,
    onScreenCaptions: row.on_screen_captions ?? null,
    speakerCount: row.speaker_count ?? null,
    wordCount: row.word_count ?? null,
    durationSec: row.duration_sec ?? null,
    creatorText: '',
    creatorPersona: [],
  }
  return mod.suggestTags(input).filter((s) => s.axis === 'hook').map((s) => s.tag).join(',') || '(none)'
}

const branch = (row) =>
  OLD.spokenWords(row.plain ?? '').split(/\s+/).filter(Boolean).length >= SILENT_WORDS ? 'spoken' : 'screen'

const counts = { spoken: { total: 0, moved: 0 }, screen: { total: 0, moved: 0 } }
const before = { spoken: {}, screen: {} }
const after = { spoken: {}, screen: {} }
const moves = { spoken: [], screen: [] }

for (const row of rows) {
  const side = branch(row)
  const o = hookOf(OLD, row)
  const n = hookOf(NEW, row)
  counts[side].total++
  before[side][o] = (before[side][o] ?? 0) + 1
  after[side][n] = (after[side][n] ?? 0) + 1
  if (o !== n) {
    counts[side].moved++
    moves[side].push({ job: row.job_id, from: o, to: n, has_speech: row.has_speech,
      words: OLD.spokenWords(row.plain ?? '').split(/\s+/).filter(Boolean).length,
      text: (row.on_screen_text || OLD.spokenWords(row.plain ?? '')).slice(0, 90) })
  }
}

const table = (map) => Object.entries(map).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${String(v).padStart(4)}  ${k}`).join('\n')

for (const side of ['spoken', 'screen']) {
  console.log(`\n===== ${side.toUpperCase()}  (${counts[side].total} rows, ${counts[side].moved} moved) =====`)
  console.log('-- before --\n' + table(before[side]))
  console.log('-- after  --\n' + table(after[side]))
  if (moves[side].length) {
    console.log('-- moves --')
    for (const m of moves[side]) {
      console.log(`  ${m.job} ${m.from} -> ${m.to}  [words=${m.words} has_speech=${m.has_speech}] ${JSON.stringify(m.text)}`)
    }
  }
}
console.log(`\nTOTAL ${rows.length} rows; moved ${counts.spoken.moved + counts.screen.moved}`)
