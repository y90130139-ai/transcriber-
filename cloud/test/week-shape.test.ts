// node --import ./cloud/test/ts-resolve.mjs --test cloud/test/week-shape.test.ts
// Cases are Susanna's real week of 2026-09-28 (rrqCtFd40kYG).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  readableLine, sameLine, shapeWeek, cleanHook, fillCaptions, needsOthers,
  MIN_CAPTIONS, MAX_CAPTIONS, type ShapeInput, type BankLine,
} from '../src/lib/week-shape'

const WOMAN_WRONG = /\b(he|him|his|guy|guys|dude|man|men|boyfriend material)\b/i

function card(over: Partial<ShapeInput>): ShapeInput {
  return {
    id: Math.random().toString(36).slice(2), bucket: null, hook: null, on_screen_captions: null,
    caption_options: null, author: 'someone', source_caption: null, duration_sec: 10,
    formats: ['text-overlay'], topic: null, needs_others: false, verdict: 'open', filmed: false,
    messages: [], ...over,
  }
}

test('screen-text misreads are not shown as a hook', () => {
  assert.equal(readableLine('Bal al'), null) // V-29
  assert.equal(readableLine('and ORA'), null) // V-30
  assert.equal(readableLine('211'), null)
  assert.equal(readableLine('LUS! +34 644727452 | OPENING HOURS | 07:00-00:00 | M'), null)
  assert.equal(readableLine(null), null)
})

test('real on-screen lines survive, with the frame breaks joined', () => {
  assert.equal(readableLine("POV: A Slavic girl | when she's happy."), "POV: A Slavic girl when she's happy.") // V-25
  assert.equal(readableLine('POV: you looked for one second too long'), 'POV: you looked for one second too long')
})

test('cleanHook drops junk screen lines and keeps the readable ones', () => {
  const out = cleanHook({ hook: 'and ORA', on_screen_captions: [{ t: 0, text: 'and | ORA' }, { t: 4, text: 'Leave your luggage and enjoy the island' }] })
  assert.equal(out.hook, null)
  assert.deepEqual(out.on_screen_captions, [{ t: 4, text: 'Leave your luggage and enjoy the island' }])
  assert.equal(cleanHook({ hook: 'Bal al', on_screen_captions: [{ t: 4, text: 'Bal al' }, { t: 7, text: '211' }] }).on_screen_captions, null)
})

test('typos do not make two captions different', () => {
  assert.ok(sameLine('the sand is way to hot 🥺', 'The sand is way too hot 🥹'))
  assert.ok(sameLine('Do you think it’s pink ? 🥸', 'do you think its pink? 🥸'))
  assert.ok(!sameLine('Success stops being about them and starts being about you', 'You read the whole message and still don’t respond'))
})

test('her own reels from her second account are marked hers, repeats folded', () => {
  const own = ['whoissusanna', 'susannadiazxo']
  const items = [
    card({ author: 'wegnerksenia', duration_sec: 8.57 }),
    card({ author: 'susannadiazxo', duration_sec: 19.58, source_caption: 'Why? 🥹' }),
    card({ author: 'susannadiazxo', duration_sec: 9.03, source_caption: 'the sand is way to hot 🥺' }),
    card({ author: 'susannadiazxo', duration_sec: 19.58, source_caption: 'Why? 🥹' }),
    card({ author: 'susannadiazxo', duration_sec: 9.03, source_caption: 'The sand is way too hot 🥹' }),
    // Same length, different words: two reels on one template, both stay.
    card({ author: 'susannadiazxo', duration_sec: 7.04, source_caption: 'Success stops being about them and starts being about you' }),
    card({ author: 'susannadiazxo', duration_sec: 7.04, source_caption: 'You read the whole message and still don’t respond' }),
  ]
  const shaped = shapeWeek(items, own, true)
  assert.deepEqual(shaped.map((s) => s.mine), [false, true, true, true, true, true, true])
  assert.deepEqual(shaped.map((s) => s.duplicate), [false, false, false, true, true, false, false])
})

