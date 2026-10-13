/**
 * The numbered reel formats — what the CD brief's "Format reels" section
 * draws from (Geno, 2026-10-12).
 *
 * The German playbook (lib/german.ts) is the same family of numbered formats
 * with its own conduct rules and its own picker; this file is the general
 * list the briefs use for every model. Picking one in the Add content
 * composer is the "template": its directions, per-version outfits and editor
 * notes come in, and every field stays editable — write over anything and it
 * is a card of your own.
 *
 * Numbers continue the German playbook's own (1..67 there, from #68 up
 * here); the source's gaps are the source's own. Add new rows as the
 * creative director publishes them — the composer picks them up by number or
 * name with nothing else to change.
 */

export type FormatReel = {
  /** The team's own number — how the brief and the group chat talk about it. */
  no: string
  name: string
  dir: string
  editorNotes: string
  versions: { outfit: string; caption?: string }[]
}

export const FORMAT_REELS: FormatReel[] = [
  {
    no: '69',
    name: 'Black top transition',
    dir: 'Wear a baggie sweatshirt with bare legs and tug at it until the interval of the song where you transition into lingerie. Facial expression is key here, along with timing to the music.',
    editorNotes: 'Very important you keep the same audio as the reference reel.',
    versions: [
      { outfit: 'Baggie sweatshirt, bare legs' },
      { outfit: 'Baggie t-shirt, bare legs' },
    ],
  },
  {
    no: '70',
    name: 'Age',
    dir: 'Straight to camera, four looks. The pattern of expressions is the whole reel — yes, no, yes, yes.',
    editorNotes: 'Facial expression is key — pattern: yes, no, yes, yes.',
    versions: [
      { outfit: 'Low-cut top', caption: 'Captions: 55 year olds / 21 year olds / 32 year olds / 67 year olds' },
      { outfit: 'Open cardigan, tank', caption: 'Captions: Drives a Porsche 911 / Calls his car his baby / Can fix his own car / Knows how to change a tyre' },
    ],
  },
  {
    no: '71',
    name: 'Bathroom door skit',
    dir: 'Film in the doorway with a tight fitted outfit; turn to the side so the silhouette reads. Facial expression and body angle are key.',
    editorNotes: 'Body angle and expression are key — turn to the side so the silhouette reads.',
    versions: [
      { outfit: 'Light colored bodycon dress', caption: 'Captions: Mom / Sister / Step bro' },
      { outfit: 'Tight fitted gym set', caption: 'Captions: Mom / Little brother / Step bro' },
    ],
  },
  {
    no: '72',
    name: 'Skit',
    dir: 'Low cut top, tying up your shoes. Film where there is depth — space behind and in front of you. Facial expressions and acting are key.',
    editorNotes: 'Film where there is depth — space behind and in front of you.',
    versions: [
      { outfit: 'On the couch, like the reference', caption: 'Caption: "3 hours of sleep doesn\u2019t affect me at all"' },
      { outfit: 'Outside on a bench', caption: 'Caption: "I don\u2019t need 8 hours of sleep, I\u2019m built different."' },
    ],
  },
  {
    no: '73',
    name: 'Mirror reveal',
    dir: 'Spray the mirror, wipe to reveal, end shocked. Second clip: in a bikini or lingerie, keep wiping and wink at the reflection.',
    editorNotes: '',
    versions: [
      { outfit: 'Black bikini' },
      { outfit: 'Bright bikini' },
    ],
  },
  {
    no: '74',
    name: 'Car rant',
    dir: 'In the car, straight to camera — one take, one point, no smiling until the end.',
    editorNotes: '',
    versions: [{ outfit: 'Hoodie' }],
  },
]

/** Match by number ("69", "58b") or by name ("black", "bathroom"). */
export function findFormatReel(query: string): FormatReel | null {
  const raw = (query || '').trim()
  if (!raw) return null
  const num = raw.match(/^(\d+[a-z]?)/i)
  if (num) {
    const hit = FORMAT_REELS.find((reel) => reel.no.toLowerCase() === num[1].toLowerCase())
    if (hit) return hit
  }
  const needle = raw.toLowerCase()
  return (
    FORMAT_REELS.find((reel) => `${reel.no} · ${reel.name}`.toLowerCase() === needle)
    // A partial name ("black", "bathroom") matches by prefix anywhere in it.
    ?? FORMAT_REELS.find((reel) => reel.name.toLowerCase().includes(needle))
    // "72 skit" — the number and the name in one line. The number has to be
    // there: without it, a German label like "German #17 · Cleavage + Task
    // Movement" matched #70 "Age" on the "age" inside "Cleavage" and the card
    // was titled "70 · Age" (found 2026-10-13).
    ?? FORMAT_REELS.find((reel) =>
      needle.includes(reel.name.toLowerCase())
      && new RegExp(`(^|\\D)${reel.no}(\\D|$)`).test(needle))
    ?? null
  )
}

/** The Omegle lane's one card — Tom's fundamentals, as the brief carries it. */
export const OMEGLE_GAMES = 'Simon says — have them do dares: turn around, bend over, anything the chat will clip.'

export const OMEGLE_QUESTIONS = [
  'On a scale of 1\u201310, how would you rate yourself in bed?',
  'What\u2019s your worst bedroom review?',
  'If your last situationship rated you out of 10, what would they give you?',
  'Me or GTA6?',
  'Most chaotic 2am text you stand behind to this day?',
  'What ruins a 10 instantly?',
  'Serious question — does size actually matter?',
].join('\n')

export const OMEGLE_TRAINING = 'Watch Tom show you through the fundamentals — Loom in the group chat. Halloween costume optional.'

export const OMEGLE_LABEL = "Omegle session — Tom's fundamentals"
