// Seed every German playbook format as a card template (Geno, 2026-10-18).
//
// The playbook used to be read out raw at the bottom of the Templates page;
// the formats belong in the templates list itself. This lands them once: one
// template per doc format — label "German #N · Name", format german, the
// doc's brief as the body, and the reference video the library already holds
// attached by job_id — exactly what the composer's own "Save as a template"
// writes. A format that already has a template (any row whose label starts
// with "German #N ·") is left alone; nothing is ever updated here.
//
// The team's own queue-made playbook entries (format_kinds, format german)
// land too, body-only — they carry no doc number to look a video up by.
//
// Run:  node --import ./test/ts-resolve.mjs scripts/german-templates.mjs [--apply]
// Without --apply it only prints what it would do.

import { neon } from '@neondatabase/serverless'
import { nanoid } from 'nanoid'
import { loadEnv } from './env.mjs'
import { GERMAN_FORMATS, germanBrief } from '../src/lib/german'

loadEnv()
const sql = neon(process.env.DATABASE_URL)
const apply = process.argv.includes('--apply')

const templates = await sql.query(`select lower(label) as label from transcriber.plan_templates`)
const held = templates.map((row) => String(row.label))

const jobs = await sql.query(
  `select id, label from transcriber.jobs
    where label like 'German #%'
    order by (archived_at is null) desc, label`,
)

const kinds = await sql.query(
  `select id, label, body, versions from transcriber.format_kinds where format = 'german'`,
)

const rows = []
const skipped = []

for (const format of GERMAN_FORMATS) {
  const label = `German #${format.no} · ${format.name}`
  const prefix = `german #${format.no} ·`
  if (held.some((row) => row.startsWith(prefix))) {
    skipped.push(label)
    continue
  }
  const ref = jobs.find((job) => job.label === label)
    ?? jobs.find((job) => String(job.label).startsWith(`German #${format.no} ·`))
  rows.push({
    label,
    format: 'german',
    body: germanBrief(format),
    variant: format.no,
    jobId: ref ? String(ref.id) : null,
  })
}

for (const kind of kinds) {
  const label = String(kind.label)
  if (held.includes(label.toLowerCase())) {
    skipped.push(label)
    continue
  }
  const outfits = Array.isArray(kind.versions)
    ? kind.versions.map((row) => String(row?.outfit ?? '').trim()).filter(Boolean)
    : []
  const body = [
    kind.body ? String(kind.body) : null,
    outfits.length > 0 ? `Versions: ${outfits.join(' · ')}` : null,
  ].filter(Boolean).join('\n\n') || null
  rows.push({ label, format: 'german', body, variant: null, jobId: null })
}

const withVideo = rows.filter((row) => row.jobId).length
console.log(`${rows.length} templates to add · ${withVideo} carry a reference video · ${skipped.length} already held`)
for (const row of rows.slice(0, 6)) {
  console.log(`  ${row.label} ${row.jobId ? '· video' : '· no video'}`)
}
if (skipped.length > 0) console.log(`skipped: ${skipped.join(' | ')}`)
if (!apply) {
  console.log('\nDry run. Re-run with --apply to write.')
}

let added = 0
for (const row of rows) {
  await sql.query(
    `insert into transcriber.plan_templates (id, label, format, body, variant, job_id)
     values ($1, $2, $3, $4, $5, $6)`,
    [nanoid(12), row.label, row.format, row.body, row.variant, row.jobId],
  )
  added += 1
}
console.log(`\n${added} templates added — the Templates list and the Add-card picker read them now.`)
