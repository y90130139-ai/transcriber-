/** An intake form, read back into the vocabulary everything else already speaks.
 *
 * Onboarding a model has always ended with somebody re-typing her answers into
 * the sheet. The answers are already in the same three axes the library tags
 * videos with — she says she does GRWMs and storytimes and will not do gym
 * content, and those are `format` tags and `wont_do` tags verbatim. So this
 * reads the form and proposes the profile.
 *
 * **Rule-based, and it proposes rather than saves.** Same discipline as
 * `autotag.ts` and `brief.ts`: a lookup table, no model, and nothing at all
 * when it is unsure. An answer it cannot place comes back in `unmapped` where
 * Geno can see it was skipped — the failure mode to avoid is a profile that
 * looks filled in and is quietly wrong, because a wrong `formats` array is
 * invisible and steers every recommendation `match.ts` makes for her.
 *
 * Two strengths of evidence, and the UI keeps them apart:
 *   - `label` — the answer contains a taxonomy label or id outright. Our own
 *     form offers those as checkboxes, so this is the normal case and it is
 *     ticked by default.
 *   - `keyword` — inferred from the same lexicon the autotagger uses. Offered
 *     unticked, because inference about a person is a claim, not a reading.
 */
import { mentions } from './autotag'
import { FORMAT_WORDS, PERSONA_WORDS } from './lexicon'
import { AXES, taxonomy, type Axis } from './taxonomy'
import { ALL_PLACES } from './timezones'

/** A form longer than this is not a form. Guards the parser, not the upload. */
const MAX_CHARS = 200_000
const MAX_ANSWERS = 200
/** An answer longer than this is an essay; the tail is not more signal. */
const MAX_ANSWER_CHARS = 2000
const MAX_WEEKLY_TARGET = 200

/** Persona is a claim about a person, so one stray word must not carry it —
 *  the same two-hit rule `autotag.ts` applies to a whole transcript. Format
 *  and hook can stand on one unambiguous phrase. */
const KEYWORD_HITS_NEEDED: Record<Axis, number> = { persona: 2, format: 1, hook: 1, topic: 1 }

/** Answers that mean "I did not answer". Kept out of `unmapped` so the review
 *  list is short enough to actually read. */
const EMPTY_ANSWERS = new Set(['', '-', '--', 'n/a', 'na', 'none', 'nope', 'no', 'nothing', 'tbd', '?'])

export type Answer = { question: string; answer: string }

export type Mapped = {
  axis: Axis
  tag: string
  label: string
  /** Why it is being proposed — see the file header. */
  why: 'label' | 'keyword'
  /** The question that produced it, so a wrong proposal is traceable. */
  from: string
}

export type IntakeFields = {
  name?: string
  handle?: string
  place?: string
  timezone?: string
  filming_days?: number[]
  weekly_target?: number
  ig_account_type?: 'professional' | 'personal'
  drive_url?: string
  standing_rules?: string
}

export type IntakeProposal = {
  fields: IntakeFields
  /** Which question each field came from, for the same traceability. */
  fieldSources: Record<string, string>
  /** Fields read from an answer that could mean more than one thing. Proposed
   *  like any other and deliberately not pre-ticked — `Miami, Florida` names a
   *  state that spans two zones, and picking the wrong half moves her whole
   *  week by an hour without ever looking wrong. */
  unsure: string[]
  persona: Mapped[]
  formats: Mapped[]
  hooks: Mapped[]
  wont_do: Mapped[]
  /** Answers nothing was made of. Shown, never silently dropped. */
  unmapped: Answer[]
  answers: number
}

// ------------------------------------------------------------ reading answers

const clean = (value: string) => value.replace(/\s+/g, ' ').trim()

