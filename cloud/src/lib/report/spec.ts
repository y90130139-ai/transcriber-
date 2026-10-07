/**
 * The Creator Intelligence & Content Strategy Report — the pure half.
 *
 * Geno handed the whole template on 2026-10-06: a 24-section report that
 * turns everything known about a model (intake dumps, meeting notes, her
 * questionnaire, her own reels, feedback) into a creative strategy specific
 * to her — "so any future content plan feels built specifically for them".
 *
 * The discipline the template itself insists on, enforced here and in the
 * prompt: CONFIRMED (stated, shown, demonstrated) is kept apart from
 * INFERENCE (a strategic conclusion), and nothing biographical is invented.
 * What the sources cannot answer comes back as GAPS — the few questions to
 * actually ask her — instead of filler.
 *
 * No imports: the parsing and shaping are tested without a database, and
 * the client renders these types without dragging anything in.
 */

export type ReportSection = {
  id: string
  title: string
  /** Plain text with hyphen lists and blank-line paragraphs — rendered
   *  pre-wrap, never markdown. */
  body: string
}

export type ReportGap = {
  /** Which part of the report is starved. */
  about: string
  /** The question to put to her, as it would be asked. */
  question: string
}

export type CreatorReport = {
  sections: ReportSection[]
  gaps: ReportGap[]
}

/** What `models.about` holds once a report exists. */
export type AboutDoc = {
  report: CreatorReport
  generated_at: string
  engine: 'anthropic' | 'workers'
  /** Standing corrections (the template's "permanent correction layer"):
   *  each one is fed back into every later generation. */
  corrections: { at: string; note: string }[]
  /** What the generation saw, by size — provenance, not content. */
  sources: Record<string, number>
}

/** The sections, in the template's own order. The generator must answer all
 *  of them; one it has nothing for says so in one line rather than vanishing
 *  (a missing section reads as an oversight, an empty one as a finding). */
export const REPORT_SECTIONS: { id: string; title: string }[] = [
  { id: 'snapshot', title: 'Creator snapshot' },
  { id: 'bio', title: 'Creator in one paragraph' },
  { id: 'personality', title: 'Core personality' },
  { id: 'voice', title: 'Natural speaking style' },
  { id: 'usps', title: 'Creator USPs' },
  { id: 'interests', title: 'Interest map' },
  { id: 'skills', title: 'Skills, knowledge, experience' },
  { id: 'lifestyle', title: 'Lifestyle & environment' },
  { id: 'audience', title: 'Target audience profile' },
  { id: 'positioning', title: 'Brand positioning' },
  { id: 'contrast', title: 'Brand contrast' },
  { id: 'pillars', title: 'Content pillars' },
  { id: 'mix', title: 'Content mix' },
  { id: 'humor', title: 'Humor profile' },
  { id: 'debate', title: 'Debate / rage-bait profile' },
  { id: 'sexual', title: 'Sexual content profile' },
  { id: 'trends', title: 'Social culture / trend profile' },
  { id: 'references', title: 'Content references' },
  { id: 'worked', title: 'Content that has already worked' },
  { id: 'feedback', title: 'Feedback & correction layer' },
  { id: 'nogo', title: 'No-go areas' },
  { id: 'risks', title: 'Creative risks' },
  { id: 'opportunities', title: 'Creative opportunities' },
  { id: 'rules', title: 'Content generation rules' },
]

const SECTION_IDS = new Set(REPORT_SECTIONS.map((s) => s.id))
const TITLE_BY_ID = new Map(REPORT_SECTIONS.map((s) => [s.id, s.title]))

const MAX_SECTION_CHARS = 6000
const MAX_GAPS = 12

/**
 * Read the model's JSON answer into a report, forgiving the ways models
 * wander: unknown sections are dropped, missing ones are stubbed, order is
 * restored to the template's, and gap lists are capped. Null when the answer
 * holds no usable sections at all — the caller treats that as a failed run.
 */
export function readReport(raw: unknown): CreatorReport | null {
  if (!raw || typeof raw !== 'object') return null
  const body = raw as { sections?: unknown; gaps?: unknown }
  const given = new Map<string, string>()
  if (Array.isArray(body.sections)) {
    for (const entry of body.sections) {
      const section = entry as { id?: unknown; body?: unknown }
      if (typeof section.id !== 'string' || !SECTION_IDS.has(section.id)) continue
      if (typeof section.body !== 'string' || !section.body.trim()) continue
      given.set(section.id, section.body.trim().slice(0, MAX_SECTION_CHARS))
    }
  }
  if (given.size === 0) return null

  const sections: ReportSection[] = REPORT_SECTIONS.map(({ id, title }) => ({
    id,
    title,
    body: given.get(id) ?? 'Nothing in the sources answers this yet.',
  }))

  const gaps: ReportGap[] = []
  if (Array.isArray(body.gaps)) {
    for (const entry of body.gaps) {
      const gap = entry as { about?: unknown; question?: unknown }
      if (typeof gap.question !== 'string' || !gap.question.trim()) continue
      gaps.push({
        about: typeof gap.about === 'string' ? gap.about.slice(0, 80) : 'general',
        question: gap.question.trim().slice(0, 300),
      })
      if (gaps.length >= MAX_GAPS) break
    }
  }
  return { sections, gaps }
}

