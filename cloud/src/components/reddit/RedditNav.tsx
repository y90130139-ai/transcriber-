'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

/** The section's secondary navigation — plain text tabs on a hairline,
 *  the active one held by an ember underline. */
const PAGES = [
  { href: '/reddit-trends', label: 'Overview' },
  { href: '/reddit-trends/trending', label: 'Trending Now' },
  { href: '/reddit-trends/topics', label: 'Topics' },
  { href: '/reddit-trends/posts', label: 'Posts' },
  { href: '/reddit-trends/subreddits', label: 'Subreddits' },
  { href: '/reddit-trends/requirements', label: 'Requirements' },
  { href: '/reddit-trends/search', label: 'Search' },
  { href: '/reddit-trends/dataset', label: 'Dataset' },
  { href: '/reddit-trends/health', label: 'Health' },
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
