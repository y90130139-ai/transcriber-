import { test } from 'node:test'
import assert from 'node:assert/strict'
import { audienceFor, withoutFans, matchCreator, isStale, headline, slice, GUIDANCE, type Creator, type Payload } from '../src/lib/assistant/roster-health'

const OWNER = '5385422575'
const OPS = '-1004328834409'

const creator = (over: Partial<Creator> = {}): Creator => ({
  id: 'c1', name: 'Paige CHAT', tier: 'push', at_risk: false,
  oct_net: 10_567, sep_same_days: 15_995, sep_full: 21_978,
  pace: 622, pace_last4: 986, needs_per_day: 815, ratio: 1.2,
  red_today: true, projected_red: true, dark_days: [], still_falling: false,
  idle: { fans: 52, sep_value: 12_680, top: [['575501487', 1874]] },
  whales: { silent: [['575501487', 1874]], cooled: [], returned: [] },
  ...over,
})

const payload = (over: Partial<Payload> = {}): Payload => ({
  as_of: new Date().toISOString(),
  window: { through: '2026-10-17', days_elapsed: 17, days_left: 14, month: '2026-10', prior_month: '2026-09' },
  roster: { active: 58, gone: [], new: [] },
  goal: { target: 20, true_pct_target: 17 },
  agency: { red_today: 35, projected_red: 31, oct_net: 152_962 },
  creators: [creator(), creator({ id: 'c2', name: 'Kiera FS', tier: 'hold', projected_red: false }), creator({ id: 'c3', name: 'Clear FS', tier: null, red_today: false, projected_red: false })],
  ...over,
})

test('the board answers in Geno\'s DM and refuses everywhere else', () => {
  const env = { GOSIAN_OWNER_CHAT_ID: OWNER }
  assert.deepEqual(audienceFor(OWNER, env), { fans: true })
  const ops = audienceFor(OPS, env)
  assert.ok('refusal' in ops && ops.refusal.includes("Geno's DM"))
})

test('with no owner chat configured nobody gets it - it fails closed', () => {
  const nobody = audienceFor(OWNER, {})
  assert.ok('refusal' in nobody && nobody.refusal.includes('GOSIAN_OWNER_CHAT_ID'))
  // Even with the group switch on: without an owner there is nothing to compare against.
  const still = audienceFor(OPS, { ROSTER_HEALTH_OPS: '1' })
  assert.ok('refusal' in still)
})

test('the owner id the drafts lock already uses opens the board, under either name', () => {
  // OWNER_TELEGRAM_ID is deployed and holds the same number: a DM's chat id is
  // the account's id. Without this the board stayed dark for want of a synonym.
  assert.deepEqual(audienceFor(OWNER, { OWNER_TELEGRAM_ID: OWNER }), { fans: true })
  const ops = audienceFor(OPS, { OWNER_TELEGRAM_ID: OWNER })
  assert.ok('refusal' in ops, 'and it opens nothing else - the group is still refused')
  // The explicit name wins, so the board can be pointed elsewhere without
  // moving the lock that guards sending a draft.
  assert.deepEqual(audienceFor('999', { GOSIAN_OWNER_CHAT_ID: '999', OWNER_TELEGRAM_ID: OWNER }), { fans: true })
  const old = audienceFor(OWNER, { GOSIAN_OWNER_CHAT_ID: '999', OWNER_TELEGRAM_ID: OWNER })
  assert.ok('refusal' in old)
})

test('the staff group can be opened, and then it reads the board without a single fan id', () => {
  const who = audienceFor(OPS, { GOSIAN_OWNER_CHAT_ID: OWNER, ROSTER_HEALTH_OPS: '1' })
  assert.deepEqual(who, { fans: false })
  const out = slice(payload(), { creator: 'Paige' }, false)
  const json = JSON.stringify(out)
  assert.ok(!json.includes('575501487'), 'no fan id leaves for a group')
  assert.ok(json.includes('fan_ids_withheld'), 'and the model is told they were withheld, not that there are none')
  assert.ok(json.includes('12680'), 'the money is still there, it is the ids that are not')
})

test('fan ids survive for Geno, because the chatter brief is the point', () => {
  const out = JSON.stringify(slice(payload(), { creator: 'Paige' }, true))
  assert.ok(out.includes('575501487'))
})

test('stripping fans keeps every number on the card', () => {
  const bare = withoutFans(creator())
  assert.equal(bare.idle.fans, 52)
  assert.equal(bare.idle.sep_value, 12_680)
  assert.deepEqual(bare.idle.top, [])
  assert.deepEqual(bare.whales.silent, [])
  assert.equal(bare.needs_per_day, 815)
})

test('the board is the thin list of everyone in trouble, biggest gap first', () => {
  const out = slice(payload(), {}, true) as Record<string, unknown>
  const rows = out.creators as Array<Record<string, unknown>>
  assert.equal(rows.length, 2, 'the clear creator is not on the board')
  assert.equal(rows[0].still_to_earn, 21_978 - 10_567)
  assert.ok(!JSON.stringify(rows).includes('575501487'), 'the board carries no fan ids even for Geno - the cards do')
  assert.deepEqual(out.counts, { hold: 1, push: 1, stretch: 0, not_this_month: 0, at_risk: 0 })
})

test('a tier asked for comes back as full cards, at_risk as the flag it is', () => {
  const p = payload({ creators: [creator({ at_risk: true, red_today: false, tier: 'push' }), creator({ id: 'c2', name: 'Kiera FS', tier: 'hold' })] })
  const push = slice(p, { tier: 'push' }, true) as Record<string, unknown>
  assert.equal((push.creators as Creator[]).length, 1)
  assert.equal((push.creators as Creator[])[0].idle.fans, 52, 'full card, not the thin row')
  const risky = slice(p, { tier: 'at_risk' }, true) as Record<string, unknown>
  assert.equal((risky.creators as Creator[]).length, 1)
})

test('an unknown name says so and lists the names rather than guessing', () => {
  const out = slice(payload(), { creator: 'Jordan' }, true) as unknown as { error: string }
  assert.ok(out.error.includes('Jordan'))
  assert.ok(out.error.includes('Paige CHAT'))
})

test('a name matches the way the team types it', () => {
  const list = payload().creators
  assert.equal(matchCreator(list, 'paige')?.id, 'c1')
  assert.equal(matchCreator(list, 'Kiera FS')?.id, 'c2')
  assert.equal(matchCreator(list, '  kiera ')?.id, 'c2')
  assert.equal(matchCreator(list, ''), null)
})

test('stale data is called out before anything else', () => {
  const old = new Date(Date.now() - 9 * 3_600_000).toISOString()
  assert.equal(isStale(old), true)
  assert.equal(isStale(new Date().toISOString()), false)
  assert.equal(isStale('not a date'), true, 'an unreadable timestamp is not fresh')
  const out = slice(payload({ as_of: old }), {}, true) as unknown as { stale: string }
  assert.ok(out.stale.includes('behind'))
})

test('the headline is the one line every answer opens with', () => {
  assert.equal(
    headline(payload()),
    'Red: 35/58 today, 31 projected at month end, goal 20. 11 more flips needed with 14 days left.',
  )
  const made = payload({ agency: { red_today: 30, projected_red: 18 } })
  assert.ok(headline(made).includes('Goal met at this pace'))
})

test('the desk instructions carry the rules that keep this honest', () => {
  for (const rule of ['never round up', 'after OnlyFans', 'own previous month', 'gone from Infloww', 'purchases, not sends', 'display names']) {
    assert.ok(GUIDANCE.toLowerCase().includes(rule.toLowerCase()), `missing: ${rule}`)
  }
})
