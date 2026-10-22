// Email text helpers: keep the newest reply, drop quoted history and signatures.

const QUOTE_HEADERS = [
  /^On .{4,200}wrote:\s*$/im,
  /^-{2,}\s*Original Message\s*-{2,}/im,
  /^-{2,}\s*Forwarded message\s*-{2,}/im,
  /^From:\s.+\n(?:.*\n){0,3}?(?:Sent|Date):\s/im,
  /^_{8,}\s*$/m,
]
const SIGNATURE = [/^--\s*$/m, /^Sent from my (iPhone|iPad|Android|phone|mobile).*$/im, /^Get Outlook for .*$/im]

/** The latest part of an email body: quoted replies, forwarded history and signatures removed. */
export function latestReply(text: string): string {
  let t = text.replace(/\r\n?/g, '\n')
  for (const re of QUOTE_HEADERS) {
    const m = re.exec(t)
    if (m && m.index > 0) t = t.slice(0, m.index)
  }
  for (const re of SIGNATURE) {
    const m = re.exec(t)
    if (m && m.index > 0) t = t.slice(0, m.index)
  }
  return t
    .split('\n')
    .filter((line) => !/^\s*>/.test(line))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

const ENTITIES: Record<string, string> = { '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&apos;': "'" }

/** Plain text from an HTML email body. Scripts and styles are dropped; block tags become line breaks. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|head)[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6]|blockquote)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<[^>]+>/g, '')
    .replace(/&[a-z#0-9]+;/gi, (e) => ENTITIES[e.toLowerCase()] ?? ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n\s*\n+/g, '\n\n')
    .trim()
}

const AUTOMATED_SENDER = /(^|[._-])(no-?reply|do-?not-?reply|notifications?|mailer-daemon|postmaster|bounce|alerts?|newsletter|digest)([._-]|@)/i

/** Bulk mail, newsletters, auto-replies and system notifications. */
export function looksAutomated(fromEmail: string | null, headers: Record<string, string>): boolean {
  const h = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]))
  if (h['list-unsubscribe'] || h['list-id']) return true
  if (/^(bulk|list|junk)$/i.test(h['precedence'] ?? '')) return true
  if (h['auto-submitted'] && !/^no$/i.test(h['auto-submitted'])) return true
  return !!fromEmail && AUTOMATED_SENDER.test(fromEmail)
}

/** "Asha Rao <asha@x.com>" → { name, email } (lower-case email). */
export function parseAddress(raw: string): { name: string | null; email: string | null } {
  const m = /^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/.exec(raw)
  if (m) return { name: m[1].trim() || null, email: m[2].trim().toLowerCase() }
  const e = /[^\s<>,;]+@[^\s<>,;]+/.exec(raw)
  return { name: null, email: e ? e[0].toLowerCase() : null }
}

/** Splits an address list header, respecting quoted names that contain commas. */
export function parseAddressList(raw: string | undefined): string[] {
  if (!raw) return []
  const parts = raw.match(/("[^"]*"|[^,])+/g) ?? []
  return parts.map((p) => parseAddress(p).email).filter((e): e is string => !!e)
}
