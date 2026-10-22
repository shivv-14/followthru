import { verifyState } from './crypto'
import { HttpError } from './http'

// Official Slack Web API with OAuth v2. Bot scopes are read-only: FollowThru never posts to Slack.

export const SLACK_SCOPES = ['channels:read', 'channels:history', 'groups:read', 'groups:history', 'users:read', 'users:read.email']
const AUTH_URL = 'https://slack.com/oauth/v2/authorize'
const API = 'https://slack.com/api'
const MAX_WAIT_MS = 30_000
const MAX_PAGES = 10

export type Fetch = typeof fetch
export type Sleep = (ms: number) => Promise<void>
const realSleep: Sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export function slackConfig() {
  const clientId = process.env.SLACK_CLIENT_ID ?? ''
  const clientSecret = process.env.SLACK_CLIENT_SECRET ?? ''
  const redirectUri = process.env.SLACK_REDIRECT_URI ?? ''
  return { clientId, clientSecret, redirectUri, configured: !!(clientId && clientSecret && redirectUri) }
}

export function requireSlack() {
  const s = slackConfig()
  if (!s.configured) throw new HttpError(503, 'slack_not_configured', 'Slack is not set up on the server yet: SLACK_CLIENT_ID, SLACK_CLIENT_SECRET and SLACK_REDIRECT_URI are missing. See docs/slack-integration.md.')
  return s
}

export function slackAuthUrl(state: string): string {
  const s = requireSlack()
  const q = new URLSearchParams({ client_id: s.clientId, scope: SLACK_SCOPES.join(','), redirect_uri: s.redirectUri, state })
  return `${AUTH_URL}?${q}`
}

/** Reads a signed Slack OAuth state. Gmail states (same key, no kind) and forged or expired ones are rejected. */
export function readSlackState(state: string, now = Date.now()): { org: string; profile: string } | null {
  const s = verifyState<{ kind?: string; org?: string; profile?: string }>(state, now)
  if (!s || s.kind !== 'slack' || typeof s.org !== 'string' || typeof s.profile !== 'string') return null
  return { org: s.org, profile: s.profile }
}

/** The bot token was revoked, the app was uninstalled or the account is gone: connect again. */
export class SlackRevokedError extends Error {}
/** Slack answered ok:false (the error code is safe to show; it never contains the token). */
export class SlackApiError extends Error {
  constructor(public code: string) {
    super(`Slack returned ${code}`)
  }
}

const REVOKED = new Set(['token_revoked', 'invalid_auth', 'account_inactive', 'not_authed', 'token_expired'])

interface SlackResponse {
  ok: boolean
  error?: string
  response_metadata?: { next_cursor?: string }
}

