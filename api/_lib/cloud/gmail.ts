import { htmlToText, latestReply, looksAutomated, parseAddress, parseAddressList } from '../../../src/automation/emailText'
import { HttpError } from './http'

// Official Google OAuth 2.0 and Gmail REST API. Read-only scope: FollowThru never sends or changes mail.

export const GMAIL_SCOPES = ['https://www.googleapis.com/auth/gmail.readonly', 'openid', 'email']
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke'
const API = 'https://gmail.googleapis.com/gmail/v1/users/me'

export type Fetch = typeof fetch

export function googleConfig() {
  const clientId = process.env.GOOGLE_CLIENT_ID ?? ''
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET ?? ''
  const redirectUri = process.env.GOOGLE_REDIRECT_URI ?? ''
  return { clientId, clientSecret, redirectUri, configured: !!(clientId && clientSecret && redirectUri) }
}

function requireGoogle() {
  const g = googleConfig()
  if (!g.configured) throw new HttpError(503, 'gmail_not_configured', 'Gmail is not set up on the server yet: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and GOOGLE_REDIRECT_URI are missing. See docs/gmail-automation.md.')
  return g
}

export function authUrl(state: string, loginHint?: string): string {
  const g = requireGoogle()
  const q = new URLSearchParams({
    client_id: g.clientId,
    redirect_uri: g.redirectUri,
    response_type: 'code',
    scope: GMAIL_SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
    ...(loginHint ? { login_hint: loginHint } : {}),
  })
  return `${AUTH_URL}?${q}`
}

export interface TokenSet {
  access_token: string
  expires_in: number
  refresh_token?: string
  scope?: string
}

/** Thrown when Google says the grant is gone: the user revoked access or the token expired for good. */
export class RevokedError extends Error {}
/** Thrown for 429 and 5xx: worth retrying later. */
export class TransientError extends Error {}

async function tokenCall(body: Record<string, string>, f: Fetch): Promise<TokenSet> {
  const res = await f(TOKEN_URL, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body).toString() })
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (res.status === 400 && data.error === 'invalid_grant') throw new RevokedError('Google access was revoked or expired. Connect Gmail again.')
  if (res.status === 429 || res.status >= 500) throw new TransientError(`Google token endpoint returned ${res.status}`)
  if (!res.ok || typeof data.access_token !== 'string') throw new Error(`Google token exchange failed (${res.status}${data.error ? `: ${String(data.error)}` : ''})`)
  return data as unknown as TokenSet
}

export function exchangeCode(code: string, f: Fetch = fetch): Promise<TokenSet> {
  const g = requireGoogle()
  return tokenCall({ code, client_id: g.clientId, client_secret: g.clientSecret, redirect_uri: g.redirectUri, grant_type: 'authorization_code' }, f)
}

export function refreshAccess(refreshToken: string, f: Fetch = fetch): Promise<TokenSet> {
  const g = requireGoogle()
  return tokenCall({ refresh_token: refreshToken, client_id: g.clientId, client_secret: g.clientSecret, grant_type: 'refresh_token' }, f)
}

export async function revoke(token: string, f: Fetch = fetch): Promise<void> {
  await f(`${REVOKE_URL}?token=${encodeURIComponent(token)}`, { method: 'POST' }).catch(() => undefined)
}

/** One Gmail API GET with retry on 429/5xx (exponential backoff, at most 3 tries). */
export async function gmailGet<T>(path: string, accessToken: string, f: Fetch = fetch, tries = 3): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const res = await f(`${API}${path}`, { headers: { authorization: `Bearer ${accessToken}` } })
    if (res.ok) return (await res.json()) as T
    if (res.status === 401 || res.status === 403) throw new RevokedError(`Gmail refused access (${res.status}). Connect Gmail again.`)
    if (res.status === 404) throw new HttpError(404, 'gmail_not_found', 'Gmail item not found')
    if ((res.status === 429 || res.status >= 500) && attempt < tries - 1) {
      await new Promise((r) => setTimeout(r, 300 * 2 ** attempt))
      continue
    }
    if (res.status === 429 || res.status >= 500) throw new TransientError(`Gmail API returned ${res.status}`)
    throw new Error(`Gmail API returned ${res.status}`)
  }
}

interface GmailPart {
  mimeType?: string
  filename?: string
  headers?: { name: string; value: string }[]
  body?: { data?: string; size?: number }
  parts?: GmailPart[]
}

