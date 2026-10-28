/**
 * Page permissions (Geno, 2026-10-18).
 *
 * The team table lives in Supabase and the ai-invoice dashboard owns it —
 * members, roles, and the `page_permissions` JSONB. This file is the
 * transcriber's half: the page catalog, the resolution rules, and the pure
 * decisions every door reads (docs/PERMISSIONS.md).
 *
 * The shape, in the same words the dashboard already uses:
 *
 *   page_permissions = {
 *     transcriber: 'read',             // the door AND the default level
 *     'transcriber.models': 'edit',    // per-page override; absence = inherit
 *   }
 *
 * `none | read | edit` (`read` renders as "View"). ceo/admin always get
 * everything, never from this table. A member's master resolves to View
 * everywhere — except Scheduler and Client, which are restricted and only
 * open when granted by name (see RESTRICTED_PAGE_KEYS).
 *
 * Client-safe on purpose: the rail, the page gate and the API guard all
 * read the same functions, so the menu can never claim access the server
 * would refuse.
 */

export type AccessLevel = 'none' | 'read' | 'edit'

export const ACCESS_LEVELS: AccessLevel[] = ['none', 'read', 'edit']

/** The key the dashboard already writes for this app. */
export const TRANSCRIBER_KEY = 'transcriber'

export type PageDef = {
  key: string
  label: string
  href: string
  /** The rail's own grouping, for the permission editor. */
  group: string
}

/** Every grantable page, in the rail's own order — `PAGES` is also the
 *  first-allowed-page walk, so the order here is the post-login landing
 *  order. Keys are stable slugs; hrefs may move. */
export const PAGES: PageDef[] = [
  { key: 'overview', label: 'Overview', href: '/', group: 'Workspace' },
  { key: 'library', label: 'Media Library', href: '/library', group: 'Workspace' },
  { key: 'queue', label: 'Processing Queue', href: '/queue', group: 'Workspace' },
  { key: 'templates', label: 'Templates', href: '/templates', group: 'Workspace' },

  { key: 'studio_effects', label: 'Studio · Effects', href: '/video-batcher/effects', group: 'Studio' },
  { key: 'studio_captions', label: 'Studio · Captions', href: '/video-batcher/captions', group: 'Studio' },
  { key: 'studio_audio', label: 'Studio · Audio', href: '/video-batcher/audio', group: 'Studio' },
  { key: 'studio_metadata', label: 'Studio · Metadata', href: '/video-batcher/metadata', group: 'Studio' },
  { key: 'studio_watermark', label: 'Studio · Watermark', href: '/video-batcher/watermark', group: 'Studio' },
  { key: 'studio_converter', label: 'Studio · Converter', href: '/video-batcher/converter', group: 'Studio' },
  { key: 'studio_compressor', label: 'Studio · Compressor', href: '/video-batcher/compressor', group: 'Studio' },
  { key: 'studio_downloads', label: 'Studio · Downloads', href: '/video-batcher/downloads', group: 'Studio' },

  { key: 'trends', label: 'Trends', href: '/trends', group: 'Research' },
  { key: 'reddit_trends', label: 'Reddit Trends', href: '/reddit-trends', group: 'Research' },
  { key: 'sounds', label: 'Trending Sounds', href: '/sounds', group: 'Research' },

  { key: 'funnel', label: 'Funnel', href: '/funnel', group: 'Creators' },
  { key: 'models', label: 'Models', href: '/models', group: 'Creators' },
  { key: 'creators', label: 'Creators', href: '/creators', group: 'Creators' },
  { key: 'watchlists', label: 'Watchlists', href: '/watchlist', group: 'Creators' },

  { key: 'instagram', label: 'Instagram', href: '/instagram', group: 'Social Accounts' },
  { key: 'tiktok', label: 'TikTok', href: '/tiktok', group: 'Social Accounts' },
  { key: 'twitter', label: 'Twitter / X', href: '/twitter', group: 'Social Accounts' },

  { key: 'today', label: 'Today', href: '/today', group: 'Team' },
  { key: 'week', label: 'This Week', href: '/week', group: 'Team' },

  { key: 'app_accounts', label: 'App Accounts', href: '/app-accounts', group: 'Client' },
  { key: 'inbox', label: 'Inbox', href: '/inbox', group: 'Client' },

  { key: 'content_welcome', label: 'Welcome', href: '/app-content/welcome', group: 'App Content' },
  { key: 'content_onboarding', label: 'Onboarding', href: '/app-content/onboarding', group: 'App Content' },
  { key: 'content_faq', label: 'FAQ', href: '/app-content/faq', group: 'App Content' },
  { key: 'content_sop', label: 'Client SOP', href: '/app-content/sop', group: 'App Content' },
  { key: 'content_expectations', label: 'Expectations', href: '/app-content/expectations', group: 'App Content' },
  { key: 'content_agreement', label: 'Agreement', href: '/app-content/agreement', group: 'App Content' },

  { key: 'scheduler_overview', label: 'Scheduler · Overview', href: '/scheduler/overview', group: 'Scheduler' },
  { key: 'scheduler_calendar', label: 'Scheduler · Calendar', href: '/scheduler', group: 'Scheduler' },
  { key: 'scheduler_new', label: 'Scheduler · New post', href: '/scheduler/new', group: 'Scheduler' },
  { key: 'scheduler_accounts', label: 'Scheduler · Accounts', href: '/scheduler/accounts', group: 'Scheduler' },

  { key: 'settings', label: 'Settings', href: '/settings', group: 'Console' },
]

