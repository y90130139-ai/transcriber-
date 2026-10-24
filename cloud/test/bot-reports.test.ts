import test from 'node:test'
import assert from 'node:assert/strict'
import { reportFor, PUBLIC_TOPICS } from '../src/lib/assistant/bot-reports'

// The bot shares every report in one bag. roster_health is in that bag and is
// agency-wide money plus what individual fans spend; it may only be read
// through the roster_health tool, which checks the chat first. This tool is
// reachable from the staff group, so it must not be a second way in.
const snapshot = () => ({
  today: 'stories and RSVPs',
  drive_pipeline: 'who is behind',
  roster_health: JSON.stringify({
    agency: { oct_net: 171_966 },
    creators: [{ name: 'Paige', oct_net: 11_387, idle: { top: [['575501487', 12_680]] } }],
  }),
})

test('the board is not readable through bot_reports, by name or by listing', () => {
  const asked = reportFor(snapshot(), 'roster_health')
  assert.ok(!('report' in asked), 'no payload leaves this tool');
  assert.ok(!JSON.stringify(asked).includes('575501487'), 'and no fan id')
  assert.ok(!JSON.stringify(asked).includes('171966'), 'and no agency money')
  assert.match(asked.note ?? '', /its own/, 'it says where the board lives instead of failing silently')

  const listed = reportFor(snapshot(), '')
  assert.deepEqual(listed.available_topics, ['today', 'drive_pipeline'])
  assert.ok(!listed.available_topics?.includes('roster_health'), 'it is not advertised either')
})

test('the public reports still come back', () => {
  assert.deepEqual(reportFor(snapshot(), 'today'), { topic: 'today', report: 'stories and RSVPs' })
  // An unknown name lists what there is, and says nothing about a held report.
  const unknown = reportFor(snapshot(), 'nonsense')
  assert.deepEqual(unknown.available_topics, ['today', 'drive_pipeline'])
  assert.equal(unknown.note, undefined)
})

test('a report the bot starts sharing is held until it is listed, not served by default', () => {
  // The whole point of an allow-list: the next sensitive report is safe
  // before anyone remembers it exists.
  const withNew = { ...snapshot(), fan_spend_by_creator: 'something new and private' }
  const out = reportFor(withNew, 'fan_spend_by_creator')
  assert.ok(!('report' in out))
  assert.ok(!out.available_topics?.includes('fan_spend_by_creator'))
  assert.ok(!PUBLIC_TOPICS.has('roster_health'))
})
