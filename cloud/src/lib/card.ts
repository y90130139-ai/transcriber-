/**
 * What every card tells her, beyond the brief — the parts of the Creative
 * Director workflow the card never carried.
 *
 * Step 7 says every idea sent must include seven things. The card had three:
 * the inspiration video, a hook, and outfit notes. Missing were **facial
 * expression direction** (entirely), **what she needs to recreate** versus
 * what she can change, and the per-reel checklist the Viral Reels Blueprint
 * runs every reel through. Story direction and carousels were not in her week
 * at all, though the analytics layer measures her against both.
 *
 * Pure and import-free, because her page renders it in a client component and
 * the console renders the same words on the server. Everything here is said to
 * her, in her words — "reskin" is our vocabulary, not hers.
 */

/** How her face carries the reel, by format. First match wins, in SHAPE's order
 *  of specificity. The manual is blunt about why this is on the card: a video
 *  often works because of the expression, and "just sending the caption" loses
 *  it. */
const EXPRESSION: [string, string][] = [
  ['car-confession', 'Relaxed and a little sheepish, like you are admitting it to a friend. Glance away, then back to the lens on the point.'],
  ['confession', 'Soft and a little embarrassed on the admission, then own it. The honesty is the hook.'],
  ['reveal', 'Blank or unimpressed before the cut, then a completely different look after it. That change is the point.'],
  ['mirror', 'Confident, looking at the phone in the mirror rather than at yourself. A small smile, never a posed grin.'],
  ['rage-bait', 'Dead serious. You believe every word, and you are slightly annoyed anyone would disagree.'],
  ['rant', 'Fed up but in control. Eye contact, no smiling until the very end, if at all.'],
  ['pov-skit', 'In character from the first frame. React to the viewer as if they really are the person in the caption.'],
  ['comedy', 'Deadpan. Let the line be funny; your face should not be in on the joke.'],
  ['skit', 'Play the character all the way. Go big on the big lines, stay still on the quiet ones.'],
  ['reaction', 'Your face is the content — let it change. Hold the reaction a beat longer than feels natural.'],
  ['storytime', 'Like you are telling one friend something you should not. Lean in on the good part.'],
  ['q-and-a', 'Relaxed and a little amused by the question. Answer like it is obvious.'],
  ['advice', 'Confident, warm, a little knowing. You have done this a hundred times.'],
  ['thirst-trap', 'Confident and unbothered. Soft eyes to the lens, a slow half-smile — never a posed grin.'],
  ['fit-check', 'Pleased with yourself. A small smile on the reveal, eyes to camera on the last shot.'],
  ['try-on', 'Real reactions to each outfit. Let one of them visibly be your favourite.'],
  ['grwm', 'Chatty and easy. Look up at the lens between steps like you are talking to someone.'],
  ['dance', 'Energy up and having fun with it. Smile into the lens on the beat drops.'],
  ['lip-sync', 'Sell every word with your face. The expression has to match the line, not just the timing.'],
  ['gym', 'Focused, then a quick look to camera between reps — like you caught someone watching.'],
  ['talking-head', 'Straight down the lens, relaxed, like it is a FaceTime. Let your natural reactions show.'],
  ['text-overlay', 'Let the text do the talking. One clear expression that matches the line — hold it.'],
  ['day-in-life', 'Natural. You are living it, not performing it.'],
  ['street-interview', 'Curious and playful. React to their answers, do not just wait for your turn.'],
  ['teaser', 'A knowing look, like you are keeping a secret. Leave them wanting the rest.'],
  ['promo', 'Warm and direct. You are inviting them, not selling to them.'],
]

const EXPRESSION_DEFAULT =
  'Confident and natural. Eyes to the lens on the opening, and keep your energy up for the first two seconds.'

/** The expression line for a card, from its format tags. */
export function expressionFor(formats: string[]): string {
  const hit = EXPRESSION.find(([tag]) => formats.includes(tag))
  return hit ? hit[1] : EXPRESSION_DEFAULT
}

export type Bucket = 'reskin' | 'iteration' | 'test' | 'repurpose'

/** What she keeps and what she changes — the manual's copy-exactly-vs-change
 *  decision, which the card never stated. */
export type CopyRule = { label: string; keep: string; change: string }

const AXIS_WORD: Record<string, string> = {
  outfit: 'your outfit',
  location: 'where you film it',
  hook: 'the opening line',
}

/**
 * The rule for this card, by where it came from.
 *
 * A control keeps everything, because it is the measuring stick. A variant
 * changes exactly one named thing. An iteration keeps the concept. A new idea
 * keeps the *structure* — the hook, the pacing, the turn — and changes
 * everything that makes it hers, which is the manual's own recreate
 * instruction almost word for word.
 */
export function copyRuleFor(bucket: Bucket | null, axis: string | null): CopyRule {
  if (bucket === 'reskin' && !axis) {
    return {
      label: 'Your video again — the same way',
      keep: 'Everything: the outfit, the place, the words, the length.',
      change: 'Nothing. Film it just like last time.',
    }
  }
  if (bucket === 'reskin' && axis) {
    const what = AXIS_WORD[axis] ?? axis
    return {
      label: `Your winner again — change ${what}`,
      keep: 'The idea, the words, the timing.',
      change: `Only ${what}. Keep everything else the same.`,
    }
  }
  if (bucket === 'iteration') {
    return {
      label: 'One more go',
      keep: 'The idea and how it plays out.',
      change: 'Nothing on purpose. It did well — we want to see if it does it again.',
    }
  }
  if (axis === 'twist') {
    // The reel that is about nothing in particular — a joke, a mood, a moment.
    // It travels on its shape, so the shape is the part she keeps and the
    // subject is the part she replaces with something out of her own life.
    return {
      label: 'A new idea — make it about your world',
      keep: 'How it is built: the opening, the timing, where the turn lands.',
      change: 'What it is about. This one is not from your world — swap the subject for '
        + 'something out of your life, in your words. Everything else about it stays.',
    }
  }
  // "There never will be same person or same reaction" (Susanna, V-30, a
  // reel built on a stranger's reaction). The idea is what she copies; the
  // people and what they do will be different, and that is fine.
  return {
    label: 'A new idea',
    keep: 'The idea: how it opens, the pacing, where the turn lands.',
    change: 'Everything else — outfit, place, angle, words. If other people or their reactions are in it, '
      + 'yours will be different people and different reactions. It never has to match.',
  }
}