/** Strip the furniture a form picks up on its way here: bullets, bold, numbering. */
const bare = (line: string) =>
  clean(line.replace(/\*\*/g, '').replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').replace(/^#+\s*/, ''))

const isEmptyAnswer = (value: string) => EMPTY_ANSWERS.has(value.toLowerCase().replace(/[.!]$/, ''))

/** One row of a CSV, quotes and embedded commas included. */
function csvRow(line: string): string[] {
  const cells: string[] = []
  let cell = ''
  let quoted = false
  for (let at = 0; at < line.length; at += 1) {
    const character = line[at]
    if (quoted) {
      if (character === '"' && line[at + 1] === '"') { cell += '"'; at += 1 }
      else if (character === '"') quoted = false
      else cell += character
    } else if (character === '"') quoted = true
    else if (character === ',') { cells.push(cell); cell = '' }
    else cell += character
  }
  cells.push(cell)
  return cells.map(clean)
}

/** A CSV export, in either of the two shapes a form produces: a header row and
 *  one response row (Google Forms), or two columns of question and answer. */
function fromCsv(text: string): Answer[] | null {
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0)
  if (lines.length < 2 || !lines[0].includes(',')) return null

  const rows = lines.map(csvRow)
  const header = rows[0]

  if (header.length >= 3 && rows[1].length === header.length) {
    return header.map((question, column) => ({ question, answer: rows[1][column] ?? '' }))
  }
  if (rows.every((row) => row.length === 2)) {
    return rows.map(([question, answer]) => ({ question, answer }))
  }
  return null
}

/** A JSON export: one flat object of question to answer. */
function fromJson(text: string): Answer[] | null {
  if (!text.trim().startsWith('{')) return null
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>
    const entries = Object.entries(parsed).filter(
      ([, value]) => typeof value === 'string' || typeof value === 'number' || Array.isArray(value),
    )
    if (entries.length === 0) return null
    return entries.map(([question, value]) => ({
      question: clean(question),
      answer: clean(Array.isArray(value) ? value.join(', ') : String(value)),
    }))
  } catch {
    return null
  }
}

/** Prose, in the shape a filled-in form actually arrives: `Question: answer`,
 *  or a question on its own line with the answer under it. */
function fromLines(text: string): Answer[] {
  const lines = text.split(/\r?\n/).map(bare)
  const found: Answer[] = []

  for (let at = 0; at < lines.length; at += 1) {
    const line = lines[at]
    if (!line) continue

    // `Handle: @her` and `What days can you film? Tue, Thu` are the same
    // shape with a different mark, and a form arrives in both. The earlier
    // mark wins, so a Drive URL's own `https:` never splits a question.
    const colon = line.indexOf(':')
    const mark = line.indexOf('?')
    const split = mark >= 0 && (colon < 0 || mark < colon) ? mark : colon
    if (split > 0 && split < line.length - 1) {
      const question = clean(line.slice(0, split + (split === mark ? 1 : 0)))
      const answer = clean(line.slice(split + 1))
      if (answer.length > 0) {
        found.push({ question, answer })
        continue
      }
    }

    // A question with its answer on the following lines — the shape a form
    // takes when it is pasted out of a document rather than exported.
    if (line.endsWith('?') || (colon === line.length - 1 && colon > 0)) {
      const body: string[] = []
      while (at + 1 < lines.length && lines[at + 1] && !lines[at + 1].endsWith('?')) {
        at += 1
        body.push(lines[at])
      }
      if (body.length > 0) {
        found.push({ question: clean(line.replace(/:$/, '')), answer: clean(body.join(' ')) })
      }
    }
  }
  return found
}

/**
 * Every question and answer this text holds.
 *
 * When none of the three shapes fits, the whole document comes back as one
 * unlabelled answer. Keyword mapping still runs over it, which is worth
 * something on a page of prose, and every proposal it produces is `keyword`
 * strength and therefore unticked.
 */
export function readAnswers(text: string): Answer[] {
  const source = text.slice(0, MAX_CHARS)
  const answers = fromJson(source) ?? fromCsv(source) ?? fromLines(source)

  const kept = answers
    .map((entry) => ({
      question: entry.question.slice(0, 200),
      answer: entry.answer.slice(0, MAX_ANSWER_CHARS),
    }))
    .filter((entry) => entry.answer.length > 0 && !isEmptyAnswer(entry.answer))
    .slice(0, MAX_ANSWERS)

  if (kept.length > 0) return kept
  const whole = clean(source).slice(0, MAX_ANSWER_CHARS * 4)
  return whole.length > 0 ? [{ question: '', answer: whole }] : []
}

