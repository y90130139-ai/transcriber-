/**
 * The words the client app shows, and the console edits (Geno, 2026-10-14).
 *
 * Every text-shaped screen in her app — the welcome, the onboarding
 * checklist, the FAQ, the Client SOP, the expectations page, the management
 * agreement — used to live hardcoded in the Expo build, so a typo meant a
 * store release. They are documents now: the console edits them in the same
 * Notion-style editor the SOPs use over on ai-invoice (BlockNote), the app
 * reads them from `/api/app/content` at runtime, and a change lands on her
 * phone without an app update.
 *
 * A document is a headline, a lede and a markdown body — the editor writes
 * BlockNote-flavoured markdown, the app parses that markdown into its own
 * native blocks. Two small panels stay structured because the app needs
 * structure there: the welcome's action chips (they point at real screens)
 * and the onboarding's checklist doors (they carry real forms). Everything
 * else is typed freely.
 *
 * The defaults in this file are the copy exactly as it shipped in the app,
 * transcribed to markdown (2026-10-14). A document that has never been
 * edited reads from here, so the app and the console both start from the
 * real thing, and "Reset to default" means something.
 *
 * The app mirrors these types in `expo-app-gosian/src/lib/content.ts` —
 * there is no shared package between the two, so change both together.
 */

import { INDEPENDENT_CONTRACTOR_AGREEMENT_BODY } from './independent-contractor-agreement'

export const APP_CONTENT_KEYS = ['welcome', 'onboarding', 'faq', 'sop', 'expectations', 'agreement'] as const
export type AppContentKey = (typeof APP_CONTENT_KEYS)[number]

export type StepKey = 'agreement' | 'contact' | 'intake'

export type RichDoc = {
  kind: 'rich'
  title: string
  kicker: string
  headline: string
  lede: string
  /** BlockNote-flavoured markdown — the document she reads. */
  body: string
  /** Welcome only: the action chips card. Labels are copy, the targets are
   *  the app's own screens. Null everywhere else. */
  actions: { label: string; items: { label: string; go: 'inbox' | 'plan' }[] } | null
  /** Onboarding only: the checklist doors. Titles and hints are copy; the
   *  keys tie each row to its form and its tick. Null everywhere else. */
  steps: { key: StepKey; title: string; hint: string }[] | null
}

export type AppDoc = RichDoc

export type ContentMeta = {
  updatedAt: string | null
  updatedBy: string | null
  /** False while the row has never been written — the doc shown is the
   *  built-in default, not an edit. */
  edited: boolean
}

/** Every document with its row's meta — what the console shell is handed on
 *  the server and what the app's read answers with. */
export type AppContentSnapshot = {
  docs: Record<AppContentKey, AppDoc>
  meta: Record<AppContentKey, ContentMeta>
  /** False when `transcriber.app_content` does not exist yet. */
  migrated: boolean
}

/** What the console's page headers and the sidebar read. */
export const APP_CONTENT_INFO: Record<AppContentKey, { label: string; screen: string; note: string }> = {
  welcome: {
    label: 'Welcome',
    screen: 'The welcome screen — first thing she reads after signing in',
    note: 'The banner, the messages card and the buttons are the app’s own. The action chips below the document point at real screens.',
  },
  onboarding: {
    label: 'Onboarding',
    screen: 'The checklist between signing in and the studio',
    note: 'The doors below the document keep their forms and their ticks — edit their titles and hints there.',
  },
  faq: {
    label: 'FAQ',
    screen: 'The FAQ in the drawer',
    note: 'Questions as headings, answers as paragraphs — type “/” in the document for everything else.',
  },
  sop: {
    label: 'Client SOP',
    screen: 'The Client SOP in the drawer',
    note: 'The long guide. Headings, lists, tables and quotes all render natively on her phone.',
  },
  expectations: {
    label: 'Expectations',
    screen: 'The expectations page in the drawer',
    note: 'The walkthrough video slot is the app’s own; the words around it are yours.',
  },
  agreement: {
    label: 'Agreement',
    screen: 'The Independent Contractor Agreement — the signing screen and the contract viewer',
    note: 'The old default agreement is replaced by this Independent Contractor Agreement. Published edits apply to new signatures only; existing signed copies stay fixed.',
  },
}

