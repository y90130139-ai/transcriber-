// What the queue looks like right now. `node scripts/status.mjs`
import { neon } from '@neondatabase/serverless'
import { loadEnv } from './env.mjs'

loadEnv()

const sql = neon(process.env.DATABASE_URL)

const [ping] = await sql`select note, round(extract(epoch from (now() - seen_at))) as age
                           from transcriber.worker_pings where id = 1`
console.log(ping ? `worker: ${ping.note} · last seen ${ping.age}s ago` : 'worker: never seen')

const jobs = await sql`select id, status, stage, label, error from transcriber.jobs
                        order by created_at desc limit 12`
if (jobs.length === 0) console.log('jobs:   none yet')
for (const job of jobs) {
  const tail = job.error ?? job.stage ?? ''
  console.log(`  ${job.status.padEnd(8)} ${job.label.slice(0, 52).padEnd(54)} ${tail.slice(0, 40)}`)
}
