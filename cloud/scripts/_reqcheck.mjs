// Scratch end-to-end check for the requirements board (remove after use).
import { loadEnv } from './env.mjs'

loadEnv()
const { q } = await import('../src/lib/db.ts')
const { requirementRows, requirementBoardMeta } = await import('../src/lib/reddit/queries.ts')

const subs = await q(`select id, status, subscribers, posts_per_day, sample_count, survivor_count, profile_count,
                             min_post_karma, confidence, next_due_at
                        from reddit.requirement_subreddits order by added_at limit 5`)
console.log('subreddit rows:', JSON.stringify(subs, null, 2))

const samples = await q(`select subreddit, count(*)::int as n,
                                count(*) filter (where link_karma is not null)::int as with_stats,
                                count(*) filter (where outcome = 'pending')::int as pending
                           from reddit.requirement_samples group by subreddit`)
console.log('samples:', JSON.stringify(samples, null, 2))

const profiles = await q(`select count(*)::int as n from reddit.requirement_profiles`)
console.log('profiles cached:', profiles[0]?.n)

const rows = await requirementRows({ limit: 5 })
console.log('board rows (read path):', JSON.stringify(rows.map((row) => ({
  id: row.id, subscribers: row.subscribers, sample_count: row.sample_count,
  min_post_karma: row.min_post_karma, confidence: row.confidence,
  bot_bouncer: row.bot_bouncer, sources: row.sources?.length ?? 0,
})), null, 2))

console.log('meta:', JSON.stringify(await requirementBoardMeta(), null, 2))
process.exit(0)