// ------------------------------------------------------------------ defaults

const WELCOME: RichDoc = {
  kind: 'rich',
  title: 'Welcome',
  kicker: 'Gosian Media LLC',
  headline: 'Welcome, {name}',
  lede: '',
  body: `## Welcome to your client portal :)

This portal is your all-in-one experience while working with Gosian Media LLC — view and complete important tasks, connect with the team, and keep all of your work-related forms and documents in one place.

We are very flexible, and almost always available. When it comes to calls, we keep strict working hours:

| Days | Hours (EST) |
| --- | --- |
| M – F | 9AM – 6PM |
| Sat – Sun | Closed |

Outside of those hours, expect a response first thing the next business morning.

Need something now? Hit the message button — your account manager is notified directly.

## What you’ll use this portal for

- Tasks we send your way — content requests, account access, promo schedules.
- Uploading content, assets, and anything the team needs to run your accounts.
- Messaging your account manager and the ops team directly.
- Contracts, forms, and anything that needs your signature.

## How to get the most out of working with us

- Check in here once every day or two. The faster you turn things around, the faster the revenue-driving work moves.
- Use the Message tab for anything urgent — the team monitors it live during working hours.
- Always send sensitive info — IDs, banking, account credentials — through the portal. Never DM or email it.`,
  actions: {
    label: 'Your actions',
    items: [
      { label: 'Sign 1 contract', go: 'inbox' },
      { label: 'Complete 1 task', go: 'plan' },
      { label: 'Submit 1 form', go: 'inbox' },
    ],
  },
  steps: null,
}

const ONBOARDING: RichDoc = {
  kind: 'rich',
  title: 'Onboarding',
  kicker: 'Welcome aboard',
  headline: 'Onboarding checklist',
  lede: 'Three steps before your studio opens. The team needs all of them in place before your first week goes live.',
  body: '',
  actions: null,
  steps: [
    { key: 'agreement', title: 'Sign Independent Contractor Agreement', hint: 'Review and sign it right here — two minutes.' },
    { key: 'contact', title: 'Fill out Contact Form', hint: 'How the team reaches you, and where.' },
    { key: 'intake', title: 'Fill out Model Intake Form', hint: 'The basics, so briefs fit you from day one.' },
  ],
}