test('the copy she has touched is the one kept', () => {
  const items = [
    card({ author: 'susannadiazxo', duration_sec: 11.12, source_caption: 'Come swim with me 🌊' }),
    card({ author: 'susannadiazxo', duration_sec: 11.12, source_caption: 'Come swim with me 🌊', verdict: 'accepted' }),
  ]
  assert.deepEqual(shapeWeek(items, ['susannadiazxo'], true).map((s) => s.duplicate), [true, false])
})

test('a planner card on her own reel stays an assignment', () => {
  const [shaped] = shapeWeek([card({ author: 'susannadiazxo', bucket: 'reskin' })], ['susannadiazxo'], true)
  assert.equal(shaped.mine, false)
})

test('couple reels are hidden from a solo model unless she took them on', () => {
  const items = [card({ needs_others: true }), card({ needs_others: true, verdict: 'accepted' }), card({})]
  assert.deepEqual(shapeWeek(items, [], true).map((s) => s.hidden), [true, false, false])
  assert.deepEqual(shapeWeek(items, [], false).map((s) => s.hidden), [false, false, false])
})

test('needsOthers reads the account, the caption and the voices', () => {
  const couples = new Set(['maslovalexey80', 'brisortizig'])
  const base = { author: 'x', rawCaption: null, speakerCount: 1, formats: [] as string[] }
  assert.ok(needsOthers({ ...base, author: 'maslovalexey80', rawCaption: 'I tried #bed #flirt #romantic' }, couples))
  assert.ok(needsOthers({ ...base, rawCaption: 'He’s the happiest man on earth😂\n\n#couples #funnyvideos' }, couples))
  assert.ok(needsOthers({ ...base, rawCaption: 'first and last day as a photographer with my gf💔' }, couples))
  assert.ok(needsOthers({ ...base, speakerCount: 3 }, couples))
  // A POV about a man is still one woman filming.
  assert.ok(!needsOthers({ ...base, rawCaption: 'I told him our clothes stay on and he was confused' }, couples))
  assert.ok(!needsOthers({ ...base, rawCaption: 'Peak happiness 😅 #slavicvibes' }, couples))
})

const BANK: BankLine[] = [
  { text: 'would u catch me if i fell?', reach: 40, formats: ['text-overlay'], topic: null },
  { text: 'lmk', reach: 12, formats: ['text-overlay'], topic: 'relatable' },
  { text: 'almost fell😱', reach: 8, formats: ['thirst-trap'], topic: null },
  { text: 'golf season is back', reach: 30, formats: ['text-overlay'], topic: 'golf' },
  { text: 'he said what?', reach: 50, formats: ['text-overlay'], topic: null },
  { text: 'barely did better', reach: 1.1, formats: ['text-overlay'], topic: null },
  { text: 'what would u do?', reach: 122, formats: ['skit'], topic: null },
  { text: 'Ever been in that situation?', reach: 123, formats: ['text-overlay'], topic: 'relatable' },
]

test('every card gets 2 to 4 captions, the reel’s own first', () => {
  const out = fillCaptions([
    { caption_options: null, source_caption: 'Come swim with me 🌊', formats: ['text-overlay'], topic: null },
    { caption_options: null, source_caption: null, formats: ['text-overlay'], topic: null },
  ], BANK, WOMAN_WRONG)
  for (const options of out) {
    assert.ok(options && options.length >= MIN_CAPTIONS && options.length <= MAX_CAPTIONS)
  }
  assert.equal(out[0]![0].caption, 'Come swim with me 🌊')
})

test('no caption is used twice in a week while the library has enough, none off-subject, none naming the wrong person, none unproven', () => {
  const out = fillCaptions(
    Array.from({ length: 2 }, () => ({ caption_options: null, source_caption: null, formats: ['text-overlay'], topic: 'fitness' })),
    BANK, WOMAN_WRONG,
  )
  const all = out.flatMap((o) => o?.map((c) => c.caption) ?? [])
  assert.equal(new Set(all).size, all.length)
  assert.ok(!all.includes('golf season is back'))
  assert.ok(!all.includes('he said what?'))
  assert.ok(!all.includes('barely did better'))
})

