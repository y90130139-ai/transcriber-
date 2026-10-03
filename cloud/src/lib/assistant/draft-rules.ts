/**
 * What a message the assistant drafts for a creator may never say (/q phase 3,
 * Geno 2026-10-03). Enforced in code, not left to the prompt: a draft that
 * breaks one is refused before it is ever shown, and Geno's tap is still
 * required to send one that passes. Pure, so it is tested on its own.
 */

export const MAX_DRAFT = 1500

type Rule = { test: (text: string) => boolean; why: string }

const RULES: Rule[] = [
  // Models film and edit their own videos.
  { test: (t) => /\bwe(?:'ll| will| can| are going to)?\s+(?:edit|re-?edit)\b/i.test(t) || /\bour editors?\b/i.test(t), why: 'it says we edit their videos - creators film and edit their own' },
  // Priority and tier are internal; a model never sees hers.
  { test: (t) => /\b(priority|tier)\b/i.test(t), why: 'it mentions priority or tier, which models never see' },
  // No money in a hand-written message: earnings go out only through the
  // earnings reports, which have their own approval.
  { test: (t) => /\$\s?\d|\b\d[\d,.]*\s?(?:usd|dollars?|bucks)\b/i.test(t), why: 'it carries a money figure - earnings only go out through the earnings reports' },
  { test: (t) => /\b(rank(?:ed|ing)?|leaderboard|top earner|other (?:models|creators|girls))\b/i.test(t), why: 'it compares her with other creators' },
  { test: (t) => /https?:\/\/(?!(?:www\.)?instagram\.com\/|(?:www\.)?tiktok\.com\/|transcriber-ten-zeta\.vercel\.app\/)/i.test(t), why: 'it links somewhere other than Instagram, TikTok or her plan page' },
]

/** Returns the reasons a draft cannot go to `self`, or [] when it may be shown.
 *  `others` is every other model's name: a message to one creator never names
 *  another. */
export function draftProblems(text: string, self: string, others: string[]): string[] {
  const t = text.trim()
  const problems: string[] = []
  if (!t) return ['it is empty']
  if (t.length > MAX_DRAFT) problems.push(`it is ${t.length} characters - keep it under ${MAX_DRAFT}`)
  for (const rule of RULES) if (rule.test(t)) problems.push(rule.why)
  const selfWords = new Set(self.toLowerCase().split(/\s+/))
  for (const name of others) {
    // Match a full name, or a distinctive first name that is not also hers.
    const first = name.split(/\s+/)[0]
    const candidates = [name, ...(first.length >= 4 && !selfWords.has(first.toLowerCase()) ? [first] : [])]
    const hit = candidates.find((c) => new RegExp(`\\b${c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(t))
    if (hit) problems.push(`it names another creator (${hit})`)
  }
  return problems
}
