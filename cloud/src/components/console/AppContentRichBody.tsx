'use client'

import { en } from '@blocknote/core/locales'
import { useCreateBlockNote } from '@blocknote/react'
import { BlockNoteView } from '@blocknote/mantine'
import '@blocknote/core/fonts/inter.css'
import '@blocknote/mantine/style.css'
import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * The Notion-style writing surface (Geno, 2026-10-14) — the same BlockNote
 * editor the SOPs use over on ai-invoice, pointed at the app's documents.
 *
 * Edit mode only: the read view renders plain HTML (`lib/markdown.ts`) so a
 * page paints instantly, and this editor's chunk is warmed in the background
 * and mounted only when Edit is pressed. Type “/” for headings, lists,
 * tables, quotes, checks and images.
 *
 * The value is markdown, not a block tree: the row in `app_content` stays
 * plain text, the app parses it natively, and this editor hydrates it back
 * into blocks on open. Client-only — Next must never SSR this (loaded
 * through a dynamic import with `ssr: false`).
 */

function normalize(value: string): string {
  return String(value || '').replace(/\r\n/g, '\n').trimEnd()
}

export default function AppContentRichBody({
  value,
  onChange,
  placeholder = 'Type “/” for headings, lists, tables and everything else…',
}: {
  value: string
  onChange: (markdown: string) => void
  placeholder?: string
}) {
  const [ready, setReady] = useState(false)
  const lastEmittedRef = useRef<string | null>(null)
  const hydrateTokenRef = useRef(0)
  const skipNextEmitRef = useRef(false)

  const editor = useCreateBlockNote({
    dictionary: {
      ...en,
      placeholders: {
        ...en.placeholders,
        emptyDocument: placeholder,
        default: placeholder,
        heading: 'Heading',
      },
    },
  })

  const emit = useCallback(async () => {
    if (skipNextEmitRef.current) {
      skipNextEmitRef.current = false
      return
    }
    const markdown = normalize(await editor.blocksToMarkdownLossy(editor.document))
    if (markdown === lastEmittedRef.current) return
    lastEmittedRef.current = markdown
    onChange(markdown)
  }, [editor, onChange])

  const hydrate = useCallback(
    async (markdown: string) => {
      const token = ++hydrateTokenRef.current
      const source = normalize(markdown)
      skipNextEmitRef.current = true
      try {
        if (!source) {
          const existing = normalize(await editor.blocksToMarkdownLossy(editor.document))
          if (existing) {
            editor.replaceBlocks(editor.document, [{ type: 'paragraph', content: '' }])
          }
        } else {
          const blocks = await editor.tryParseMarkdownToBlocks(source)
          if (token !== hydrateTokenRef.current) return
          if (blocks?.length) {
            editor.replaceBlocks(editor.document, blocks)
          }
        }
      } finally {
        if (token === hydrateTokenRef.current) {
          lastEmittedRef.current = source
          setReady(true)
        }
      }
    },
    [editor],
  )

  // A new document (or an edit dropped elsewhere) arrives as `value`; only
  // hydrate when it is not simply the markdown this editor just emitted.
  useEffect(() => {
    const incoming = normalize(value)
    if (incoming === lastEmittedRef.current) {
      setReady(true)
      return
    }
    void hydrate(value)
  }, [value, hydrate])

  // The console follows the OS for its own ground; the editor follows it too.
  const [dark, setDark] = useState(false)
  useEffect(() => {
    const query = window.matchMedia('(prefers-color-scheme: dark)')
    const update = () => setDark(query.matches)
    update()
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])

  return (
    <div className="ac-rich">
      {!ready ? <p className="hint ac-rich-loading">Loading the editor…</p> : null}
      <BlockNoteView editor={editor} editable theme={dark ? 'dark' : 'light'} onChange={() => void emit()} />
    </div>
  )
}