export interface GmailMessage {
  id: string
  threadId: string
  internalDate?: string
  historyId?: string
  labelIds?: string[]
  payload?: GmailPart
}

export interface ParsedEmail {
  gmailMessageId: string
  gmailThreadId: string
  fromEmail: string | null
  fromName: string | null
  toEmails: string[]
  ccEmails: string[]
  subject: string
  sentAt: string
  body: string
  automated: boolean
  headers: Record<string, string>
}

const b64 = (data: string) => Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')

function findBody(part: GmailPart | undefined, mime: string): string | null {
  if (!part) return null
  if (part.mimeType === mime && part.body?.data && !part.filename) return b64(part.body.data)
  for (const p of part.parts ?? []) {
    const hit = findBody(p, mime)
    if (hit) return hit
  }
  return null
}

/** Gmail "full" message → the fields FollowThru stores. Only the newest reply is kept as the body. */
export function parseGmailMessage(m: GmailMessage): ParsedEmail {
  const headers: Record<string, string> = {}
  for (const h of m.payload?.headers ?? []) headers[h.name.toLowerCase()] = h.value
  const from = parseAddress(headers.from ?? '')
  const plain = findBody(m.payload, 'text/plain')
  const html = plain ? null : findBody(m.payload, 'text/html')
  const raw = plain ?? (html ? htmlToText(html) : '')
  const dateMs = m.internalDate ? Number(m.internalDate) : Date.parse(headers.date ?? '')
  const labels = m.labelIds ?? []
  return {
    gmailMessageId: m.id,
    gmailThreadId: m.threadId,
    fromEmail: from.email,
    fromName: from.name,
    toEmails: parseAddressList(headers.to),
    ccEmails: parseAddressList(headers.cc),
    subject: (headers.subject ?? '').slice(0, 300),
    sentAt: new Date(Number.isFinite(dateMs) ? dateMs : 0).toISOString(),
    body: latestReply(raw).slice(0, 20000),
    automated: looksAutomated(from.email, headers) || labels.some((l) => ['CATEGORY_PROMOTIONS', 'CATEGORY_SOCIAL', 'CATEGORY_FORUMS', 'SPAM'].includes(l)),
    headers,
  }
}

/** Message ids to fetch: the first time, recent mail; afterwards, only what Gmail history says is new. */
export async function newMessageIds(
  accessToken: string,
  historyId: string | null,
  initialDays: number,
  f: Fetch = fetch,
  cap = 200,
): Promise<{ ids: string[]; historyId: string | null; fullResync: boolean }> {
  const profile = await gmailGet<{ historyId: string }>('/profile', accessToken, f)
  const ids: string[] = []
  if (historyId) {
    try {
      let page: string | undefined
      do {
        const q = new URLSearchParams({ startHistoryId: historyId, historyTypes: 'messageAdded', maxResults: '500', ...(page ? { pageToken: page } : {}) })
        const h = await gmailGet<{ history?: { messagesAdded?: { message: { id: string; labelIds?: string[] } }[] }[]; nextPageToken?: string }>(`/history?${q}`, accessToken, f)
        for (const rec of h.history ?? []) for (const a of rec.messagesAdded ?? []) if (!a.message.labelIds?.includes('DRAFT') && !ids.includes(a.message.id)) ids.push(a.message.id)
        page = h.nextPageToken
      } while (page && ids.length < cap)
      return { ids: ids.slice(0, cap), historyId: profile.historyId, fullResync: false }
    } catch (e) {
      // A history id older than about a week is rejected with 404: fall back to a dated listing
      if (!(e instanceof HttpError && e.status === 404)) throw e
    }
  }
  let page: string | undefined
  do {
    const q = new URLSearchParams({ q: `newer_than:${initialDays}d -in:chats -in:drafts`, maxResults: '100', ...(page ? { pageToken: page } : {}) })
    const l = await gmailGet<{ messages?: { id: string }[]; nextPageToken?: string }>(`/messages?${q}`, accessToken, f)
    for (const m of l.messages ?? []) ids.push(m.id)
    page = l.nextPageToken
  } while (page && ids.length < cap)
  return { ids: ids.slice(0, cap), historyId: profile.historyId, fullResync: true }
}

export function gmailThreadLink(threadId: string, account?: string | null): string {
  return `https://mail.google.com/mail/${account ? `?authuser=${encodeURIComponent(account)}` : 'u/0/'}#all/${threadId}`
}