// -------------------------------------------------------------- mapping tags

/** The words a tag answers to: its label, its id, and each side of a label
 *  that names two things — `Gym / workout` is answered by either. */
function namesFor(tag: { id: string; label: string }): string[] {
  const parts = tag.label.split('/').map((part) => clean(part).toLowerCase())
  return [...new Set([tag.id.replace(/-/g, ' '), tag.label.toLowerCase(), ...parts])].filter(Boolean)
}

const NAMES: Record<Axis, { id: string; names: string[] }[]> = {
  persona: taxonomy.persona.tags.map((tag) => ({ id: tag.id, names: namesFor(tag) })),
  format: taxonomy.format.tags.map((tag) => ({ id: tag.id, names: namesFor(tag) })),
  hook: taxonomy.hook.tags.map((tag) => ({ id: tag.id, names: namesFor(tag) })),
  topic: taxonomy.topic.tags.map((tag) => ({ id: tag.id, names: namesFor(tag) })),
}

const LEXICON: Partial<Record<Axis, Record<string, string[]>>> = {
  format: FORMAT_WORDS,
  persona: PERSONA_WORDS,
}

const labelOfTag = (axis: Axis, id: string) =>
  taxonomy[axis].tags.find((tag) => tag.id === id)?.label ?? id

/**
 * Which tags of one axis an answer names.
 *
 * Label evidence beats keyword evidence for the same tag and replaces it, so a
 * tag she ticked is never demoted to something we inferred.
 */
export function tagsIn(axis: Axis, answer: Answer): Mapped[] {
  const haystack = answer.answer.toLowerCase()
  const found = new Map<string, Mapped['why']>()

  // With no question in front of it there is no telling which side of the form
  // a word came from — `I won't do gym stuff` names the same tag as `I do gym
  // stuff`. So an unlabelled blob can only ever produce inferences, and every
  // one of them arrives unticked.
  const strongest: Mapped['why'] = answer.question ? 'label' : 'keyword'

  for (const tag of NAMES[axis]) {
    if (tag.names.some((name) => mentions(haystack, name))) found.set(tag.id, strongest)
  }

  const lexicon = LEXICON[axis]
  if (lexicon) {
    for (const [id, phrases] of Object.entries(lexicon)) {
      if (found.get(id) === 'label') continue
      const hits = phrases.filter((phrase) => mentions(haystack, phrase)).length
      if (hits >= KEYWORD_HITS_NEEDED[axis]) found.set(id, 'keyword')
    }
  }

  return [...found.entries()].map(([tag, why]) => ({
    axis, tag, why, label: labelOfTag(axis, tag), from: answer.question,
  }))
}

// ------------------------------------------------------------ routing answers

/** Which field a question is asking about. First match wins, so the more
 *  specific patterns are listed first — `won't do` before `content`. */
const ROUTES: { field: keyof IntakeFields | 'persona' | 'formats' | 'hooks' | 'wont_do'; words: string[] }[] = [
  { field: 'wont_do', words: ['wont do', "won't do", 'will not do', 'you not do', 'not do', 'not shoot', 'not film', 'hard no', 'hard limit', 'limits', 'boundaries', 'not comfortable', 'off limits', 'never do', 'refuse', 'avoid'] },
  { field: 'ig_account_type', words: ['professional account', 'business account', 'creator account', 'business or creator', 'account type', 'professional or personal'] },
  { field: 'handle', words: ['instagram', 'ig handle', 'handle', 'username', '@'] },
  { field: 'filming_days', words: ['what days', 'which days', 'days can you film', 'filming days', 'days you film', 'availability'] },
  { field: 'weekly_target', words: ['how many videos', 'videos a week', 'per week', 'weekly target', 'how much content'] },
  { field: 'weekly_target', words: ['how many'] },
  { field: 'drive_url', words: ['drive', 'folder link', 'where do you send'] },
  { field: 'place', words: ['where are you', 'where do you live', 'location', 'timezone', 'time zone', 'city', 'state', 'country', 'based'] },
  { field: 'name', words: ['your name', 'full name', 'what do you go by', 'name'] },
  { field: 'standing_rules', words: ['rules', 'anything we should know', 'must never', 'always'] },
  { field: 'hooks', words: ['hook', 'first three seconds', 'opening'] },
  { field: 'persona', words: ['niche', 'persona', 'describe yourself', 'positioning', 'your vibe', 'audience'] },
  { field: 'formats', words: ['content', 'formats', 'videos do you', 'types of video', 'what do you film', 'comfortable filming', 'shoot'] },
]

