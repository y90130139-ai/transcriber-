/**
 * BlockNote's markdown, read by the console (Geno, 2026-10-14).
 *
 * The App Content editor writes BlockNote-flavoured markdown; this is the
 * console's own reader for it — the read view renders through here as plain
 * HTML, so a document page paints with the first byte instead of waiting on
 * the editor runtime. (The phone has a sibling of this parser,
 * `expo-app-gosian/src/lib/markdown.ts`, that produces native views instead
 * of HTML — change both when the block set changes.)
 *
 * Only the subset the editor can emit: headings, paragraphs, bullet and
 * numbered lists, checklists, quotes, fenced code, GFM tables, images and
 * dividers, with bold/italic/strikethrough/code/links parsed inline. All
 * text is escaped; the only tags that ever reach the page are the ones
 * literals here produce.
 */

export type MdSpan = {
  text: string
  bold?: boolean
  italic?: boolean
  strike?: boolean
  code?: boolean
  link?: string
}

export type MdBlock =
  | { kind: 'heading'; level: 1 | 2 | 3; spans: MdSpan[] }
  | { kind: 'paragraph'; spans: MdSpan[] }
  | { kind: 'quote'; lines: MdSpan[][] }
  | { kind: 'list'; ordered: boolean; items: { spans: MdSpan[]; level: number }[] }
  | { kind: 'checks'; items: { spans: MdSpan[]; checked: boolean; level: number }[] }
  | { kind: 'code'; lang: string; text: string }
  | { kind: 'table'; columns: string[]; rows: string[][] }
  | { kind: 'image'; alt: string; src: string }
  | { kind: 'divider' }

const INLINE =
  /(`[^`\n]+`|\*\*[^*\n]+\*\*|__[^_\n]+__|\*[^*\n]+\*|_[^_\n]+_|~~[^~\n]+~~|\[[^\]\n]+\]\([^)\s]+\))/

/** One line of text → styled spans. Flat on purpose: bold inside a link is a
 *  corner the editor rarely produces and the page can live without. */
export function inlineSpans(text: string): MdSpan[] {
  const spans: MdSpan[] = []
  const pattern = new RegExp(INLINE.source, 'g')
  let at = 0
  let match: RegExpExecArray | null
  while ((match = pattern.exec(text))) {
    if (match.index > at) spans.push({ text: text.slice(at, match.index) })
    const token = match[0]
    if (token.startsWith('`')) spans.push({ text: token.slice(1, -1), code: true })
    else if (token.startsWith('**') || token.startsWith('__')) spans.push({ text: token.slice(2, -2), bold: true })
    else if (token.startsWith('~~')) spans.push({ text: token.slice(2, -2), strike: true })
    else if (token.startsWith('[')) {
      const link = token.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/)
      if (link) spans.push({ text: link[1], link: link[2] })
      else spans.push({ text: token })
    } else spans.push({ text: token.slice(1, -1), italic: true })
    at = match.index + token.length
  }
  if (at < text.length) spans.push({ text: text.slice(at) })
  return spans.filter((span) => span.text.length > 0)
}

/** Markdown markers off a string, for table cells rendered as plain text. */
function stripInline(text: string): string {
  return inlineSpans(text)
    .map((span) => span.text)
    .join('')
}

const LIST_ITEM = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/
const BLOCK_START = /^\s*(#{1,3}\s|>|```|\||!\[|(-{3,}|\*{3,}|_{3,})\s*$|([-*+]|\d+[.)])\s)/

function isTableRow(line: string): boolean {
  return line.trim().startsWith('|')
}

function isTableSeparator(line: string): boolean {
  return /^\s*\|?[\s:|-]+\|?\s*$/.test(line) && line.includes('-')
}

function splitRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim())
}

