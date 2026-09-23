'use client'

import { useEffect, useState } from 'react'

/**
 * Sun or moon, her call.
 *
 * Until 2026-09-23 the plan followed `prefers-color-scheme` and nothing else,
 * so a model whose phone is set to light could never have the dark plan and a
 * model whose phone is dark could never have the bone one. The palette was
 * already built for both; only the choice was missing.
 *
 * What is written is the resolved theme, always — `light` or `dark`, never
 * `system`. The inline script in the page has already resolved it before first
 * paint, so this component's only job is to flip it and remember.
 */
const KEY = 'sinaura-theme'

export type Theme = 'light' | 'dark'

/** What the page painted with, read off the element the script set. */
function current(): Theme {
  if (typeof document === 'undefined') return 'light'
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'
}

export default function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>('light')

  // Mount, not render: the server has no idea which theme her phone resolved
  // to, so rendering from it would mismatch and React would blow the markup
  // away. The button reads its state from the DOM once it is on her screen.
  useEffect(() => { setTheme(current()) }, [])

  function flip() {
    const next: Theme = current() === 'dark' ? 'light' : 'dark'
    document.documentElement.dataset.theme = next
    setTheme(next)
    // Her phone, her preference — it never leaves it. A blocked or full store
    // costs her the memory of the choice, never the choice itself.
    try { window.localStorage.setItem(KEY, next) } catch { /* private mode */ }
  }

  const dark = theme === 'dark'
  return (
    <button
      type="button"
      className="plan-theme"
      onClick={flip}
      aria-pressed={dark}
      aria-label={dark ? 'Switch to light' : 'Switch to dark'}
      title={dark ? 'Light' : 'Dark'}
    >
      {dark ? (
        // Moon: what she is in. Tapping it takes her to the sun.
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor"
             strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M21 12.8A9 9 0 0 1 11.2 3a7 7 0 1 0 9.8 9.8z" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor"
             strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4" />
        </svg>
      )}
    </button>
  )
}

/**
 * The script that runs before the page paints.
 *
 * A theme applied from React lands one frame late, which on a dark phone is a
 * flash of cream at 6am — the exact thing that makes a page feel cheap. This
 * is a fixed string with nothing interpolated into it: it reads her stored
 * choice, falls back to what her phone asks for, and writes the answer onto
 * <html> before the first paint.
 */
export const THEME_SCRIPT = `(function(){try{
var k=localStorage.getItem('${KEY}');
var d=k==='dark'||k==='light'?k:(window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');
document.documentElement.dataset.theme=d;
}catch(e){document.documentElement.dataset.theme='light';}})();`