const FAQ: RichDoc = {
  kind: 'rich',
  title: 'FAQ',
  kicker: 'Gosian Media LLC',
  headline: 'Frequently asked questions',
  lede: 'For new creators joining the agency. Below are the most common questions we get — if you don’t see yours here, message your account manager directly in the portal.',
  body: `## What does Gosian Media actually do for me?

We’re a full-service management agency for adult content creators. That means we handle the operational side of your business.

24/7 chatting on your platforms, content scheduling, sales strategy, fan retention, social media promotion, and platform optimization — so you can focus on creating content and living your life.

You stay the creator and the face of the brand. We run everything behind the scenes.

## How does the revenue split work?

Your split is laid out in your management agreement and depends on which services you’re enrolled in — full management vs. chatting-only, single platform vs. multi-platform, etc.

Gosian Media only earns when you earn. Our compensation is a percentage of your net revenue on the platforms we manage. There are no upfront fees, monthly retainers, or hidden charges.

## When and how do I pay you?

Invoices come through Whop, with all the usual payment options — just like checking out online.

All payments are in USD, in full. You’re responsible for paying on time.

| Pay period | Invoice arrives | Due |
| --- | --- | --- |
| 1st – 15th of the month | 16th of the same month | Within 5 business days |
| 16th – end of the month | 1st of the next month | Within 5 business days |

## Who’s chatting with my fans, and how do you keep my voice authentic?

Voice profile: your chatting team is one of our hand-trained, sourced, in-house teams — trained professionals with at least one year of chatting experience who have gone through a grueling vetting process to make sure they’re fit for the job.

The team works in shifts to give your fans true 24/7 engagement.

## What’s expected of me as the creator?

The short version: create content and stay reachable. We give you a content schedule tailored to your platforms — typically a mix of feed posts, PPV-ready content, social media content, and custom requests as they come in. We handle the rest.

Beyond content, the biggest thing is communication: respond to your account manager within a reasonable window when we need clarification on pricing, customs, or anything fan-facing. Creators who treat this like a real business see real business results.

## How does onboarding work, and how long does it take?

Timeline: 5–10 business days from signed agreement to fully live.

If you’re adamant about starting as quickly as possible, it can be done in 24–48 hours — but we prefer not to rush onboarding, so everyone is on the same page and we have everything we need on our side before starting.

## How does marketing and social media promotion work?

Promotion is handled by our marketing team and runs across SFW-friendly channels — primarily Twitter/X, Reddit, and Instagram, within platform rules. We schedule and post promotional content designed to drive traffic to your paid platforms.

The level of marketing support depends on your service tier. If you want a heavier social media push, talk to your account manager about our expanded marketing package.

## Is my content and account information secure?

Yes. Every team member — chatters, marketers, admins — operates under signed NDAs. Your platform credentials are stored in encrypted vaults, accessed only by the admins assigned to your account. Chatters don’t even have your account information — it must be an admin.

We use proxy and fingerprint management tools so your accounts stay clean and within platform terms of service.

Your content is stored in a private vault that only the team and you can access.

## What if I need to take a break, scale back, or leave?

We get it — creator burnout is real, and life happens. You can pause your account for personal reasons at any time with reasonable notice.

That’s also exactly why we exist: so you can take a break for whatever reason and know your account is in good hands. There are times when creators have their highest-earning weeks or months while they’re on break or vacation. Don’t sweat it too much — we all need a break occasionally, and we have your back through all of it.

## Still have questions?

Message your account manager directly through the portal, or email us:

casey@gosianmedia.com

blair@gosianmedia.com

evan@gosianmedia.com`,
  actions: null,
  steps: null,
}

