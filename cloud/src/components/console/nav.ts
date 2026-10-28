import type { Platform } from '@/lib/socials'
import type { IconName } from './ConsoleIcons'

/** The console's navigation, in its 2026-10-13 shape (Geno's mock): the
 *  Gosian mark on top, one search box under it, then flat sections — every
 *  page listed at once, its icon riding its label — and Settings pinned at
 *  the foot of the list.
 *
 *  Split into two sides (Geno, 2026-10-13): Marketing — the content machine
 *  and the model roster — and Client, the app-facing side (invites, app
 *  accounts, inbox, the daily sweep). The switch under the mark swaps the
 *  list; the search palette and the AI assistant still reach every page on
 *  both.
 *
 *  The data lives here rather than in ConsoleShell so the search palette
 *  reads the very same catalog the rail draws (2026-10-13). */
export type NavLeaf = { href: string; label: string; icon?: IconName; mark?: Platform }
export type NavSection = { id: string; label: string; items: NavLeaf[] }
export type NavTabId = 'marketing' | 'client' | 'scheduler'
export type NavTab = {
  id: NavTabId
  label: string
  /** The switcher menu's one-line why (Geno, 2026-10-13). */
  note: string
  home: string
  sections: NavSection[]
}

export const TABS: NavTab[] = [
  {
    id: 'marketing', label: 'Marketing', note: 'Research, transcribe and batch content', home: '/',
    sections: [
      {
        id: 'workspace', label: 'Workspace',
        items: [
          { href: '/', label: 'Overview', icon: 'home' },
          { href: '/library', label: 'Media Library', icon: 'layers' },
          { href: '/queue', label: 'Processing Queue', icon: 'list' },
          { href: '/templates', label: 'Templates', icon: 'copy' },
        ],
      },
      {
        id: 'studio', label: 'Studio',
        /* The Video Batcher's tools, each its own page under /video-batcher, so
           the batcher's shell keeps its files and queue while you move between
           them (Geno, 2026-10-12). */
        items: [
          { href: '/video-batcher/effects', label: 'Effects', icon: 'sliders' },
          { href: '/video-batcher/captions', label: 'Captions', icon: 'type' },
          { href: '/video-batcher/audio', label: 'Audio', icon: 'music' },
          { href: '/video-batcher/metadata', label: 'Metadata', icon: 'tag' },
          { href: '/video-batcher/watermark', label: 'Watermark', icon: 'image' },
          { href: '/video-batcher/converter', label: 'Converter', icon: 'refresh' },
          { href: '/video-batcher/compressor', label: 'Compressor', icon: 'compress' },
          { href: '/video-batcher/downloads', label: 'Downloads', icon: 'download' },
        ],
      },
      {
        id: 'research', label: 'Research',
        items: [
          { href: '/trends', label: 'Trends', icon: 'trending' },
          { href: '/reddit-trends', label: 'Reddit Trends', icon: 'reddit' },
          { href: '/sounds', label: 'Trending Sounds', icon: 'sound' },
        ],
      },
      {
        id: 'creators', label: 'Creator Management',
        items: [
          // First in the section on purpose: it is the page that says what to
          // do today, and the others are reference beside it.
          { href: '/funnel', label: 'Funnel', icon: 'trending' },
          { href: '/models', label: 'Models', icon: 'userCheck' },
          { href: '/creators', label: 'Creators', icon: 'users' },
          { href: '/watchlist', label: 'Watchlists', icon: 'eye' },
        ],
      },
      {
        id: 'accounts', label: 'Social Accounts',
        /* The platforms wear their own marks, the way the top bar's chips do. */
        items: [
          { href: '/instagram', label: 'Instagram', mark: 'instagram' },
          { href: '/tiktok', label: 'TikTok', mark: 'tiktok' },
          { href: '/twitter', label: 'Twitter / X', mark: 'x' },
        ],
      },
      {
        id: 'team', label: 'Team',
        items: [
          /* Today is the ops desk's morning read — a marketing-side page
             (Geno, 2026-10-14), it used to sit on the client side. */
          { href: '/today', label: 'Today', icon: 'calendarCheck' },
          { href: '/week', label: 'This Week', icon: 'calendar' },
        ],
      },
    ],
  },
  {
    id: 'client', label: 'Client', note: 'Invites, app accounts, app content and inbox', home: '/app-accounts',
    sections: [
      {
        id: 'clients', label: 'Clients',
        items: [
          { href: '/app-accounts', label: 'App Accounts', icon: 'checkCircle' },
          { href: '/inbox', label: 'Inbox', icon: 'chat' },
        ],
      },
      {
        id: 'app', label: 'App Content',
        /* One page per document she reads — the FAQ, the onboarding text,
           the SOP — each edited here and read by the app at runtime
           (Geno, 2026-10-14). */
        items: [
          { href: '/app-content/welcome', label: 'Welcome', icon: 'home' },
          { href: '/app-content/onboarding', label: 'Onboarding', icon: 'checkCircle' },
          { href: '/app-content/faq', label: 'FAQ', icon: 'chat' },
          { href: '/app-content/sop', label: 'Client SOP', icon: 'type' },
          { href: '/app-content/expectations', label: 'Expectations', icon: 'play' },
          { href: '/app-content/agreement', label: 'Agreement', icon: 'copy' },
        ],
      },
    ],
  },
  {
    id: 'scheduler', label: 'Scheduler', note: 'Plan, compose and publish across the socials', home: '/scheduler/overview',
    sections: [
      {
        id: 'plan', label: 'Plan',
        /* The workspace at a glance, then the week it runs on — the
           overview reads Autoposter, the calendar works it, the composer
           writes to it (Geno, 2026-10-14). */
        items: [
          { href: '/scheduler/overview', label: 'Overview', icon: 'home' },
          { href: '/scheduler', label: 'Calendar', icon: 'calendar' },
          { href: '/scheduler/new', label: 'New post', icon: 'plus' },
        ],
      },
      {
        id: 'setup', label: 'Setup',
        items: [
          { href: '/scheduler/accounts', label: 'Social Accounts', icon: 'users' },
        ],
      },
    ],
  },
]

/** Every section, every side — the search palette and the nav assistant read
 *  this one catalog, so nothing is ever hidden from ⌘K (2026-10-13). */
export const SECTIONS: NavSection[] = TABS.flatMap((tab) => tab.sections)

/** Settings pins itself below the sections; the palette searches it too. */
export const SETTINGS_LEAF: NavLeaf = { href: '/settings', label: 'Settings', icon: 'settings' }

/** The label the top bar's crumb wears for each route. */
export const LABELS: Record<string, string> = {}
for (const section of SECTIONS) for (const item of section.items) LABELS[item.href] = item.label
LABELS[SETTINGS_LEAF.href] = SETTINGS_LEAF.label

/** Whether a rail row is where you are. Section pages (a platform, Reddit
 *  Trends) light their row up for every page under them; "/" is itself only. */
export function isOn(href: string, pathname: string): boolean {
  if (href === '/') return pathname === '/'
  return pathname === href || pathname.startsWith(`${href}/`)
}

/** Which side of the rail owns a route; null for pages outside them all
 *  (Settings pins at the foot whichever side is up). */
export function tabOf(pathname: string): NavTabId | null {
  for (const tab of TABS) {
    for (const section of tab.sections) {
      for (const item of section.items) {
        if (isOn(item.href, pathname)) return tab.id
      }
    }
  }
  return null
}
