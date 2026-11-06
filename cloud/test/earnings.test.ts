// node --import ./test/ts-resolve.mjs --test test/earnings.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { addDays, dayOf, daysBetween, emptyDay, foldDays, startOfDay, type Day, type RawTxn } from '../src/lib/earnings/days'
import { nextWindow, windowEnd } from '../src/lib/earnings/window'
import { dayDrop, dense, median, money, weeklyNumbers, weeklyText, winFor, winText } from '../src/lib/earnings/report'
import { milestoneText, recapText, type Milestone, type Recap } from '../src/lib/earnings/monthly'

const at = (iso: string) => String(Date.parse(iso))
const txn = (over: Partial<RawTxn>): RawTxn => ({
  createdTime: at('2026-09-10T15:00:00Z'), type: 'Messages', status: 'done', amount: '1000', net: '800', ...over,
})

/** A dense run of days at a fixed net, for baselines. */
function run(from: string, to: string, net: number): Day[] {
  return daysBetween(from, to).map((day) => ({ ...emptyDay(day), net, gross: Math.round(net / 0.8), txns: 1 }))
}
const withDay = (days: Day[], day: string, over: Partial<Day>) =>
  days.map((d) => (d.day === day ? { ...d, ...over } : d))

test('foldDays drops refunds, keeps loading as provisional, never keeps fan fields', () => {
  const days = foldDays([
    txn({}),
    txn({ status: 'undo', net: '99999' }),
    txn({ status: 'pending_return', net: '99999' }),
    txn({ status: 'loading', type: 'Tips', amount: '500', net: '400' }),
    txn({ type: 'Subscription', amount: '1000', net: '800' }),
    txn({ type: 'RecurringSubscription', amount: '1000', net: '800' }),
    { ...txn({}), fanId: '123', fanName: 'PENDING CUSTOM' } as RawTxn,
  ])
  assert.equal(days.length, 1)
  const [d] = days
  assert.equal(d.net, 800 + 400 + 800 + 800 + 800)
  assert.equal(d.gross, 1000 + 500 + 1000 + 1000 + 1000)
  assert.equal(d.txns, 5)
  assert.equal(d.loading_net, 400)
  assert.equal(d.by_type.Tips, 400)
  assert.equal(d.subs, 1)
  assert.equal(d.renewals, 1)
  assert.ok(!JSON.stringify(days).includes('PENDING'))
  assert.ok(!JSON.stringify(days).includes('fan'))
})

test('days are New York days, across the clock change', () => {
  assert.equal(dayOf(Date.parse('2026-09-11T03:30:00Z')), '2026-09-10') // 23:30 EDT
  assert.equal(dayOf(Date.parse('2026-09-11T04:30:00Z')), '2026-09-11')
  assert.equal(startOfDay('2026-09-11'), Date.parse('2026-09-11T04:00:00Z'))
  assert.equal(startOfDay('2026-12-01'), Date.parse('2026-12-01T05:00:00Z'))
  assert.equal(startOfDay('2026-11-01'), Date.parse('2026-11-01T04:00:00Z')) // DST ends that morning
  assert.equal(addDays('2026-02-28', 1), '2026-03-01')
})

test('money reads as a person would write it', () => {
  assert.equal(money(421_050), '$4,211')
  assert.equal(money(4_250), '$42.50')
})

test('weekly compares the same seven days both sides, with the best day and split', () => {
  let history = run('2026-08-01', '2026-09-27', 10_000) // $100/day
  history = withDay(history, '2026-09-24', { net: 50_000, by_type: { ...emptyDay('x').by_type, Messages: 50_000 } })
  const n = weeklyNumbers(history, '2026-09-21', '2026-08-01')
  assert.equal(n.net, 6 * 10_000 + 50_000)
  assert.equal(n.prevNet, 70_000)
  assert.equal(n.change, 57)
  assert.deepEqual(n.best, { day: '2026-09-24', net: 50_000 })
  assert.equal(n.avg4, 70_000)
  assert.equal(n.dropAlert, false)
  assert.equal(n.split[0].type, 'Messages')
  const text = weeklyText(n, 'seed')
  assert.match(text, /up 57% on last week/)
  assert.match(text, /Best day: Thu, Sep 24, \$500/)
  assert.doesNotMatch(text, /20% fee/)
})