const SOP: RichDoc = {
  kind: 'rich',
  title: 'Client SOP',
  kicker: 'Gosian Media LLC',
  headline: 'Client operating standards',
  lede: 'A plain-language guide to how a model works with us — derived directly from your signed Independent Contractor Agreement.',
  body: `> Your ICA is the legal contract. This is the operating version — what a smooth, well-run client → agent engagement looks like day to day. Follow this and the partnership runs the way it’s designed to: you keep producing content, we run the accounts, money moves on schedule, and nobody has to chase anybody.

If anything here conflicts with the ICA, the ICA wins. This is a guide — it is not a replacement for the contract you signed.

**At a glance**

- **Revenue split** — 50/50 after platform fees.
- **Pay periods** — 1st–15th and 16th–end of month.
- **Invoices** — Arrive the next day — paid within 5 business days.
- **Who can work** — All performers must be 18+.
- **To end it** — 30 days’ written notice.
- **After 12 months** — No hiring our staff, and we get first refusal on any non-OF platform work.

## 01 · Onboarding — what you give us on day one

Once the ICA is signed, you just need to supply us with what we need to start working. The faster this happens, the faster we get to gaining momentum.

### Hand over access

- Your email for the client portal, where you’ll complete your onboarding tasks.
- OnlyFans login credentials.
- Login credentials for any existing promotional social accounts we’ll be actively managing.

### Complete all onboarding tasks

Our client portal keeps everything about your working relationship with us in one place — it is built to be very user friendly.

### Acknowledge the ground rules

- You’re the custodian of records under 18 U.S.C. § 2257 for any sexually explicit content.
- You’ve reviewed and agreed to OnlyFans’ terms of service, community guidelines, and payout/tax requirements.
- You’re 18+, you have the legal capacity to sign the ICA, and everyone in your content is 18+. (This stuff is all a no-brainer.)

## 02 · Day-to-day operations

Once you’re set up, your job is to keep us supplied with content and stay out of the chatting and promo accounts we’re running. The whole point of working together is that you shouldn’t have to worry about the minutiae of your accounts every day anymore — we want you focused on being a great content creator. We handle the tedious work.

### What you do

- Deliver new content on whatever cadence we’ve agreed to.
- Content goes via Telegram or Content Snare, depending on volume. Bigger requests are reserved for Content Snare; quick voice notes, pics and customs usually come through Telegram — encrypted, safe sending.
- Respond to our team when we need a decision from you — rate changes, customs, special requests, brand calls. We interact near-daily with all of our clients; we are very communicative and very active.

### What you don’t do

- Don’t share your OnlyFans login with anyone else — friends, other managers, partners, no one.
- Don’t log in and chat with subscribers yourself unless we’ve coordinated it. Our team gets into a flow, and stepping in can cause confusion and lost sales.
- Don’t appoint another person or agency to co-manage the account while we’re actively engaged with you.
- Don’t change passwords or revoke our access mid-term — that’s a material breach of the ICA. We need notice, and any outstanding balance from what we generated before we were locked out is still due.

## 03 · Payments

Predictable invoicing, predictable payment. The schedule never changes.

| Pay period | Invoice arrives | Due |
| --- | --- | --- |
| 1st – 15th of the month | 16th of the same month | Within 5 business days |
| 16th – end of the month | 1st of the next month | Within 5 business days |

### How it works

- Invoices come through Whop. Many payment options available, just like checking out online. You’re responsible for paying on time.
- All payments are in USD, in full — no offsets or deductions other than required tax withholding.
- If you don’t have funds to cover the invoice, that’s not our risk. Services pause until the balance clears. We recommend paying yourself from the account bi-weekly or monthly so this never becomes an issue.

### Don’t initiate chargebacks

Every invoice represents money we already earned for you in the prior pay period.

> Chargebacks, payment reversals, and refund requests on our invoices are a material breach of the ICA. This is why we sign contracts — if we have to show proof of rendered services and our signed copies to our payment processor, we will. We don’t want to do that.

The unfortunate thing is that we’ve learned this the hard way by being generous to the wrong people, and as a result certain people have chosen to take advantage of our kindness. At the end of the day, we are trusting that you will pay your invoice on time.

> Side note: if something looks wrong on an invoice, tell us — we’ll fix it.

## 05 · Exclusivity & other platforms

While the ICA is active, we’re your only OnlyFans management agency. For everything else, we get the first shot.

### OnlyFans (and any accounts we created for you)

- We have exclusive management of your OnlyFans account, and ownership of any promotional accounts we directly create.
- Don’t bring in another agency, manager, or individual to work alongside us on these accounts.
- Promotional accounts we created (Reddit, X, Instagram, TikTok, etc.) stay with us when the engagement ends — we promptly delete your content and repurpose the account.

### Fansly, Telegram, anything else

Before you engage anyone else for management, promo, or chat services on any other monetization platform, we get a Right of First Refusal:

1. Send us a written notice describing the offer or the terms you’re considering.
2. We have 10 business days to accept or decline in writing.
3. If we decline — or don’t respond within 10 business days — you’re free to engage someone else.

> Practical version: if you’re thinking about expanding to Fansly or SP, or another platform, just message us. Don’t sign anything with anyone else first — the 10-day clock only starts once we have it in writing.

## 06 · Our team is off-limits

Our chatters, VAs, scouts, and ops managers are how we deliver the service. The ICA protects that team — during the engagement and for 12 months after it ends.

### You agree not to

- Hire, retain, or contract any chatter, VA, scout, ops manager, or other Gosian Media staff for similar work.
- Convince any of them to leave Gosian Media to work for you.
- Go around us and engage our staff directly for services that overlap with what we provide.

> Liquidated damages: per Section 4 of the ICA, breaching the non-solicit triggers liquidated damages of the greater of $10,000 per person or 12 months of your average monthly fees. This is not a penalty we want to enforce at all — it exists so the team can do its job without worrying about being poached.

## 07 · Using your content & results in our marketing

We don’t use your content, name, stats, screenshots, or results in any case study, pitch deck, social post, or marketing material without your prior written consent for that specific use. We keep all of our arrangements private unless the client has explicitly said it’s okay to share. This is usually just to prevent fans from finding out you’re managed — and also to protect you from any creator or agency trying to poach, scam, or contact you in a way that could compromise your privacy or security. We take that very seriously.

## 08 · Confidentiality goes both ways

We hold your information tightly. We expect the same on a few specific items.

### Keep these private

- The terms of the ICA — including the revenue split — are confidential.
- Don’t disclose that Gosian Media manages your accounts unless we’ve agreed you can.
- Don’t share internal communications, strategy, or anything we send you that isn’t meant for subscribers.

> Reminder: these confidentiality obligations survive termination — they don’t end when the engagement ends. Same on our side.

## 09 · How we communicate

### Day-to-day

Routine operational communication — check-ins, content notes, ideas and critiques, strategy questions, approval requests — all happens over Telegram in your group chat with us.

### Formal notices

Anything legally significant — termination notice, ROFR notice for another platform, permission revocations, breach notifications — needs to be in writing to the address or email we’ve designated for notices. A message in a group chat doesn’t count.

evan@gosianmedia.com

## 10 · If you want to end the engagement

The ICA is month-to-month with no fixed end date. You can leave for any reason or no reason — the only thing required is following the process so the handoff is clean.

### The process

1. Send us 14 days’ written notice. No explanation required.
2. During the 14 days you keep cooperating — content keeps flowing, we keep managing the account, and the revenue split still applies to anything earned in that window.
3. On or right after the termination date, change the passwords on the managed accounts to cut our access.
4. Pay any outstanding invoices and any revenue share earned through the termination date.

### What stays with us after termination

- Any promotional accounts we created during the engagement (Reddit, X, Instagram, TikTok, etc.), including their followers, subscribers, and engagement data.
- Internal business records we’re required to keep.

### What stays with you

- Your OnlyFans account, including all subscribers.
- Your personal social media accounts that existed before the engagement.
- All of your content. We license it for the duration of the engagement; that license ends with the agreement. All content, forms and files are removed from our database — minus a copy of the terminated contract.

### What carries forward for 12 months

- Right of First Refusal on other platforms (Fansly, Telegram, etc.).
- No hiring or soliciting our staff — chatters, VAs, scouts, ops managers, or anyone else on the team.
- Confidentiality on the ICA terms, our partnership, and anything sensitive you learned during the engagement.

## 11 · The one-sentence version

> Send us good content, let us run the accounts, pay the invoices on time, keep our staff and our partnership confidential, and give us first refusal on anything beyond OnlyFans — and we’ll keep working very hard for you.

> Questions: if anything in this document is unclear or conflicts with what you understood when you signed the ICA, message us before acting on it. The ICA is the controlling document — we’d rather clarify in advance than untangle later.`,
  actions: null,
  steps: null,
}

