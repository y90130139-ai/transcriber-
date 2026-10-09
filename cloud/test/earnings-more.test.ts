// node --import ./test/ts-resolve.mjs --test test/earnings-more.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { daysBetween, emptyDay, startOfDay, type Day, type RawTxn } from '../src/lib/earnings/days'
import { lastOfMonth, milestoneText, milestonesFor, recapFor, recapText } from '../src/lib/earnings/monthly'
import { foldFans, pickQuiet, winbackMessages, type QuietFan } from '../src/lib/earnings/winback'
import { reelDays, summarize, type ReelPost } from '../src/lib/earnings/reels'

const run = (from: string, to: string, net: number, subs = 0): Day[] =>
  daysBetween(from, to).map((day) => ({ ...emptyDay(day), net, subs, by_type: { ...emptyDay(day).by_type, Messages: net } }))

test('month ends are right, leap years included', () => {
  assert.equal(lastOfMonth('2026-09-14'), '2026-09-30')
  assert.equal(lastOfMonth('2028-02-03'), '2028-02-29')
  assert.equal(lastOfMonth('2026-12-31'), '2026-12-31')
})

test('the recap compares whole months and calls a record only on two held months', () => {
  const history = [...run('2026-07-01', '2026-08-31', 10_000, 1), ...run('2026-09-01', '2026-09-30', 20_000, 2)]
  const r = recapFor(history, '2026-09-01', '2026-07-01')
  assert.equal(r.net, 30 * 20_000)
  assert.equal(r.prevNet, 31 * 10_000)
  assert.equal(r.change, 94)
  assert.equal(r.record, true)
  assert.equal(r.subs, 60)
  assert.ok(r.streak >= 2)
  const text = recapText(r)
  assert.match(text, /Your September, \{name\}/)
  assert.match(text, /up 94% on August/)
  assert.match(text, /best month on record/)

  const thin = recapFor(run('2026-08-01', '2026-09-30', 10_000), '2026-09-01', '2026-08-01')
  assert.equal(thin.record, false, 'one held month is not a record')
})

test('a partial first month is never compared against', () => {
  const r = recapFor(run('2026-08-15', '2026-09-30', 10_000), '2026-09-01', '2026-08-15')
  assert.equal(r.prevNet, null)
  assert.doesNotMatch(recapText(r), /on August/)
})

test('milestones fire on the day she crosses, only above every earlier month', () => {
  // Jul and Aug at $100/day ($3,100 each); September at $200/day passes that on the 16th.
  const history = [...run('2026-07-01', '2026-08-31', 10_000), ...run('2026-09-01', '2026-09-30', 20_000)]
  const byDay = (day: string) => milestonesFor(history, day, '2026-07-01').map((m) => m.code)
  assert.deepEqual(byDay('2026-09-15'), [])
  assert.deepEqual(byDay('2026-09-16'), ['record'])
  assert.deepEqual(byDay('2026-09-25'), ['round:5000'])
  assert.deepEqual(milestonesFor(history, '2026-09-25', '2026-07-01', new Set(['round:5000'])), [], 'never twice')
  assert.match(milestoneText(milestonesFor(history, '2026-09-16', '2026-07-01')), /beat your best month/)
})

test('no milestones without two whole months to beat', () => {
  assert.deepEqual(milestonesFor(run('2026-08-01', '2026-09-30', 50_000), '2026-09-20', '2026-08-01'), [])
})

test('fan folds keep ids and money only, and drop refunds and blank fans', () => {
  const at = String(startOfDay('2026-09-10') + 3_600_000)
  const t = (over: Partial<RawTxn> & { fanName?: string }): RawTxn => ({ fanId: 'f1', createdTime: at, type: 'Messages', status: 'done', amount: '1000', net: '800', ...over })
  const fans = foldFans([t({}), t({ net: '200' }), t({ status: 'undo' }), t({ fanId: undefined }), t({ fanId: 'f2', fanName: 'PENDING CUSTOM' })])
  assert.deepEqual(fans.map((f) => [f.fan_id, f.day, f.net, f.txns]).sort(), [['f1', '2026-09-10', 1000, 2], ['f2', '2026-09-10', 800, 1]])
  assert.ok(!JSON.stringify(fans).includes('PENDING'))
})

test('the win-back list is capped per creator and overall, biggest first', () => {
  const fans: QuietFan[] = Array.from({ length: 8 }, (_, i) => ({ model_name: 'Jane', fan_id: `j${i}`, spent: 60_000 + i * 10_000, last_day: '2026-09-01', quiet_days: 20 }))
  const picked = pickQuiet([...fans, { model_name: 'Ivy', fan_id: 'i1', spent: 250_000, last_day: '2026-09-01', quiet_days: 30 }])
  assert.equal(picked.filter((f) => f.model_name === 'Jane').length, 5)
  assert.equal(picked[0].fan_id, 'i1')
  const msgs = winbackMessages(picked, '2026-10-05')
  assert.equal(msgs.length, 3, 'a cover, then one message per creator')
  assert.equal(msgs[0].key, 'winback:2026-10-05')
  assert.match(msgs[0].body, /Win-back list, week of 2026-10-05/)
  assert.deepEqual(msgs.slice(1).map((m) => m.key), ['winback:2026-10-05:ivy', 'winback:2026-10-05:jane'], 'biggest spender first, keyed per creator')
  assert.match(msgs[1].body, /^💸 Ivy\n/)
  assert.match(msgs[1].body, /\$2K\+ · \$2,500 · quiet 30d · fan i1 · https:\/\/onlyfans.com\/my\/chats\/chat\/i1/)
  assert.ok(!msgs[1].body.includes('Jane'), 'one creator per message')
  for (const m of msgs) assert.match(m.body, /Never forward this to a creator/)
  assert.deepEqual(winbackMessages([], '2026-10-05'), [])
})

test('reel days compare the day and the next against her usual two days', () => {
  const history = [...run('2026-08-01', '2026-09-19', 10_000), { ...emptyDay('2026-09-20'), net: 30_000, subs: 9 }, { ...emptyDay('2026-09-21'), net: 20_000 }, ...run('2026-09-22', '2026-09-29', 10_000)]
  const post = (id: string, day: string, plays: number): ReelPost => ({ post_id: id, handle: 'jane', posted_at: startOfDay(day) + 36_000_000, plays, caption: 'POV skit' })
  const days = reelDays([post('a', '2026-09-20', 50_000), post('b', '2026-09-20', 5_000), post('c', '2026-09-25', 9_000)], history, 10_000, '2026-09-30')
  const hit = days.find((d) => d.day === '2026-09-20')!
  assert.equal(hit.best, 5)
  assert.equal(hit.net, 50_000)
  assert.equal(hit.moneyMultiple, 2.5)
  assert.equal(hit.hit && hit.moved, true)
  assert.equal(hit.reels.length, 2)
  const s = summarize(days)
  assert.deepEqual([s.hitDays, s.hitAvg, s.otherDays, s.otherAvg], [1, 2.5, 1, 1])
  assert.equal(reelDays([post('z', '2026-09-30', 1)], history, 10_000, '2026-09-30').length, 0, 'today is not judged')
})