export const PAGE_BY_KEY = new Map(PAGES.map((page) => [page.key, page]))

/** The rail's order, longest first — the prefix walk reads this once. */
const BY_HREF_LENGTH = [...PAGES].sort((a, b) => b.href.length - a.href.length)

const STUDIO_KEYS = PAGES.filter((page) => page.group === 'Studio').map((page) => page.key)
const CONTENT_KEYS = PAGES.filter((page) => page.group === 'App Content').map((page) => page.key)
const SCHEDULER_KEYS = PAGES.filter((page) => page.group === 'Scheduler').map((page) => page.key)
const PLATFORM_KEYS = ['instagram', 'tiktok', 'twitter']

/**
 * The restricted sections (2026-10-18): Scheduler and Client are kept for the
 * admin and CEO by default. A master grant does NOT open them — they are
 * granted one by one, by name, from the ai-invoice invitation UI (explicit
 * `transcriber.<key>` overrides). Absence means "off", never "inherit".
 */
export const RESTRICTED_PAGE_KEYS = PAGES
  .filter((page) => page.group === 'Scheduler' || page.group === 'Client')
  .map((page) => page.key)
export const RESTRICTED_PAGE_KEY_SET = new Set(RESTRICTED_PAGE_KEYS)
export const isRestrictedPage = (key: string) => RESTRICTED_PAGE_KEY_SET.has(key)

export function isElevated(role: unknown): boolean {
  const value = String(role ?? '').toLowerCase()
  return value === 'ceo' || value === 'admin'
}

function isLevel(value: unknown): value is AccessLevel {
  return value === 'none' || value === 'read' || value === 'edit'
}

const asMap = (raw: unknown): Record<string, unknown> =>
  raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}

/**
 * May this member use the console at all? True when the door is open, when
 * any single page is granted (door `none` + one override is a real setup),
 * or when the role is elevated.
 */
export function hasAppAccess(raw: unknown, role: unknown): boolean {
  if (isElevated(role)) return true
  const map = asMap(raw)
  const door = map[TRANSCRIBER_KEY]
  if (isLevel(door) && door !== 'none') return true
  for (const page of PAGES) {
    const override = map[`${TRANSCRIBER_KEY}.${page.key}`]
    if (isLevel(override) && override !== 'none') return true
  }
  return false
}

