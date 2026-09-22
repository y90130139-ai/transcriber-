import { neon } from '@neondatabase/serverless'
import { loadEnv } from './env.mjs'
loadEnv()
const sql = neon(process.env.DATABASE_URL)
const q = process.argv[2]
const rows = await sql.query(q)
console.log(JSON.stringify(rows, null, 1))