export function titleOf(id: string): string {
  return TITLE_BY_ID.get(id) ?? id
}

/** Evidence blocks are clipped per source so one enormous intake dump cannot
 *  crowd everything else out of the context. */
export function clip(text: string, max: number): string {
  if (text.length <= max) return text
  return `${text.slice(0, max)}\n[… clipped at ${max} characters]`
}

/* ------------------------------------------------- the instructions */

/** The report template, as Geno specified it (2026-10-06), condensed into
 *  working instructions. The section ids must match REPORT_SECTIONS. */
export const REPORT_PROMPT = `You are the creative strategist for a short-form content agency. From the evidence below, write a CREATOR INTELLIGENCE & CONTENT STRATEGY REPORT for this creator — deep enough that any future content plan feels built specifically for them, never from a generic creator archetype.

HARD RULES:
- Distinguish CONFIRMED (directly stated, shown or demonstrated in the evidence) from INFERENCE (a strategic conclusion you draw). Mark inferences inline as "(inferred)". Never invent biography, interests or restrictions the evidence does not support.
- One random mention in the evidence is not a content pillar. Weigh how often and how strongly something appears.
- Write for a creative team: factual, specific, usable. No marketing copy, no praise, no filler.
- Where the evidence is silent, say so in one line and raise it in "gaps" instead of padding.
- Plain text only inside bodies: short paragraphs, hyphen lists. No markdown headers, no bold.

Write ALL of these sections (id → what it must contain):
- snapshot: name, age, location, origin, platforms, target market, audience known so far, creator stage, primary business goal. "Not provided" where unknown.
- bio: one factual paragraph — where based, age if known, personality, strongest interests, lifestyle, what makes them different, audience appeal.
- personality: 5–8 primary traits (e.g. confident, dry, bratty, goofy, deadpan, unbothered), then 2–4 sentences on how the traits actually show up.
- voice: sentence style, vocabulary, humor style, delivery, typical phrases ONLY if directly observed in her own words, words that would sound unnatural from her, then a 2–4 sentence overall voice description.
- usps: 2–3 core USPs + secondary ones. Each core USP: the USP, the evidence, the content potential. Never generic ("attractive", "funny", "likes travelling").
- interests: Tier 1 (should recur in content), Tier 2 (variety), Tier 3 (occasional personality detail), and "mentioned but NOT strong enough to build on".
- skills: topics she can genuinely speak on; for each, level (casual / knowledgeable / expert / lived experience) and how confidently it can be used.
- lifestyle: regular locations that can produce content, useful props/assets, activities already happening in her life.
- audience: the psychological audience, not just demographics — what they like, topics they engage with, what they find attractive about HER, what makes them comment, what makes them convert.
- positioning: "This creator is NOT: …" then "This creator IS: [one sentence]".
- contrast: the interesting contradiction (pretty girl × car knowledge, sweet face × dirty humor…), a secondary one, and why it works.
- pillars: 5–8 content pillars, each tied back to HER — what belongs there, example themes, audience purpose (reach / debate / attraction / personality / conversion).
- mix: rough weekly percentages across the pillars and why.
- humor: humor that fits, humor that does not, and 3–5 joke constructions that suit her (e.g. observation → unexpected comparison → throwaway punchline).
- debate: topics she can credibly challenge, strong vs weak/forced rage-bait areas, and the right tone. Rage bait exposes a contradiction or invites debate; it never just insults people.
- sexual: intensity 1–10, the styles that fit (innuendo, double meaning, innocent delivery…), what to avoid, and 1–3 joke mechanics that suit her specifically.
- trends: which kinds of trends she should comment on, which not, and the rule: never a news presenter — the event is a jumping-off point for a joke, debate or observation.
- references: creators named as references; for each, what specifically to take (delivery, pacing, hook structure…) and what never to copy (language, premises, catchphrases, identity).
- worked: her reels that performed, each with why it worked, the mechanic (debate / joke / curiosity / relatability), what is reusable (the mechanic) and what is not (the premise).
- feedback: every piece of standing feedback and correction on record — this is a permanent correction layer future content must obey.
- nogo: only CONFIRMED restrictions (topics she will not touch, formats she declined and why).
- risks: where this strategy could turn generic or repetitive, each with the counter-move.
- opportunities: what is not yet exploited, ranked high / medium / experimental.
- rules: the ALWAYS / NEVER list for generating her content — her vocabulary, her identity, varied hooks, specific jokes, things she could actually say aloud; never a generic creator, never one interest exaggerated into the whole brand.

ANSWER AS JSON, nothing else:
{"sections":[{"id":"snapshot","body":"…"}, …], "gaps":[{"about":"which section","question":"the question to ask her, as you would ask it"}]}
Keep gaps to the few questions that would genuinely sharpen the report.`