function routeOf(question: string): (typeof ROUTES)[number]['field'] | null {
  const asked = question.toLowerCase()
  if (!asked) return null
  return ROUTES.find((route) => route.words.some((word) => asked.includes(word)))?.field ?? null
}

const DAY_WORDS = [
  ['sunday', 'sun'], ['monday', 'mon'], ['tuesday', 'tues', 'tue'], ['wednesday', 'weds', 'wed'],
  ['thursday', 'thurs', 'thu'], ['friday', 'fri'], ['saturday', 'sat'],
]

function daysIn(answer: string): number[] {
  const text = answer.toLowerCase()
  if (mentions(text, 'every day') || mentions(text, 'any day') || mentions(text, 'daily')) {
    return [0, 1, 2, 3, 4, 5, 6]
  }
  const days = DAY_WORDS.flatMap((names, index) =>
    names.some((name) => mentions(text, name)) ? [index] : [],
  )
  return days
}

/** An answer that is not actually an answer. `not sure` read as a `not` is
 *  how "nobody has checked" becomes "her account is personal". */
const HEDGES = ['not sure', 'unsure', 'no idea', 'no clue', 'idk', "don't know", 'dont know', 'maybe', 'i think', 'probably']

/**
 * Yes/no, read strictly.
 *
 * Anything ambiguous stays unknown. The asymmetry is deliberate: `unknown`
 * costs one question to Geno, and a wrong `professional` costs an afternoon
 * spent wondering why her Insights call 400s.
 */
function accountTypeIn(answer: string): 'professional' | 'personal' | null {
  const text = answer.toLowerCase()
  if (HEDGES.some((hedge) => text.includes(hedge))) return null

  const professional = ['professional', 'business', 'creator'].some((word) => mentions(text, word))
  const personal = mentions(text, 'personal') || mentions(text, 'private')

  if (professional && personal) {
    // "No — personal, not a professional one" names both and means one.
    return /\bnot?\b[^.]{0,24}(professional|business|creator)/.test(text) ? 'personal' : null
  }
  if (professional) return 'professional'
  if (personal) return 'personal'
  if (mentions(text, 'yes') || mentions(text, 'yeah') || mentions(text, 'yep')) return 'professional'
  if (mentions(text, 'no') || mentions(text, 'nope')) return 'personal'
  return null
}

/** The bare name of a place, before the zone qualifier the picker appends. */
const placeName = (label: string) => clean(label.split(/\(|—/)[0]).toLowerCase()

/**
 * The place she named, as one of the picker's own labels.
 *
 * A name several places share — Florida is in two zones — resolves to the
 * first, and is deliberately weak evidence: the sheet shows a clock beside the
 * choice, which is the check that catches a wrong half.
 */
function placeIn(answer: string): { label: string; zone: string; sure: boolean } | null {
  const text = answer.toLowerCase()
  const hits = ALL_PLACES.filter((place) => mentions(text, placeName(place.label)))
  if (hits.length === 0) return null
  const best = hits.reduce((longest, place) =>
    placeName(place.label).length > placeName(longest.label).length ? place : longest)
  const shared = hits.filter((place) => placeName(place.label) === placeName(best.label))
  return { label: best.label, zone: best.zone, sure: shared.length === 1 }
}

const httpsUrlIn = (answer: string): string | null => {
  const found = answer.match(/https?:\/\/\S+/)
  return found ? found[0].replace(/[).,]+$/, '') : null
}

// ------------------------------------------------------------- the proposal