const EXPECTATIONS: RichDoc = {
  kind: 'rich',
  title: 'Expectations',
  kicker: 'The deal',
  headline: 'What good looks like',
  lede: 'A walkthrough of both sides of the deal — what the team needs from you, and what you can hold the team to.',
  body: 'The full walkthrough lands here shortly. Until then, the Client SOP and the FAQ cover both sides of the deal.',
  actions: null,
  steps: null,
}

const AGREEMENT: RichDoc = {
  kind: 'rich',
  title: 'Independent Contractor Agreement',
  kicker: 'Gosian Media LLC',
  headline: 'Independent Contractor Agreement',
  lede: '',
  body: INDEPENDENT_CONTRACTOR_AGREEMENT_BODY,
  actions: null,
  steps: null,
}

export const APP_CONTENT_DEFAULTS: Record<AppContentKey, AppDoc> = {
  welcome: WELCOME,
  onboarding: ONBOARDING,
  faq: FAQ,
  sop: SOP,
  expectations: EXPECTATIONS,
  agreement: AGREEMENT,
}

/** A deep copy, so a caller can hand a default to a phone or an editor
 *  without anything downstream being able to mutate the shipped copy. */
export function defaultDoc(key: AppContentKey): AppDoc {
  return JSON.parse(JSON.stringify(APP_CONTENT_DEFAULTS[key])) as AppDoc
}