test('a down week is plain, flags OPS, and never says so to her in alarming words', () => {
  const history = [...run('2026-08-01', '2026-09-20', 10_000), ...run('2026-09-21', '2026-09-27', 5_000)]
  const n = weeklyNumbers(history, '2026-09-21', '2026-08-01')
  assert.equal(n.change, -50)
  assert.equal(n.dropAlert, true)
  const text = weeklyText(n, 'seed')
  assert.match(text, /down 50% on last week/)
  assert.doesNotMatch(text, /alarm|worr|bad|crash|terrible/i)
})

test('no comparison is claimed on history we do not hold', () => {
  const n = weeklyNumbers(run('2026-09-21', '2026-09-27', 10_000), '2026-09-21', '2026-09-21')
  assert.equal(n.change, null)
  assert.equal(n.avg4, null)
  assert.match(weeklyText(n, 's'), /first weekly report/)
})

test('a good day is 1.5x her median and over the floor', () => {
  const history = withDay(run('2026-08-01', '2026-09-29', 20_000), '2026-09-29', { net: 31_000 })
  // Also her best in 90? No: history only starts Aug 1, so best30 applies.
  const w = winFor(history, '2026-09-29', '2026-08-01')
  assert.equal(w?.kind, 'best30')
  assert.equal(w?.multiple, 1.6)

  const flat = withDay(run('2026-08-01', '2026-09-29', 5_000), '2026-09-29', { net: 12_000 })
  assert.equal(winFor(flat, '2026-09-29', '2026-08-01'), null, 'under the $150 floor')
})

test('best in 90 beats best in 30, and a spike inside 30 blocks best30 but not good', () => {
  const base = run('2026-06-01', '2026-09-29', 20_000)
  const ninety = withDay(base, '2026-09-29', { net: 90_000 })
  assert.equal(winFor(ninety, '2026-09-29', '2026-06-01')?.kind, 'best90')

  const spiky = withDay(withDay(base, '2026-09-15', { net: 100_000 }), '2026-09-29', { net: 40_000 })
  assert.equal(winFor(spiky, '2026-09-29', '2026-06-01')?.kind, 'good')
})

test('a win mostly unsettled says so', () => {
  const history = withDay(run('2026-08-01', '2026-09-29', 20_000), '2026-09-29', { net: 40_000, loading_net: 30_000 })
  const w = winFor(history, '2026-09-29', '2026-08-01')
  assert.equal(w?.provisional, true)
  assert.match(winText(w!, 's'), /still settling/)
})

test('day drops only count when the day before was real money', () => {
  const history = withDay(run('2026-09-01', '2026-09-29', 20_000), '2026-09-29', { net: 10_000 })
  assert.equal(dayDrop(history, '2026-09-29')?.change, -50)
  const small = withDay(run('2026-09-01', '2026-09-29', 5_000), '2026-09-29', { net: 1_000 })
  assert.equal(dayDrop(small, '2026-09-29'), null)
})

test('dense fills missing days with zero and median handles evens', () => {
  const d = dense([{ ...emptyDay('2026-09-02'), net: 5 }], '2026-09-01', '2026-09-03')
  assert.deepEqual(d.map((x) => x.net), [0, 5, 0])
  assert.equal(median([1, 2, 3, 4]), 2.5)
})

test('a window never asks Infloww for the future, and walks a backfill forward', () => {
  const now = Date.parse('2026-09-30T15:00:00Z')
  assert.equal(windowEnd('2026-09-30', now), now)
  assert.equal(windowEnd('2026-09-29', now), startOfDay('2026-09-30'))

  assert.deepEqual(nextWindow({ pulled_through: null, pulled_at: null }, '2026-09-30'), { from: '2026-06-02', to: '2026-07-01' })
  assert.deepEqual(nextWindow({ pulled_through: '2026-07-01', pulled_at: '2026-09-30T14:00:00Z' }, '2026-09-30'), { from: '2026-06-28', to: '2026-07-27' })
  assert.equal(nextWindow({ pulled_through: '2026-09-30', pulled_at: '2026-09-30T14:00:00Z' }, '2026-09-30'), null)
  assert.deepEqual(nextWindow({ pulled_through: '2026-09-30', pulled_at: '2026-09-30T14:00:00Z' }, '2026-10-01'), { from: '2026-09-27', to: '2026-10-01' })
})

