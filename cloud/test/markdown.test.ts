// node --import ./cloud/test/ts-resolve.mjs --test cloud/test/markdown.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { markdownToHtml, parseMarkdown } from '../src/lib/markdown'

test('headings, paragraphs and blank lines', () => {
  const html = markdownToHtml('# One\n\nHello world.\n\n## Two\n\nMore.')
  assert.equal(html, '<h1>One</h1>\n<p>Hello world.</p>\n<h2>Two</h2>\n<p>More.</p>')
})

test('inline styles survive as their tags', () => {
  const html = markdownToHtml('A **bold** and *italic* and ~~gone~~ and `code` line.')
  assert.match(html, /<strong>bold<\/strong>/)
  assert.match(html, /<em>italic<\/em>/)
  assert.match(html, /<s>gone<\/s>/)
  assert.match(html, /<code>code<\/code>/)
})

test('links open in a new tab, and hostile hrefs are text, never markup', () => {
  const html = markdownToHtml('See [the docs](https://example.com/a?b=1&c=2).')
  assert.match(html, /<a href="https:\/\/example\.com\/a\?b=1&amp;c=2" target="_blank" rel="noopener noreferrer">the docs<\/a>/)
})

test('raw html in the source is escaped, not executed', () => {
  const html = markdownToHtml('Careful <script>alert(1)</script> here.')
  assert.ok(!html.includes('<script>'))
  assert.match(html, /&lt;script&gt;/)
})

test('bullets and numbered lists', () => {
  const html = markdownToHtml('- one\n- two\n\n1. first\n2. second')
  assert.match(html, /<ul><li>one<\/li><li>two<\/li><\/ul>/)
  assert.match(html, /<ol><li>first<\/li><li>second<\/li><\/ol>/)
})

test('checklists carry their state for the CSS box', () => {
  const html = markdownToHtml('- [x] done\n- [ ] open')
  assert.match(html, /class="md-check" data-on="true"/)
  assert.match(html, /class="md-check" data-on="false"/)
  assert.match(html, /<span class="md-box" aria-hidden="true"><\/span>/)
})

test('quotes, fenced code, and dividers', () => {
  const html = markdownToHtml('> Stay kind.\n\n```js\nconst a = 1\n```\n\n---')
  assert.match(html, /<blockquote><p>Stay kind\.<\/p><\/blockquote>/)
  assert.match(html, /<pre><code>const a = 1<\/code><\/pre>/)
  assert.match(html, /<hr \/>/)
})

test('GFM tables — header, rows, padded cells', () => {
  const html = markdownToHtml('| Days | Hours |\n| --- | --- |\n| M – F | 9 – 6 |')
  assert.equal(
    html,
    '<table><thead><tr><th>Days</th><th>Hours</th></tr></thead><tbody><tr><td>M – F</td><td>9 – 6</td></tr></tbody></table>',
  )
})

test('images and the block kinds the phone also reads', () => {
  const html = markdownToHtml('![cover](https://example.com/a.png)')
  assert.match(html, /<img src="https:\/\/example\.com\/a\.png" alt="cover" loading="lazy" \/>/)
})

test('parseMarkdown keeps block shapes the editor emits', () => {
  const blocks = parseMarkdown('## Section\n\n> note\n\n- a\n- b\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\n![x](y)')
  assert.deepEqual(
    blocks.map((block) => block.kind),
    ['heading', 'quote', 'list', 'table', 'image'],
  )
})