/**
 * The effective level for every page — resolved once, at sign-in, and
 * carried in the session. Overrides win; everything else inherits the door —
 * except the restricted sections (Scheduler, Client), which stay closed
 * unless granted by name. ceo/admin skip all of this above.
 */
export function resolvePermissions(raw: unknown, role: unknown): Record<string, AccessLevel> {
  if (isElevated(role)) {
    return Object.fromEntries(PAGES.map((page) => [page.key, 'edit' as AccessLevel]))
  }
  const map = asMap(raw)
  const door = isLevel(map[TRANSCRIBER_KEY]) ? (map[TRANSCRIBER_KEY] as AccessLevel) : 'none'
  return Object.fromEntries(PAGES.map((page) => {
    const override = map[`${TRANSCRIBER_KEY}.${page.key}`]
    if (isLevel(override)) return [page.key, override]
    if (isRestrictedPage(page.key)) return [page.key, 'none' as AccessLevel]
    return [page.key, door]
  }))
}

/** Keep only levels the catalog knows — used to re-validate a session map. */
export function sanitizePermissions(raw: unknown): Record<string, AccessLevel> {
  const map = asMap(raw)
  const out: Record<string, AccessLevel> = {}
  for (const page of PAGES) {
    const level = map[page.key]
    out[page.key] = isLevel(level) ? level : 'none'
  }
  return out
}

export function levelOf(permissions: Record<string, AccessLevel> | null | undefined, key: string | null): AccessLevel {
  if (!key) return 'none'
  const level = permissions?.[key]
  return level === 'read' || level === 'edit' ? level : 'none'
}

export const canView = (permissions: Record<string, AccessLevel> | null | undefined, key: string | null) =>
  levelOf(permissions, key) !== 'none'

export const canEdit = (permissions: Record<string, AccessLevel> | null | undefined, key: string | null) =>
  levelOf(permissions, key) === 'edit'

export const anyView = (permissions: Record<string, AccessLevel> | null | undefined) =>
  PAGES.some((page) => canView(permissions, page.key))

export const anyEdit = (permissions: Record<string, AccessLevel> | null | undefined) =>
  PAGES.some((page) => canEdit(permissions, page.key))

