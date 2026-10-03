/**
 * What a message the assistant drafts for a creator may never say (/q phase 3,
 * Geno 2026-10-03). Enforced in code, not left to the prompt: a draft that
 * breaks one is refused before it is ever shown, and Geno's tap is still
 * required to send one that passes. Pure, so it is tested on its own.
 */

export const MAX_DRAFT = 1500

type Rule = { test: (text: string) => boolean; why: string }

/** Links a draft may carry: a reel or post on Instagram, a TikTok video, her
 *  plan page. Anything else that looks like a link - with or without
 *  https:// (Telegram links bare domains too) - is refused. */
const ALLOWED_LINK = /^(?:https?:\/\/)?(?:www\.)?(?:instagram\.com\/(?:reel|reels|p)\/[\w-]+\/?|tiktok\.com\/@[\w.]+\/video\/\d+\/?|transcriber-ten-zeta\.vercel\.app\/p\/[\w-]+(?:\/[\w-]*)?)$/i
const LINKISH = /(?:https?:\/\/)?(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s]*)?/gi

function badLink(t: string): boolean {
  return (t.match(LINKISH) ?? []).some((link) => !ALLOWED_LINK.test(link.replace(/[).,!?]+$/, '')))
}

const RULES: Rule[] = [
  // Creators film and edit their own videos: no "we"/"our team" near "edit".
  { test: (t) => /\b(?:we|we're|we've|we'll|weve|were going to|our(?: team)?)\b[^.!?\n]{0,40}\bedit/i.test(t), why: 'it says we edit their videos - creators film and edit their own' },
  // Priority and tier are internal; a model never sees hers.
  { test: (t) => /\b(?:priorit(?:y|ies|ise|ize|ised|ized)|tiers?|[sabc][ -]tier)\b/i.test(t), why: 'it mentions priority or tier, which models never see' },
  // No money in a hand-written message: earnings go out only through the
  // earnings reports, which have their own approval.
  { test: (t) => /[$€£]|\b(?:usd|eur|gbp|dollars?|bucks|euros?|pounds?|cash|earn(?:ed|ings?)?|revenue|income|payout|net|gross)\b|\b\d+(?:[.,]\d+)?\s?k\b/i.test(t), why: 'it talks about money - earnings only go out through the earnings reports' },
  { test: (t) => /\b(?:rank(?:ed|ing|s)?|leaderboard|top (?:earner|creator|model)s?|best (?:creator|model)s?|other (?:models|creators|girls|guys)|compared? (?:to|with))\b/i.test(t), why: 'it compares them with other creators' },
  { test: badLink, why: 'it links somewhere other than an Instagram reel/post, a TikTok video or their plan page' },
]

/** Returns the reasons a draft cannot go to `self`, or [] when it may be shown.
 *  `others` is every other model's name: a message to one creator never names
 *  another. */
export function draftProblems(text: string, self: string, others: string[], otherHandles: string[] = []): string[] {
  const t = text.trim()
  const problems: string[] = []
  if (!t) return ['it is empty']
  if (t.length > MAX_DRAFT) problems.push(`it is ${t.length} characters - keep it under ${MAX_DRAFT}`)
  for (const rule of RULES) if (rule.test(t)) problems.push(rule.why)
  const selfWords = new Set(self.toLowerCase().split(/\s+/))
  const escape = (v: string) => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  for (const name of others) {
    // Her full name, or a first name of 3+ letters that is not also hers.
    const first = name.split(/\s+/)[0]
    const candidates = [name, ...(first.length >= 3 && !selfWords.has(first.toLowerCase()) ? [first] : [])]
    const hit = candidates.find((c) => new RegExp(`\\b${escape(c)}\\b`, 'i').test(t))
    if (hit) problems.push(`it names another creator (${hit})`)
  }
  for (const handle of otherHandles.map((h) => h.replace(/^@/, '')).filter((h) => h.length >= 3)) {
    if (new RegExp(`@?\\b${escape(handle)}\\b`, 'i').test(t)) problems.push(`it names another creator's account (@${handle})`)
  }
  return problems
}
