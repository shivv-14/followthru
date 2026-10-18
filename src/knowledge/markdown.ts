// A small markdown reader that produces a plain tree, never HTML. The page renders the tree as
// React elements, so every piece of text is escaped by React and no raw HTML ever reaches the DOM.
// Supported: headings, paragraphs, bullet and numbered lists, block quotes, fenced code, rules,
// **bold**, *italic*, `code` and [links](https://...). Links accept only http(s) and app paths.

export type Inline =
  | { type: 'text'; text: string }
  | { type: 'strong'; children: Inline[] }
  | { type: 'em'; children: Inline[] }
  | { type: 'code'; text: string }
  | { type: 'link'; href: string; children: Inline[] }

export type Block =
  | { type: 'heading'; level: 1 | 2 | 3 | 4 | 5 | 6; children: Inline[] }
  | { type: 'paragraph'; children: Inline[] }
  | { type: 'list'; ordered: boolean; items: Inline[][] }
  | { type: 'quote'; children: Inline[] }
  | { type: 'code'; text: string }
  | { type: 'rule' }

/** http(s) URLs and same-site paths ("/commitments/c_1"). Everything else (javascript:, data:, //host, backslashes) is refused. */
export function safeHref(raw: string): string | null {
  const href = raw.trim()
  if (!href || /[\s\\<>"'`\u0000-\u001f\u007f]/.test(href)) return null
  if (/^\/(?!\/)/.test(href)) return href
  if (!/^https?:\/\//i.test(href)) return null
  try {
    const u = new URL(href)
    return u.protocol === 'http:' || u.protocol === 'https:' ? href : null
  } catch {
    return null
  }
}

const ESCAPABLE = /[\\`*_[\]()#+\-.!>]/

export function parseInline(src: string, depth = 0): Inline[] {
  const out: Inline[] = []
  let buf = ''
  const flush = () => {
    if (buf) out.push({ type: 'text', text: buf })
    buf = ''
  }
  let i = 0
  while (i < src.length) {
    const ch = src[i]
    const rest = src.slice(i)
    let m: RegExpExecArray | null
    if (ch === '\\' && i + 1 < src.length && ESCAPABLE.test(src[i + 1])) {
      buf += src[i + 1]
      i += 2
      continue
    }
    if (ch === '`' && (m = /^`([^`]+)`/.exec(rest))) {
      flush()
      out.push({ type: 'code', text: m[1] })
      i += m[0].length
      continue
    }
    if (depth < 4 && ch === '*' && (m = /^\*\*(?!\s)(.+?)\*\*/.exec(rest))) {
      flush()
      out.push({ type: 'strong', children: parseInline(m[1], depth + 1) })
      i += m[0].length
      continue
    }
    if (depth < 4 && (ch === '*' || ch === '_') && (m = /^([*_])(?![\s*_])(.+?)\1(?![*_])/.exec(rest))) {
      flush()
      out.push({ type: 'em', children: parseInline(m[2], depth + 1) })
      i += m[0].length
      continue
    }
    if (depth < 4 && ch === '[' && (m = /^\[([^\]]+)\]\(([^()\s]*)\)/.exec(rest))) {
      const href = safeHref(m[2])
      flush()
      // An unsafe link keeps its words but is shown as plain text, without the address
      out.push(href ? { type: 'link', href, children: parseInline(m[1], depth + 1) } : { type: 'text', text: m[1] })
      i += m[0].length
      continue
    }
    buf += ch
    i++
  }
  flush()
  return out
}

const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/
const RULE = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/
const BULLET = /^\s{0,3}[-*+]\s+(.*)$/
const NUMBERED = /^\s{0,3}\d{1,9}[.)]\s+(.*)$/
const QUOTE = /^\s{0,3}>\s?(.*)$/
const FENCE = /^\s{0,3}```/

export function parseMarkdown(src: string): Block[] {
  const lines = src.replace(/\r\n?/g, '\n').split('\n')
  const blocks: Block[] = []
  let i = 0
  const special = (l: string) => HEADING.test(l) || RULE.test(l) || BULLET.test(l) || NUMBERED.test(l) || QUOTE.test(l) || FENCE.test(l)
  while (i < lines.length) {
    const line = lines[i]
    if (!line.trim()) {
      i++
      continue
    }
    if (FENCE.test(line)) {
      const body: string[] = []
      i++
      while (i < lines.length && !FENCE.test(lines[i])) body.push(lines[i++])
      i++
      blocks.push({ type: 'code', text: body.join('\n') })
      continue
    }
    const h = HEADING.exec(line)
    if (h) {
      blocks.push({ type: 'heading', level: h[1].length as 1 | 2 | 3 | 4 | 5 | 6, children: parseInline(h[2]) })
      i++
      continue
    }
    if (RULE.test(line)) {
      blocks.push({ type: 'rule' })
      i++
      continue
    }
    const listRe = BULLET.test(line) ? BULLET : NUMBERED.test(line) ? NUMBERED : null
    if (listRe) {
      const items: Inline[][] = []
      let m: RegExpExecArray | null
      while (i < lines.length && (m = listRe.exec(lines[i]))) {
        items.push(parseInline(m[1]))
        i++
      }
      blocks.push({ type: 'list', ordered: listRe === NUMBERED, items })
      continue
    }
    if (QUOTE.test(line)) {
      const body: string[] = []
      let m: RegExpExecArray | null
      while (i < lines.length && (m = QUOTE.exec(lines[i]))) {
        body.push(m[1])
        i++
      }
      blocks.push({ type: 'quote', children: parseInline(body.join(' ')) })
      continue
    }
    const para: string[] = []
    while (i < lines.length && lines[i].trim() && !special(lines[i])) para.push(lines[i++].trim())
    blocks.push({ type: 'paragraph', children: parseInline(para.join(' ')) })
  }
  return blocks
}

/** Escapes text so it reads literally when placed inside markdown (used for email content in generated pages). */
export function escapeMarkdown(text: string): string {
  return text.replace(/\s+/g, ' ').trim().replace(/[\\`*_[\]]/g, '\\$&')
}
