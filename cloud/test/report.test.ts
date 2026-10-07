// node --import ./cloud/test/ts-resolve.mjs --test cloud/test/report.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { clip, readReport, REPORT_SECTIONS } from '../src/lib/report/spec'

test('readReport restores order, stubs missing sections, drops unknown ones', () => {
  const report = readReport({
    sections: [
      { id: 'voice', body: 'Short sentences, dry delivery.' },
      { id: 'snapshot', body: 'Name: Berkeley.' },
      { id: 'made-up-section', body: 'should vanish' },
      { id: 'pillars', body: '' }, // empty bodies do not count as answers
    ],
    gaps: [{ about: 'audience', question: 'Who actually follows you today?' }],
  })
  assert.ok(report)
  assert.equal(report.sections.length, REPORT_SECTIONS.length)
  // Template order, not answer order.
  assert.equal(report.sections[0].id, 'snapshot')
  assert.equal(report.sections[0].body, 'Name: Berkeley.')
  // A section the model skipped says so instead of disappearing.
  const pillars = report.sections.find((s) => s.id === 'pillars')
  assert.match(pillars!.body, /Nothing in the sources/)
  assert.equal(report.gaps.length, 1)
  assert.equal(report.gaps[0].about, 'audience')
})

test('readReport refuses an answer with no usable sections', () => {
  assert.equal(readReport({ sections: [{ id: 'nope', body: 'x' }] }), null)
  assert.equal(readReport('not an object'), null)
  assert.equal(readReport(null), null)
})

test('gap entries without a question are dropped; malformed gaps never throw', () => {
  const report = readReport({
    sections: [{ id: 'bio', body: 'A paragraph.' }],
    gaps: [{ about: 'x' }, 'garbage', { question: 'Standalone question?' }],
  })
  assert.ok(report)
  assert.equal(report.gaps.length, 1)
  assert.equal(report.gaps[0].about, 'general')
})

test('clip marks what it cut', () => {
  assert.equal(clip('short', 100), 'short')
  assert.match(clip('x'.repeat(200), 50), /clipped at 50/)
})
