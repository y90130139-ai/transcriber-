'use client'

import { usePathname, useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import PlatformIcon from '../roster/PlatformIcon'
import { Icon } from './ConsoleIcons'
import { SECTIONS, SETTINGS_LEAF, type NavLeaf } from './nav'

/** The rail's search (Geno, 2026-10-13): the ai-invoice sidebar's find — a
 *  trigger wearing the ⌘K chip that opens an anchored palette over the
 *  console's pages. Ask it anything ("where do I fix captions") and the
 *  first row is the AI routing you there (/api/nav-assistant); the rows
 *  under it are the plain matches. ⌘K / Ctrl+K toggles it from anywhere,
 *  arrows pick, Enter lands, Escape or a click outside closes. */

const CLOSE_MS = 340
const SUGGESTION_COUNT = 5
const RESULT_COUNT = 8
/** Below this the assistant is not asked — one letter dreams up anything. */
const AI_MIN_CHARS = 2

type Page = NavLeaf & { section: string }
type Suggestion = { href: string; label: string; subtitle: string }

/** Every page the palette can reach: the sections, then Settings. */
const PAGES: Page[] = [
  ...SECTIONS.flatMap((section) => section.items.map((item) => ({ ...item, section: section.label }))),
  { ...SETTINGS_LEAF, section: 'Console' },
]

function pickRandom(count: number): Page[] {
  const pool = [...PAGES]
  for (let i = pool.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[pool[i], pool[j]] = [pool[j], pool[i]]
  }
  return pool.slice(0, count)
}

/** Label hits first, then section hits; stable and small. */
function rank(page: Page, needle: string): number {
  const label = page.label.toLowerCase()
  if (label.startsWith(needle)) return 0
  if (label.includes(needle)) return 1
  if (page.section.toLowerCase().includes(needle)) return 2
  return page.href.includes(needle) ? 3 : -1
}

export default function NavSearch() {
  const router = useRouter()
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [highlight, setHighlight] = useState(0)
  const [mounted, setMounted] = useState(false)
  const [visible, setVisible] = useState(false)
  const [suggestions, setSuggestions] = useState<Page[]>([])
  const [anchor, setAnchor] = useState({ top: 68, left: 12, width: 188, height: 38 })
  /** The AI's pick for the current query; null while thinking or unasked. */
  const [aiSuggestion, setAiSuggestion] = useState<Suggestion | null>(null)
  const [aiLoading, setAiLoading] = useState(false)
  /** The shortcut chip says what the reader's keyboard actually has. */
  const [mac, setMac] = useState(true)
  const inputRef = useRef<HTMLInputElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!/Mac|iPhone|iPad/.test(navigator.platform)) setMac(false)
  }, [])

  const trimmed = query.trim()
  const hasQuery = trimmed.length > 0
  const results = useMemo(() => {
    if (!hasQuery) return []
    const needle = trimmed.toLowerCase()
    return PAGES
      .map((page) => ({ page, score: rank(page, needle) }))
      .filter((row) => row.score >= 0)
      .sort((a, b) => a.score - b.score || a.page.label.localeCompare(b.page.label))
      .slice(0, RESULT_COUNT)
      .map((row) => row.page)
  }, [trimmed, hasQuery])
  const rows = hasQuery ? results : suggestions
  const showAiRow = hasQuery
  const cardMode = hasQuery ? 'has-results' : 'has-suggestions'
  /** Rows count the AI row first when there is a query. */
  const selectable = rows.length + (showAiRow ? 1 : 0)

  const updateAnchor = useCallback(() => {
    const el = triggerRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    setAnchor({
      top: Math.max(8, rect.top),
      left: Math.max(8, rect.left),
      width: Math.max(rect.width, 160),
      height: Math.max(rect.height, 28),
    })
  }, [])

  // Open: measure the trigger, mount the card, then let it grow in a frame
  // later so the size transition has an origin. Closed: shrink back, then
  // unmount and clear — the ai-invoice choreography.
  useEffect(() => {
    if (open) {
      setSuggestions(pickRandom(SUGGESTION_COUNT))
      updateAnchor()
      setMounted(true)
      const frame = requestAnimationFrame(() => requestAnimationFrame(() => setVisible(true)))
      return () => cancelAnimationFrame(frame)
    }
    if (mounted) {
      setVisible(false)
      const timer = setTimeout(() => {
        setMounted(false)
        setQuery('')
        setHighlight(0)
        setAiSuggestion(null)
        setAiLoading(false)
      }, CLOSE_MS)
      return () => clearTimeout(timer)
    }
    return undefined
  }, [open, mounted, updateAnchor])

  useEffect(() => {
    if (!mounted) return undefined
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [mounted])

  useEffect(() => {
    if (!visible) return undefined
    window.addEventListener('resize', updateAnchor)
    const frame = requestAnimationFrame(() => inputRef.current?.focus())
    return () => {
      window.removeEventListener('resize', updateAnchor)
      cancelAnimationFrame(frame)
    }
  }, [visible, updateAnchor])

  useEffect(() => { setHighlight(0) }, [query])

  // Ask the assistant once the reader slows down. A query that lands after
  // the palette moved on is dropped, the way the composer's lookups are.
  useEffect(() => {
    if (!mounted || !showAiRow || trimmed.length < AI_MIN_CHARS) {
      setAiSuggestion(null)
      setAiLoading(false)
      return undefined
    }
    let cancelled = false
    const timer = setTimeout(async () => {
      setAiLoading(true)
      try {
        const response = await fetch('/api/nav-assistant', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: trimmed }),
        })
        const data = await response.json().catch(() => ({}))
        if (cancelled) return
        setAiSuggestion(response.ok && data?.href ? data : null)
      } catch {
        if (!cancelled) setAiSuggestion(null)
      } finally {
        if (!cancelled) setAiLoading(false)
      }
    }, 350)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [trimmed, mounted, showAiRow])

  // ⌘K / Ctrl+K toggles from anywhere that is not a field; Escape closes.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && open) {
        event.preventDefault()
        setOpen(false)
        return
      }
      if (event.key.toLowerCase() === 'k' && (event.metaKey || event.ctrlKey) && !event.altKey) {
        const tag = (event.target as HTMLElement | null)?.tagName?.toLowerCase()
        if (tag === 'input' || tag === 'textarea' || (event.target as HTMLElement | null)?.isContentEditable) return
        event.preventDefault()
        setOpen((current) => !current)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open])

  function goHref(href: string) {
    setOpen(false)
    if (href !== pathname) router.push(href)
  }

  function go(page: Page) {
    goHref(page.href)
  }

  /** Enter on the first row: the AI's pick when it has one, the best plain
   *  match otherwise. */
  function goAiRow() {
    if (aiSuggestion?.href) goHref(aiSuggestion.href)
    else if (rows[0]) go(rows[0])
  }

  function onKeyDown(event: React.KeyboardEvent) {
    const count = Math.max(selectable, 1)
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setHighlight((current) => (current + 1) % count)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setHighlight((current) => (current - 1 + count) % count)
    } else if (event.key === 'Enter') {
      event.preventDefault()
      if (showAiRow && highlight === 0) goAiRow()
      else {
        const page = rows[highlight - (showAiRow ? 1 : 0)]
        if (page) go(page)
      }
    } else if (event.key === 'Escape') {
      event.preventDefault()
      setOpen(false)
    }
  }

  const phaseClass = visible ? 'is-visible' : 'is-hiding'
  const overlay = mounted && typeof document !== 'undefined'
    ? createPortal(
        <>
          <div className={`nav-search-backdrop ${phaseClass}`} onClick={() => setOpen(false)} role="presentation" />
          <div
            className={`nav-search-card ${phaseClass} ${visible ? cardMode : ''}`}
            style={{
              top: anchor.top,
              left: anchor.left,
              '--nav-origin-w': `${anchor.width}px`,
              '--nav-origin-h': `${anchor.height}px`,
            } as React.CSSProperties}
            role="dialog"
            aria-modal="true"
            aria-label="Search pages"
          >
            <div className="nav-search-card-head">
              <span className="nav-search-head-icon"><Icon name="search" size={14} /></span>
              <input
                ref={inputRef}
                type="text"
                className="nav-search-input"
                placeholder="Search or ask where something lives…"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={onKeyDown}
                autoComplete="off"
                spellCheck={false}
              />
              <kbd className="nav-search-kbd">Esc</kbd>
            </div>

            <div className="nav-search-list-wrap">
              <ul className="nav-search-list" role="listbox">
                {!hasQuery && rows.length > 0 && (
                  <li className="nav-search-list-label" aria-hidden="true">Suggestions</li>
                )}

                {showAiRow && (
                  <li role="presentation">
                    <button
                      type="button"
                      className={`nav-search-item nav-search-item--ai${highlight === 0 ? ' is-highlighted' : ''}`}
                      onClick={goAiRow}
                      onMouseEnter={() => setHighlight(0)}
                    >
                      <span className="nav-search-item-icon-wrap nav-search-item-icon-wrap--ai">
                        {aiLoading
                          ? <span className="nav-search-spin"><Icon name="refresh" size={14} /></span>
                          : <Icon name="sparkles" size={14} />}
                      </span>
                      <span className="nav-search-item-body">
                        <span className="nav-search-item-title">
                          {aiSuggestion?.label ? (
                            <>
                              <strong>{aiSuggestion.label}</strong>
                              <span className="nav-search-item-query"> — “{trimmed}”</span>
                            </>
                          ) : (
                            <>Navigation Assistant — “{trimmed}”</>
                          )}
                        </span>
                        <span className="nav-search-item-sub">
                          {aiSuggestion?.subtitle
                            ?? (trimmed.length < AI_MIN_CHARS
                              ? 'Keep typing for AI help'
                              : aiLoading ? 'Thinking…' : 'AI page suggestion')}
                        </span>
                      </span>
                    </button>
                  </li>
                )}

                {rows.length === 0 && hasQuery && (
                  <li className="nav-search-empty">No pages match “{trimmed}”</li>
                )}

                {rows.map((page, index) => {
                  const rowIndex = index + (showAiRow ? 1 : 0)
                  return (
                    <li key={page.href} role="presentation">
                      <button
                        type="button"
                        className={`nav-search-item${highlight === rowIndex ? ' is-highlighted' : ''}`}
                        onClick={() => go(page)}
                        onMouseEnter={() => setHighlight(rowIndex)}
                      >
                        <span className="nav-search-item-icon-wrap">
                          {page.mark
                            ? <PlatformIcon platform={page.mark} size={14} />
                            : page.icon ? <Icon name={page.icon} size={15} /> : null}
                        </span>
                        <span className="nav-search-item-body">
                          <span className="nav-search-item-title">
                            <strong>{page.label}</strong>
                            <span className="nav-search-item-path"> / {page.section}</span>
                          </span>
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            </div>
          </div>
        </>,
        document.body,
      )
    : null

  return (
    <div className={`nav-search-root${open ? ' is-open' : ''}`}>
      <button
        ref={triggerRef}
        type="button"
        className="nav-search-trigger"
        onClick={() => setOpen(true)}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label="Search pages"
        title={mac ? 'Search pages (⌘K)' : 'Search pages (Ctrl+K)'}
      >
        <span className="nav-search-trigger-icon"><Icon name="search" size={15} /></span>
        <span className="nav-search-trigger-label">Search…</span>
        <kbd className="nav-search-trigger-kbd" aria-hidden="true">
          {mac ? <><Icon name="command" size={11} /><span>K</span></> : <span>Ctrl K</span>}
        </kbd>
      </button>
      {overlay}
    </div>
  )
}