/** Recognize the old shipped agreement if an earlier console edit saved it. */
export function isLegacyTalentManagementAgreement(doc: AppDoc): boolean {
  return (
    doc.body.startsWith('## 1 · Parties\n\n') &&
    doc.body.includes('## 10 · Electronic signature') &&
    doc.body.includes('Net revenue earned from the managed platforms is shared 70% to the Talent and 30% to the Company.')
  )
}

/** Update the old checklist label in any saved onboarding content. */
export function normalizeLegacyOnboardingAgreementTitle(doc: AppDoc): AppDoc {
  if (!doc.steps) return doc
  const nextTitle = APP_CONTENT_DEFAULTS.onboarding.steps?.find((step) => step.key === 'agreement')?.title
  if (!nextTitle) return doc

  let changed = false
  const steps = doc.steps.map((step) => {
    if (step.key !== 'agreement' || step.title !== 'Sign Talent Management Agreement') return step
    changed = true
    return { ...step, title: nextTitle }
  })
  return changed ? { ...doc, steps } : doc
}

export function isAppContentKey(value: unknown): value is AppContentKey {
  return typeof value === 'string' && (APP_CONTENT_KEYS as readonly string[]).includes(value)
}

// ----------------------------------------------------------------- normalize

const MAX_HEAD = 300
const MAX_LEDE = 4000
/** The SOP runs about 9 KB; a generous ceiling that still stops a runaway
 *  paste from landing in the table. */
const MAX_BODY = 120_000

function text(value: unknown, max = MAX_LEDE): string {
  return typeof value === 'string' ? value.replace(/\r\n/g, '\n').trim().slice(0, max) : ''
}

function normalizeActions(value: unknown): RichDoc['actions'] {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  const items = (Array.isArray(raw.items) ? raw.items : [])
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
    .slice(0, 4)
    .map((item) => ({
      label: text(item.label, 120),
      go: (item.go === 'plan' ? 'plan' : 'inbox') as 'inbox' | 'plan',
    }))
    .filter((item) => item.label)
  if (items.length === 0) return null
  return { label: text(raw.label, 200), items }
}

function normalizeSteps(value: unknown): RichDoc['steps'] {
  if (!Array.isArray(value)) return null
  const seen = new Set<StepKey>()
  const steps = value
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
    .slice(0, 6)
    .map((item) => ({
      key: (item.key === 'contact' || item.key === 'intake' ? item.key : 'agreement') as StepKey,
      title: text(item.title, 200),
      hint: text(item.hint, 300),
    }))
    .filter((item) => item.title)
    // One row per form — two rows on the same target would tick together.
    .filter((item) => (seen.has(item.key) ? false : (seen.add(item.key), true)))
  return steps.length ? steps : null
}

/**
 * Take whatever arrived from the console (or a database row written by an
 * older build) and return a document that is safe to render on a phone:
 * every string a bounded string, every list bounded. Null when the shape is
 * not a document at all — an unreadable row falls back to the built-in copy
 * rather than 500-ing the app's read.
 */
export function normalizeDoc(key: AppContentKey, raw: unknown): AppDoc | null {
  if (!raw || typeof raw !== 'object') return null
  const value = raw as Record<string, unknown>
  if (value.kind !== 'rich') return null
  const doc: RichDoc = {
    kind: 'rich',
    title: text(value.title, 120),
    kicker: text(value.kicker, 120),
    headline: text(value.headline, MAX_HEAD),
    lede: text(value.lede, MAX_LEDE),
    body: text(value.body, MAX_BODY),
    actions: key === 'welcome' ? normalizeActions(value.actions) : null,
    steps: key === 'onboarding' ? normalizeSteps(value.steps) : null,
  }
  if (!doc.title) return null
  return doc
}