export function parseMarkdown(markdown: string): MdBlock[] {
  const lines = String(markdown || '').replace(/\r\n/g, '\n').split('\n')
  const blocks: MdBlock[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]
    if (!line.trim()) {
      i += 1
      continue
    }

    const fence = line.match(/^```\s*([A-Za-z0-9_+-]*)\s*$/)
    if (fence) {
      const code: string[] = []
      i += 1
      while (i < lines.length && !lines[i].startsWith('```')) {
        code.push(lines[i])
        i += 1
      }
      i += 1 // the closing fence, or the end
      blocks.push({ kind: 'code', lang: fence[1] ?? '', text: code.join('\n') })
      continue
    }

    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      blocks.push({ kind: 'divider' })
      i += 1
      continue
    }

    const heading = line.match(/^(#{1,3})\s+(.*)$/)
    if (heading) {
      blocks.push({ kind: 'heading', level: heading[1].length as 1 | 2 | 3, spans: inlineSpans(heading[2]) })
      i += 1
      continue
    }

    const image = line.trim().match(/^!\[([^\]]*)\]\(([^)\s]+)\)$/)
    if (image) {
      blocks.push({ kind: 'image', alt: image[1], src: image[2] })
      i += 1
      continue
    }

    if (/^\s*>\s?/.test(line)) {
      const quote: string[] = []
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        quote.push(lines[i].replace(/^\s*>\s?/, ''))
        i += 1
      }
      blocks.push({ kind: 'quote', lines: quote.map(inlineSpans) })
      continue
    }

    if (isTableRow(line) && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
      const columns = splitRow(line).map(stripInline)
      i += 2
      const rows: string[][] = []
      while (i < lines.length && isTableRow(lines[i])) {
        rows.push(splitRow(lines[i]).map(stripInline))
        i += 1
      }
      blocks.push({ kind: 'table', columns, rows })
      continue
    }

    const first = line.match(LIST_ITEM)
    if (first) {
      const ordered = /\d/.test(first[2])
      const items: { spans: MdSpan[]; level: number }[] = []
      const checks: { spans: MdSpan[]; checked: boolean; level: number }[] = []
      while (i < lines.length) {
        const item = lines[i].match(LIST_ITEM)
        if (!item) break
        if (/\d/.test(item[2]) !== ordered) break
        const level = Math.min(2, Math.floor(item[1].length / 2))
        const check = item[3].match(/^\[([ xX])\]\s+(.*)$/)
        if (check) checks.push({ spans: inlineSpans(check[2]), checked: check[1].toLowerCase() === 'x', level })
        else items.push({ spans: inlineSpans(item[3]), level })
        i += 1
      }
      if (checks.length) blocks.push({ kind: 'checks', items: checks })
      if (items.length) blocks.push({ kind: 'list', ordered, items })
      continue
    }

    // A paragraph — every following line until a blank one or the next
    // block-shaped line. Single newlines inside keep rendering as breaks.
    const paragraph: string[] = [line]
    i += 1
    while (i < lines.length && lines[i].trim() && !BLOCK_START.test(lines[i])) {
      paragraph.push(lines[i])
      i += 1
    }
    blocks.push({ kind: 'paragraph', spans: inlineSpans(paragraph.join('\n')) })
  }

  return blocks
}

// ------------------------------------------------------------------- html

function esc(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function spansToHtml(spans: MdSpan[]): string {
  return spans
    .map((span) => {
      let html = esc(span.text)
      if (span.code) html = `<code>${html}</code>`
      if (span.bold) html = `<strong>${html}</strong>`
      if (span.italic) html = `<em>${html}</em>`
      if (span.strike) html = `<s>${html}</s>`
      if (span.link) html = `<a href="${esc(span.link)}" target="_blank" rel="noopener noreferrer">${html}</a>`
      return html
    })
    .join('')
}

/** Markdown → HTML for the console's read view. The only tags it can emit
 *  are the ones written below, and every piece of text is escaped. */
export function markdownToHtml(markdown: string): string {
  const html: string[] = []
  for (const block of parseMarkdown(markdown)) {
    switch (block.kind) {
      case 'heading':
        html.push(`<h${block.level}>${spansToHtml(block.spans)}</h${block.level}>`)
        break
      case 'paragraph':
        html.push(`<p>${spansToHtml(block.spans)}</p>`)
        break
      case 'quote':
        html.push(`<blockquote>${block.lines.map((line) => `<p>${spansToHtml(line)}</p>`).join('')}</blockquote>`)
        break
      case 'list': {
        const tag = block.ordered ? 'ol' : 'ul'
        html.push(`<${tag}>${block.items.map((item) => `<li>${spansToHtml(item.spans)}</li>`).join('')}</${tag}>`)
        break
      }
      case 'checks':
        html.push(
          `<ul class="md-checks">${block.items
            .map(
              (item) =>
                `<li class="md-check" data-on="${item.checked}"><span class="md-box" aria-hidden="true"></span><span class="md-check-text">${spansToHtml(item.spans)}</span></li>`,
            )
            .join('')}</ul>`,
        )
        break
      case 'code':
        html.push(`<pre><code>${esc(block.text)}</code></pre>`)
        break
      case 'table':
        html.push(
          `<table><thead><tr>${block.columns.map((column) => `<th>${esc(column)}</th>`).join('')}</tr></thead>` +
            `<tbody>${block.rows
              .map((row) => `<tr>${row.map((cell) => `<td>${esc(cell)}</td>`).join('')}</tr>`)
              .join('')}</tbody></table>`,
        )
        break
      case 'image':
        html.push(`<img src="${esc(block.src)}" alt="${esc(block.alt)}" loading="lazy" />`)
        break
      case 'divider':
        html.push('<hr />')
        break
    }
  }
  return html.join('\n')
}
