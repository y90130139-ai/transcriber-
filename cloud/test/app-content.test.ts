// node --import ./cloud/test/ts-resolve.mjs --test cloud/test/app-content.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  APP_CONTENT_KEYS,
  defaultDoc,
  isAppContentKey,
  isLegacyTalentManagementAgreement,
  normalizeLegacyOnboardingAgreementTitle,
  normalizeDoc,
  type RichDoc,
} from '../src/lib/app-content'

test('the shipped defaults survive their own normalizer byte for byte', () => {
  for (const key of APP_CONTENT_KEYS) {
    const doc = defaultDoc(key)
    assert.deepEqual(normalizeDoc(key, doc), doc, key)
  }
})

test('editing one default never touches the stored copy', () => {
  const first = defaultDoc('faq')
  first.body = 'changed on a console'
  assert.match(defaultDoc('faq').body, /full-service management agency/)
})

test('the key gate knows exactly the six documents', () => {
  assert.equal(APP_CONTENT_KEYS.length, 6)
  assert.equal(isAppContentKey('faq'), true)
  assert.equal(isAppContentKey('FAQ'), false)
  assert.equal(isAppContentKey(''), false)
  assert.equal(isAppContentKey(null), false)
})

test('anything that is not a rich document is rejected outright', () => {
  assert.equal(normalizeDoc('faq', { kind: 'blocks', title: 'x', blocks: [] }), null)
  assert.equal(normalizeDoc('faq', { kind: 'sections', title: 'x', sections: [] }), null)
  assert.equal(normalizeDoc('faq', 'not a doc'), null)
  assert.equal(normalizeDoc('faq', { kind: 'rich', body: 'no title' }), null)
})

test('the body is bounded — a runaway paste cannot land on a phone whole', () => {
  const doc = normalizeDoc('sop', { kind: 'rich', title: 'Client SOP', body: 'x'.repeat(300_000) }) as RichDoc
  assert.equal(doc.body.length, 120_000)
})

test('carriage returns are normalised so parsing on the phone never sees them', () => {
  const doc = normalizeDoc('faq', { kind: 'rich', title: 'FAQ', body: 'a\r\n\r\nb' }) as RichDoc
  assert.equal(doc.body, 'a\n\nb')
})

test('the welcome keeps its chips, and nobody else gets them', () => {
  const welcome = defaultDoc('welcome')
  assert.equal(welcome.actions?.items.length, 3)
  assert.equal(welcome.headline, 'Welcome, {name}')

  const faq = normalizeDoc('faq', { kind: 'rich', title: 'FAQ', actions: { label: 'x', items: [{ label: 'y', go: 'inbox' }] } }) as RichDoc
  assert.equal(faq.actions, null)
})

test('the onboarding keeps its three doors, one per form, and nobody else gets them', () => {
  const onboarding = defaultDoc('onboarding')
  assert.deepEqual(onboarding.steps?.map((step) => step.key), ['agreement', 'contact', 'intake'])

  const deduped = normalizeDoc('onboarding', {
    kind: 'rich',
    title: 'Onboarding',
    steps: [
      { key: 'agreement', title: 'First', hint: '' },
      { key: 'agreement', title: 'Duplicate — dropped', hint: '' },
      { key: 'contact', title: 'Second', hint: '' },
    ],
  }) as RichDoc
  assert.deepEqual(deduped.steps?.map((step) => step.title), ['First', 'Second'])

  const faq = normalizeDoc('faq', { kind: 'rich', title: 'FAQ', steps: [{ key: 'intake', title: 'x', hint: '' }] }) as RichDoc
  assert.equal(faq.steps, null)
})

test('a saved legacy onboarding label is normalized to the Independent Contractor Agreement', () => {
  const old = normalizeDoc('onboarding', {
    kind: 'rich',
    title: 'Onboarding',
    steps: [
      { key: 'agreement', title: 'Sign Talent Management Agreement', hint: 'Old hint' },
      { key: 'contact', title: 'My contact title', hint: 'Keep this edit' },
    ],
  }) as RichDoc
  const updated = normalizeLegacyOnboardingAgreementTitle(old)
  assert.equal(updated.steps?.[0].title, 'Sign Independent Contractor Agreement')
  assert.equal(updated.steps?.[0].hint, 'Old hint')
  assert.equal(updated.steps?.[1].title, 'My contact title')
})

test('the agreement default is the full Independent Contractor Agreement', () => {
  const doc = defaultDoc('agreement')
  const body = doc.body
  assert.equal(doc.title, 'Independent Contractor Agreement')
  for (const number of ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11']) {
    assert.ok(body.includes(`## ${number} · `), `section ${number}`)
  }
  assert.match(body, /\{\{CLIENT_LEGAL_NAME\}\}/)
  assert.match(body, /\{\{CLIENT_STAGE_NAME\}\}/)
  assert.match(body, /\{\{LATER_SERVICE_START_DATE\}\}/)
  assert.match(body, /\{\{EFFECTIVE_DATE\}\}/)
  assert.match(body, /fifty percent \(50%\)/)
})

test('the previously saved built-in agreement is recognized as legacy', () => {
  const old = normalizeDoc('agreement', {
    kind: 'rich',
    title: 'Talent Management Agreement',
    headline: 'Talent Management Agreement',
    body: '## 1 · Parties\n\nlegacy\n\n## 5 · Revenue share\n\nNet revenue earned from the managed platforms is shared 70% to the Talent and 30% to the Company.\n\n## 10 · Electronic signature',
  }) as RichDoc
  assert.equal(isLegacyTalentManagementAgreement(old), true)
  assert.equal(isLegacyTalentManagementAgreement(defaultDoc('agreement')), false)
})

test('the FAQ keeps its nine questions and the pay table', () => {
  const body = defaultDoc('faq').body
  assert.equal((body.match(/^## /gm) ?? []).length, 10) // nine questions + the contact card
  assert.match(body, /\| Pay period \| Invoice arrives \| Due \|/)
})

test('the SOP keeps its numbered sections', () => {
  const body = defaultDoc('sop').body
  for (const number of ['01', '02', '03', '05', '06', '07', '08', '09', '10', '11']) {
    assert.ok(body.includes(`## ${number} · `), `section ${number}`)
  }
})
