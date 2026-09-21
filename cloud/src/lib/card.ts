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
  ['reveal', 'Neutral or unimpressed before the cut, then the look changes completely after it. The contrast is the payoff.'],
  ['mirror', 'Confident, looking at the phone in the mirror rather than at yourself. A small smile, never a posed grin.'],
  ['rage-bait', 'Dead serious. You believe every word, and you are slightly annoyed anyone would disagree.'],
  ['rant', 'Fed up but in control. Eye contact, no smiling until the very end, if at all.'],
  ['pov-skit', 'In character from the first frame. React to the viewer as if they really are the person in the caption.'],
  ['comedy', 'Deadpan. Let the line be funny; your face should not be in on the joke.'],
  ['skit', 'Commit to the character. Big where the script is big, still where it is still.'],
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

export type Bucket = 'reskin' | 'iteration' | 'test'

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
      label: 'Your winner again — exactly as it was',
      keep: 'Everything: outfit, place, words, delivery, length.',
      change: 'Nothing. This one is the measuring stick the others are compared to.',
    }
  }
  if (bucket === 'reskin' && axis) {
    const what = AXIS_WORD[axis] ?? axis
    return {
      label: `Your winner again — change ${what}`,
      keep: 'The concept, the words, the delivery, the timing.',
      change: `Only ${what}. One change is the whole point — two changes and we cannot tell which one worked.`,
    }
  }
  if (bucket === 'iteration') {
    return {
      label: 'One more go',
      keep: 'The concept and the structure.',
      change: 'Nothing on purpose. It did well without taking off — this tells us whether it was the idea or the day.',
    }
  }
  return {
    label: 'A new idea',
    keep: 'The structure: how it opens, the pacing, where the turn lands.',
    change: 'The outfit, the background, the angle and the words — make it yours.',
  }
}

/** The Viral Reels Blueprint's per-reel checklist, worded for her to run
 *  before she posts rather than for us to audit after. */
export const REEL_CHECKLIST = [
  'Does the first second stop the scroll on its own?',
  'Is every second earning its place — nothing slow in the middle?',
  'Is there a reward at the end for watching all of it?',
  'Is the lighting good and the background interesting — not a white wall?',
  'Does the outfit fit well and look intentional?',
  'Will someone actually type a comment, not just scroll past?',
  'Would you send it to a friend?',
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

/** Her words for a bucket, for the small label on the card. */
export const BUCKET_LABEL: Record<Bucket, string> = {
  reskin: 'Your winner',
  iteration: 'One more go',
  test: 'New idea',
}