/**
 * Turn a filled-in form into a proposed profile.
 *
 * Nothing here writes. The route stores the proposal, the sheet shows it with
 * every inference unticked, and the profile is saved by the same PUT a hand
 * edit uses — so the review step that the constitution asks for is the review
 * step that already existed.
 */
export function mapIntake(answers: Answer[]): IntakeProposal {
  const proposal: IntakeProposal = {
    fields: {}, fieldSources: {}, unsure: [],
    persona: [], formats: [], hooks: [], wont_do: [],
    unmapped: [], answers: answers.length,
  }

  const add = (axis: Axis, into: Mapped[], found: Mapped[]) => {
    let added = 0
    for (const tag of found) {
      const existing = into.find((held) => held.tag === tag.tag)
      if (existing) {
        if (existing.why === 'keyword' && tag.why === 'label') existing.why = 'label'
        continue
      }
      into.push(tag)
      added += 1
    }
    return added > 0 || found.length > 0
  }

  const takeField = <K extends keyof IntakeFields>(key: K, value: IntakeFields[K], from: string) => {
    if (value === undefined || value === null) return false
    if (Array.isArray(value) && value.length === 0) return false
    if (proposal.fields[key] !== undefined) return false
    proposal.fields[key] = value
    proposal.fieldSources[key] = from
    return true
  }

  for (const answer of answers) {
    const route = routeOf(answer.question)
    let used = false

    switch (route) {
      case 'wont_do':
        used = add('format', proposal.wont_do, tagsIn('format', answer))
        break
      case 'persona':
        used = add('persona', proposal.persona, tagsIn('persona', answer))
        break
      case 'formats':
        used = add('format', proposal.formats, tagsIn('format', answer))
        break
      case 'hooks':
        used = add('hook', proposal.hooks, tagsIn('hook', answer))
        break
      case 'handle': {
        const handle = clean(answer.answer).replace(/^https?:\/\/(www\.)?instagram\.com\//i, '')
          .replace(/[/?].*$/, '').replace(/^@+/, '')
        used = /^[\w.]{1,60}$/.test(handle) && takeField('handle', handle, answer.question)
        break
      }
      case 'name':
        used = takeField('name', clean(answer.answer).slice(0, 120), answer.question)
        break
      case 'ig_account_type': {
        const type = accountTypeIn(answer.answer)
        used = type !== null && takeField('ig_account_type', type, answer.question)
        break
      }
      case 'filming_days':
        used = takeField('filming_days', daysIn(answer.answer), answer.question)
        break
      case 'weekly_target': {
        const number = answer.answer.match(/\d+/)
        const target = number ? Number(number[0]) : NaN
        used = Number.isFinite(target) && target > 0 && target <= MAX_WEEKLY_TARGET
          && takeField('weekly_target', target, answer.question)
        break
      }
      case 'drive_url': {
        const url = httpsUrlIn(answer.answer)
        used = url !== null && takeField('drive_url', url, answer.question)
        break
      }
      case 'place': {
        const place = placeIn(answer.answer)
        if (place) {
          used = takeField('place', place.label, answer.question)
          if (used) {
            proposal.fields.timezone = place.zone
            if (!place.sure) proposal.unsure.push('place')
          }
        }
        break
      }
      case 'standing_rules':
        used = takeField('standing_rules', clean(answer.answer).slice(0, 4000), answer.question)
        break
      default: {
        // An unrouted question is still read for tags, because our own form is
        // not the only shape a form arrives in. Every axis, weakest first, so
        // an answer that names a format lands as a format.
        for (const axis of AXES) {
          const into = axis === 'persona' ? proposal.persona : axis === 'format' ? proposal.formats : proposal.hooks
          if (add(axis, into, tagsIn(axis, answer))) used = true
        }
      }
    }

    if (!used) proposal.unmapped.push(answer)
  }

  // A format cannot be both something she does and something she refuses. The
  // refusal wins: recommending what she has said no to is the worse error.
  const refused = new Set(proposal.wont_do.map((tag) => tag.tag))
  proposal.formats = proposal.formats.filter((tag) => !refused.has(tag.tag))

  return proposal
}
