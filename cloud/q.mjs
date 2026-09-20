import { readFileSync } from 'node:fs'
for (const l of readFileSync('.env.local','utf8').split('\n')) { const m=l.match(/^([A-Z_]+)="?([^"]*?)"?$/); if(m) process.env[m[1]]=m[2] }
const { neon } = await import('@neondatabase/serverless')
console.log(JSON.stringify(await neon(process.env.DATABASE_URL).query(process.argv[2]), null, 1))
