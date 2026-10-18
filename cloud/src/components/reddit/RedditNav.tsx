'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

/** The section's secondary navigation — plain text tabs on a hairline,
 *  the active one held by an ember underline. Geno, 2026-10-18: three tabs
 *  and nothing else. Trending Now and Topics boards are no longer listed;
 *  topic detail pages stay reachable from the Today board, which is where
 *  the topics are actually read. */
const PAGES = [
  { href: '/reddit-trends', label: 'Today' },
  { href: '/reddit-trends/posts', label: 'Posts' },
  { href: '/reddit-trends/subreddits', label: 'Subreddits' },
]

export default function RedditNav() {
  const pathname = usePathname()
  return (
    <nav className="rt-tabs" aria-label="Reddit Trends sections">
      {PAGES.map((page) => {
        const on = page.href === '/reddit-trends' ? pathname === page.href : pathname.startsWith(page.href)
        return (
          <Link key={page.href} href={page.href} className="rt-tab" data-on={on}
            aria-current={on ? 'page' : undefined}>
            {page.label}
          </Link>
        )
      })}
    </nav>
  )
}
