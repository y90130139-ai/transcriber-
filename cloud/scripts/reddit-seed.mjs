// Seeds the adult-space Reddit Trends registry: 20 candidates → 18 unique
// communities (two case-insensitive duplicate pairs) and the topic lexicon.
// Safe to re-run; existing communities are never overwritten.
//
//   npm run reddit:seed
import { loadEnv } from './env.mjs'

loadEnv()
const { seedRegistry, registryCounts, countTrackedSubreddits } = await import('../src/lib/reddit/store.ts')

const result = await seedRegistry()
const tracked = await countTrackedSubreddits()
const counts = registryCounts()
console.log(
  `registry: ${counts.candidates} candidates · ${counts.unique} unique · ` +
  `${tracked} tracked now · ${result.topics} topics upserted`,
)