test('a week after a $0 week is not called her first report', () => {
  const history = [...run('2026-08-01', '2026-09-13', 0), ...run('2026-09-21', '2026-09-27', 10_000)]
  const n = weeklyNumbers(history, '2026-09-21', '2026-08-01')
  assert.equal(n.first, false)
  assert.doesNotMatch(weeklyText(n, 's'), /first weekly report/)
})

test('a good-day note names the day, so approving it late still reads right', () => {
  const history = withDay(run('2026-06-01', '2026-09-29', 20_000), '2026-09-15', { net: 100_000 })
  const w = winFor(withDay(history, '2026-09-29', { net: 40_000 }), '2026-09-29', '2026-06-01')
  assert.equal(w?.kind, 'good')
  assert.match(winText(w!, 'seed'), /Tue, Sep 29/)
  assert.doesNotMatch(winText(w!, 'seed'), /yesterday/)
})

test('only a clean pull made today, reaching yesterday, counts as current', async () => {
  const { isCurrent } = await import('../src/lib/earnings/window')
  const ok = { pulled_through: '2026-09-30', pulled_at: '2026-09-30T13:05:00Z', pull_error: null, missing_since: null }
  assert.equal(isCurrent(ok, '2026-09-30'), true)
  assert.equal(isCurrent({ ...ok, pull_error: 'Infloww 500' }, '2026-09-30'), false)
  assert.equal(isCurrent({ ...ok, pulled_at: '2026-09-29T13:05:00Z', pulled_through: '2026-09-29' }, '2026-09-30'), false, 'yesterday partial from the run before')
  assert.equal(isCurrent({ ...ok, missing_since: '2026-09-30T00:00:00Z' }, '2026-09-30'), false)
})

test('nothing a creator reads ever says "net" or explains the 20% fee', () => {
  // Geno, 2026-10-29: "it shows milestones for certain models and then it shows
  // 20% net and that makes no sense... we do not want net anything to be
  // displayed because it confused models and i took this out originally and
  // its still there which is so damn annoying."
  //
  // The figures stay exactly as they are - they are what she is actually paid.
  // What goes is the label and the footnote: calling the number "net" and then
  // explaining OnlyFans' cut invites a question about a number she cannot
  // change, in a message whose whole job is to say well done.
  const history = [...daysBetween('2026-09-01', '2026-09-28').map((day) => ({ ...emptyDay(day), net: 10_000, txns: 1 }))]
  const week = weeklyNumbers(history, '2026-09-21', '2026-09-01')
  const win = winFor(history, '2026-09-28', '2026-09-01', 15_000)
  const recap: Recap = {
    month: '2026-09-01', net: 280_000, prevNet: 250_000, change: 12, subs: 40, renewals: 12, streak: 3, record: true,
    bestWeek: { from: '2026-09-07', to: '2026-09-13', net: 90_000 }, split: [], provisional: false,
  }
  const milestones: Milestone[] = [{ code: 'record', line: '🏆 You just beat your best month on record: $2,800 so far in September!' }]

  const texts = [
    weeklyText(week, 'seed'),
    recapText(recap),
    milestoneText(milestones),
    ...(win ? [winText(win, 'seed')] : []),
  ]
  assert.ok(texts.length >= 3, 'every creator-facing builder is covered')
  for (const text of texts) {
    assert.ok(!/\bnet\b/i.test(text), `a creator would read "net" in: ${text}`)
    assert.ok(!/20\s*%/.test(text), `a creator would read the 20% fee in: ${text}`)
    assert.ok(!/fee/i.test(text), `a creator would read about a fee in: ${text}`)
  }
  // The numbers themselves are untouched - this is a wording change, not a
  // maths change.
  assert.match(weeklyText(week, 'seed'), /💰 Earnings: \$700/)
  assert.match(recapText(recap), /💰 \$2,800, up 12% on August/)
})