/**
 * What makes a video look good enough to perform, checked before she presses
 * record (Geno, 2026-09-27). Replaced the Viral Reels Blueprint's post-filming
 * questions ("Would you send it to a friend?"), which arrived after the only
 * moment they could change anything. Eight, picked from sixteen: the rest
 * either happen on their own or are already in the card's directions.
 */
export const FILM_CHECKLIST = [
  'Wipe the lens — one pass with your shirt.',
  'Phone steady: on a tripod or propped up, not in your hand.',
  'Face the light — a window or ring light in front of you, never behind.',
  'Eyes in the top third of the screen, and keep your face and any text away from the bottom and the right edge (Instagram covers them).',
  'A tidy background with some depth — step away from the wall.',
  'Nothing personal in the frame: mail, addresses, a mirror showing the room.',
  'Know your first line or first move before you press record.',
  'Film it 2–3 times so you can pick the best one.',
] as const

/**
 * Story direction, one theme per day.
 *
 * The manual's story strategy is a conversion circle — CTAs, polls, questions,
 * teasers, lifestyle — and the daily pass has been measuring whether a story
 * went up without ever saying what should be in it. Rotated across the week so
 * no two days ask for the same thing.
 */
export const STORY_PROMPTS = [
  { day: 'Monday', theme: 'Lifestyle', prompt: 'A normal moment from your day — coffee, the drive, what you are wearing. Keep it real.' },
  { day: 'Tuesday', theme: 'Poll', prompt: 'A two-option poll. This or that — outfits, food, anything they will tap without thinking.' },
  { day: 'Wednesday', theme: 'Question', prompt: 'A question sticker. "Ask me anything" or something specific they will want to answer.' },
  { day: 'Thursday', theme: 'Teaser', prompt: 'A glimpse of something you are posting later. Enough to want it, not enough to have it.' },
  { day: 'Friday', theme: 'Link', prompt: 'A clear reason to tap your link, and the link. One ask, nothing else on the story.' },
  { day: 'Saturday', theme: 'Behind the scenes', prompt: 'Getting ready, the setup, a blooper from filming. People like being let in.' },
  { day: 'Sunday', theme: 'Reply', prompt: 'Share a DM or comment reply — screenshot it, answer it. It makes people want to message you.' },
] as const

/** Carousel guidance for the week, placed in the in-between slots the schedule
 *  already keeps free. The manual wants 1–3 a week; the analytics measure her
 *  against 2 and nothing ever asked for any. They come from the photos taken
 *  between outfit changes on shoot day, so they cost no extra filming. */
export const CAROUSEL_PLAN = {
  count: 2,
  slots: [
    { day: 'Tuesday', time: '11:30' },
    { day: 'Thursday', time: '11:30' },
  ],
  source:
    'Use the photos from between your outfit changes on shoot day — a mirror selfie, a normal selfie and a tripod shot of each outfit. Three to six slides, best one first.',
} as const

/**
 * What kind of job a card is, in one word, shown big at the top of her card
 * (Geno, 2026-09-27). Worked out from where the card came from:
 *
 *   repurpose  her own video, going out again — she saves it and posts it
 *   recreate   her own video, filmed again (Recreate, or the planner's reskins
 *              and iterations of her winners)
 *   new        someone else's reel for her to make her own version of
 *   yours      one of her own reels added as a plain card — shown in its own
 *              section at the end of her week, not as an assignment
 *              (2026-09-27: 22 of Susanna's 50 cards were her own videos)
 */
export type CardKind = 'new' | 'recreate' | 'repurpose' | 'yours'

export function cardKind(bucket: Bucket | null, sourcePost: string | null, mine = false): CardKind {
  if (bucket === 'repurpose') return 'repurpose'
  if (mine && !bucket) return 'yours'
  if (sourcePost || bucket === 'reskin' || bucket === 'iteration') return 'recreate'
  return 'new'
}

export const KIND_TEXT: Record<CardKind, { label: string; line: string }> = {
  new: { label: 'New video', line: 'Watch it, then film your own version. Copy the idea — your version never has to match.' },
  recreate: { label: 'Recreate', line: 'This is your video. It did well — film it again.' },
  repurpose: { label: 'Repurpose', line: 'This is your video. No filming — we refresh it and send it to you in your group chat to post again.' },
  yours: { label: 'Your video', line: 'One of yours that did well. Post it again or film a fresh take — only if you want to.' },
}

/** A Repurpose card once the refreshed file has gone back to her. */
export const REPURPOSE_READY = 'Your refreshed video is in your group chat. Post it again this week.'

/** Her words for a bucket, for the small label on the card. */
export const BUCKET_LABEL: Record<Bucket, string> = {
  reskin: 'Your winner',
  iteration: 'One more go',
  test: 'New idea',
  repurpose: 'Repurpose',
}