/** One Web API call (form POST). Retries 429 honoring Retry-After and 5xx with backoff, at most `tries` times. */
export async function slackCall<T>(method: string, token: string, params: Record<string, string>, f: Fetch = fetch, opts: { tries?: number; sleep?: Sleep } = {}): Promise<T & SlackResponse> {
  const tries = opts.tries ?? 4
  const sleep = opts.sleep ?? realSleep
  for (let attempt = 0; ; attempt++) {
    const res = await f(`${API}/${method}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params).toString(),
    })
    if ((res.status === 429 || res.status >= 500) && attempt < tries - 1) {
      const after = Number(res.headers.get('retry-after'))
      await sleep(res.status === 429 && Number.isFinite(after) && after >= 0 ? Math.min(after * 1000, MAX_WAIT_MS) : 500 * 2 ** attempt)
      continue
    }
    if (res.status === 429) throw new SlackApiError('rate_limited')
    if (res.status >= 500) throw new SlackApiError(`http_${res.status}`)
    const data = (await res.json().catch(() => ({ ok: false, error: 'invalid_response' }))) as T & SlackResponse
    if (data.ok) return data
    const code = typeof data.error === 'string' ? data.error : 'unknown_error'
    if (REVOKED.has(code)) throw new SlackRevokedError(`Slack access ended (${code}). Connect Slack again.`)
    throw new SlackApiError(code)
  }
}

/** Follows response_metadata.next_cursor and collects `key` from every page, up to MAX_PAGES. */
export async function slackPages<T>(method: string, token: string, params: Record<string, string>, key: string, f: Fetch = fetch): Promise<T[]> {
  const out: T[] = []
  let cursor = ''
  for (let page = 0; page < MAX_PAGES; page++) {
    const data = await slackCall<Record<string, unknown>>(method, token, { ...params, ...(cursor ? { cursor } : {}) }, f)
    out.push(...((data[key] as T[] | undefined) ?? []))
    cursor = data.response_metadata?.next_cursor ?? ''
    if (!cursor) break
  }
  return out
}

export interface OAuthResult {
  accessToken: string
  scope: string
  teamId: string
  teamName: string | null
}

/** oauth.v2.access: trades the one-time code for a bot token. */
export async function exchangeSlackCode(code: string, f: Fetch = fetch): Promise<OAuthResult> {
  const s = requireSlack()
  const res = await f(`${API}/oauth.v2.access`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, client_id: s.clientId, client_secret: s.clientSecret, redirect_uri: s.redirectUri }).toString(),
  })
  const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; access_token?: string; token_type?: string; scope?: string; team?: { id?: string; name?: string } }
  if (!data.ok || data.token_type !== 'bot' || !data.access_token || !data.team?.id) throw new SlackApiError(data.error ?? 'oauth_failed')
  return { accessToken: data.access_token, scope: data.scope ?? '', teamId: data.team.id, teamName: data.team.name ?? null }
}

export async function revokeSlack(token: string, f: Fetch = fetch): Promise<void> {
  await slackCall('auth.revoke', token, {}, f, { tries: 1 }).catch(() => undefined)
}

export interface SlackChannel {
  id: string
  name: string
  isPrivate: boolean
}

export async function listChannels(token: string, f: Fetch = fetch): Promise<SlackChannel[]> {
  const rows = await slackPages<{ id: string; name: string; is_private?: boolean }>('conversations.list', token, { types: 'public_channel,private_channel', exclude_archived: 'true', limit: '200' }, 'channels', f)
  return rows.map((c) => ({ id: c.id, name: c.name, isPrivate: !!c.is_private }))
}

export interface SlackMessage {
  type?: string
  subtype?: string
  user?: string
  bot_id?: string
  text?: string
  ts: string
  thread_ts?: string
  reply_count?: number
}

/**
 * Messages newer than `oldest` (exclusive), oldest first, with the replies of threads started in
 * that window. Replies added later to an older thread are not seen (documented limitation).
 */
export async function channelHistory(token: string, channel: string, oldest: string, f: Fetch = fetch): Promise<SlackMessage[]> {
  const top = await slackPages<SlackMessage>('conversations.history', token, { channel, oldest, limit: '200' }, 'messages', f)
  const out = [...top]
  for (const m of top) {
    if (!m.reply_count || m.thread_ts !== m.ts) continue
    const replies = await slackPages<SlackMessage>('conversations.replies', token, { channel, ts: m.ts, limit: '200' }, 'messages', f)
    out.push(...replies.filter((r) => r.ts !== m.ts))
  }
  return out.sort((a, b) => compareTs(a.ts, b.ts))
}

export interface SlackUser {
  id: string
  name: string
  email: string | null
  timezone: string | null
  isBot: boolean
}

export async function userInfo(token: string, user: string, f: Fetch = fetch, sleep?: Sleep): Promise<SlackUser> {
  const data = await slackCall<{ user?: { id: string; name?: string; real_name?: string; tz?: string; is_bot?: boolean; profile?: { email?: string; real_name?: string; display_name?: string } } }>('users.info', token, { user }, f, { sleep })
  const u = data.user
  const name = (u?.real_name || u?.profile?.real_name || u?.profile?.display_name || u?.name || user).slice(0, 120)
  return { id: user, name, email: u?.profile?.email?.toLowerCase() ?? null, timezone: u?.tz ?? null, isBot: !!u?.is_bot }
}

/** Slack ts values ("1729238400.000100") compared numerically, seconds then micro-seconds. */
export function compareTs(a: string, b: string): number {
  const [as, au = '0'] = a.split('.')
  const [bs, bu = '0'] = b.split('.')
  return Number(as) - Number(bs) || Number(au.padEnd(6, '0')) - Number(bu.padEnd(6, '0'))
}