test('captions already written are left alone once there are enough', () => {
  const written = [{ formula: 'x', caption: 'kept', baits: 'y' }, { formula: 'x', caption: 'also kept', baits: 'z' }]
  const [out] = fillCaptions([{ caption_options: written, source_caption: 'other', formats: [], topic: null }], BANK, WOMAN_WRONG)
  assert.equal(out, written)
})

test('sign text caught at the edge of the frame comes off the line', () => {
  assert.equal(readableLine("KAYAST Signs you're in your peace era over"), "Signs you're in your peace era over")
  assert.equal(readableLine("2100 $200 $500 It's getting expensive to be single"), "It's getting expensive to be single")
  assert.equal(readableLine('R The kind of no that changes your whole life'), 'The kind of no that changes your whole life')
  assert.equal(readableLine('6 What it looks like to finally outgrow them'), 'What it looks like to finally outgrow them')
  assert.equal(readableLine('ar COLON BEACH O'), null)
  assert.equal(readableLine('When the universe finally sends a sign RIPCUR'), 'When the universe finally sends a sign')
  // Real lines keep their start.
  assert.equal(readableLine('POV: A SLAVIC GIRL WHEN SHE IS HAPPY'), 'POV: A SLAVIC GIRL WHEN SHE IS HAPPY')
  assert.equal(readableLine('I know it’s gonna'), 'I know it’s gonna')
  assert.equal(readableLine('Your lights are still on.'), 'Your lights are still on.')
})

test('borrowed captions must read under any video', async () => {
  const { universal } = await import('../src/lib/week-shape')
  const line = (text: string, topic: string | null = null) => ({ text, reach: 10, formats: [], topic })
  for (const ok of ['what would u do?', 'Ever been in that situation?', 'am i pulling this off?', 'you get me, right? 😏', 'agree? 👀', 'Which one is your favorite?']) {
    assert.ok(universal(line(ok)), ok)
  }
  for (const no of [
    'Mine’s Swampy Sewer what’s yours', // not a prompt
    'How addicted to golf are you?', // (topic golf)
    'What’s he picking? Decisions…', // points at someone
    'Você já passou por isso ?', // not English
    'Who is this tiktoker that terrorized me in the store?', // too long, points at someone
    'Is this what it’ll be like when the robots take over?', // too long
  ]) assert.ok(!universal(line(no, no.includes('golf') ? 'golf' : null)), no)
})

test('a card the engine gave one caption is topped up, its own line kept first', () => {
  const one = [{ formula: 'Self-Aware Flaw', caption: "I'm toxic but real", baits: 'thats not an excuse' }]
  const [out] = fillCaptions([{ caption_options: one, source_caption: null, formats: ['text-overlay'], topic: null }], BANK, WOMAN_WRONG)
  assert.equal(out![0].caption, "I'm toxic but real")
  assert.ok(out!.length >= MIN_CAPTIONS)
})

test('a week longer than the library still gets two a card, never one line twice on a card', () => {
  const week = Array.from({ length: 12 }, () => ({ caption_options: null, source_caption: null, formats: ['text-overlay'], topic: null }))
  const out = fillCaptions(week, BANK, WOMAN_WRONG)
  out.forEach((options, index) => {
    assert.ok(options && options.length >= MIN_CAPTIONS, `card ${index}`)
    assert.equal(new Set(options!.map((o) => o.caption)).size, options!.length)
  })
})

test('a repeated clip she turned down is the copy kept, never an unanswered twin', () => {
  const items = [
    card({ author: 'susannadiazxo', duration_sec: 9.03, source_caption: 'The sand is way too hot' }),
    card({ author: 'susannadiazxo', duration_sec: 9.03, source_caption: 'The sand is way too hot', verdict: 'declined' }),
  ]
  assert.deepEqual(shapeWeek(items, ['susannadiazxo'], true).map((s) => s.duplicate), [true, false])
})

test('a couple reel she declined is not hidden — it goes to her can\'t-do list', () => {
  assert.deepEqual(shapeWeek([card({ needs_others: true, verdict: 'declined' })], [], true).map((s) => s.hidden), [false])
})