/** The page a console path belongs to — longest href wins, `/` is Overview. */
export function pageForPath(pathname: string | null | undefined): string | null {
  if (!pathname) return null
  let path = String(pathname).split(/[?#]/)[0]
  if (!path.startsWith('/')) path = `/${path}`
  if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1)
  for (const page of BY_HREF_LENGTH) {
    if (page.href === '/') continue
    if (path === page.href || path.startsWith(`${page.href}/`)) return page.key
  }
  if (path === '/') return 'overview'
  return null
}

/** Where a member lands after sign-in (or when a page refuses them). */
export function firstAllowedPath(permissions: Record<string, AccessLevel> | null | undefined): string | null {
  for (const page of PAGES) {
    if (canView(permissions, page.key)) return page.href
  }
  return null
}

/** The page key for one App Content document ('faq' → 'content_faq'). */
export const contentPageKey = (key: string) => `content_${key}`

/* --------------------------------------------------------------- the APIs
   Every console API maps to the page that owns it. Routers shared by a few
   pages (links, uploads, sweep) name them all — any one grants the call.
   No rule means "any page": still strictly stronger than signed-in-only, and
   it is what the genuinely global helpers (nav-assistant) rely on. Worker,
   bot, cron, plan-token and the model app carry their own auth and never
   reach these rules (docs/PERMISSIONS.md). */

export type ApiRule = { prefix: string; page?: string; any?: string[] }

export const API_RULES: ApiRule[] = [
  { prefix: '/api/app-accounts', page: 'app_accounts' },
  { prefix: '/api/app-content', any: CONTENT_KEYS },

  { prefix: '/api/analytics', page: 'overview' },
  { prefix: '/api/dashboard', page: 'overview' },
  { prefix: '/api/digest', any: ['overview', 'today'] },

  { prefix: '/api/batcher', any: STUDIO_KEYS },
  { prefix: '/api/video-batcher', any: STUDIO_KEYS },

  { prefix: '/api/bundle', page: 'library' },
  { prefix: '/api/creators', page: 'creators' },
  { prefix: '/api/dm', page: 'models' },
  { prefix: '/api/earnings', any: ['watchlists', 'models', 'overview'] },
  { prefix: '/api/editors', page: 'models' },
  { prefix: '/api/formats', page: 'library' },
  { prefix: '/api/inbox', page: 'inbox' },
  { prefix: '/api/items', page: 'library' },
  { prefix: '/api/library', page: 'library' },
  { prefix: '/api/links', any: ['models', 'queue', 'library', 'today', 'week'] },
  { prefix: '/api/models', page: 'models' },
  { prefix: '/api/ofmpro', any: [...PLATFORM_KEYS, 'library', 'models'] },
  { prefix: '/api/plans', page: 'models' },
  { prefix: '/api/reels', page: 'models' },
  { prefix: '/api/reddit', page: 'reddit_trends' },
  { prefix: '/api/retag', page: 'library' },
  { prefix: '/api/scheduler/posts', page: 'scheduler_calendar' },
  { prefix: '/api/scheduler/accounts', page: 'scheduler_accounts' },
  { prefix: '/api/scheduler', any: SCHEDULER_KEYS },
  { prefix: '/api/scout', any: ['creators', 'watchlists', 'today'] },
  { prefix: '/api/sounds', page: 'sounds' },
  { prefix: '/api/standing', page: 'models' },
  { prefix: '/api/sweep', any: ['models', 'today', 'week'] },
  { prefix: '/api/templates', page: 'templates' },
  { prefix: '/api/trends', page: 'trends' },
  { prefix: '/api/uploads', any: ['queue', 'library'] },
]

const RULES_BY_PREFIX_LENGTH = [...API_RULES].sort((a, b) => b.prefix.length - a.prefix.length)

export function apiRuleFor(pathname: string): ApiRule | null {
  for (const rule of RULES_BY_PREFIX_LENGTH) {
    if (pathname === rule.prefix || pathname.startsWith(`${rule.prefix}/`)) return rule
  }
  return null
}

export type AccessDecision =
  | { ok: true }
  /** Refused: the page (or reason) worth naming in the log/response. */
  | { ok: false; page: string | null; need: 'read' | 'edit' }

function decide(
  permissions: Record<string, AccessLevel> | null | undefined,
  target: { page?: string; any?: string[] } | null,
  need: 'read' | 'edit',
): AccessDecision {
  const passes = (key: string) => (need === 'edit' ? canEdit(permissions, key) : canView(permissions, key))
  if (target?.page) {
    return passes(target.page) ? { ok: true } : { ok: false, page: target.page, need }
  }
  if (target?.any) {
    return target.any.some(passes) ? { ok: true } : { ok: false, page: target.any[0] ?? null, need }
  }
  const global = need === 'edit' ? anyEdit(permissions) : anyView(permissions)
  return global ? { ok: true } : { ok: false, page: null, need }
}

/** Reads need View; anything that changes something needs Edit. */
export function decideApi(
  pathname: string,
  method: string,
  permissions: Record<string, AccessLevel> | null | undefined,
): AccessDecision {
  const need = method === 'GET' || method === 'HEAD' || method === 'OPTIONS' ? 'read' : 'edit'
  return decide(permissions, apiRuleFor(pathname), need)
}

/** The page gate: View on the page that owns this console path. */
export function decidePath(
  pathname: string,
  permissions: Record<string, AccessLevel> | null | undefined,
): AccessDecision {
  const key = pageForPath(pathname)
  if (!key) return { ok: true }
  return decide(permissions, { page: key }, 'read')
}
