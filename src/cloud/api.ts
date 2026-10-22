import { supabase } from '../lib/supabase'

export interface ApiError {
  code: string
  message: string
  [extra: string]: unknown
}

export type ApiResult<T> = { ok: true; status: number; data: T } | { ok: false; status: number; error: ApiError }

/** Fired when the server says the session is no longer valid, so the app can send the user to sign in. */
export const SESSION_EXPIRED_EVENT = 'followthru:session-expired'

const PUBLIC_ROUTES = new Set(['auth/login', 'auth/signup'])

/** Calls POST /api/cloud/<route> with the signed-in user's token. Never throws; failures come back as a safe message. */
export async function callApi<T = Record<string, unknown>>(route: string, body: unknown = {}, token?: string): Promise<ApiResult<T>> {
  let bearer = token
  // Sign-in and sign-up need no session, and must not wait on the auth client while it is busy
  if (!bearer && !PUBLIC_ROUTES.has(route)) {
    const { data } = await supabase().auth.getSession()
    bearer = data.session?.access_token
  }
  let res: Response
  try {
    res = await fetch(`/api/cloud/${route}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}) },
      body: JSON.stringify(body),
    })
  } catch {
    return { ok: false, status: 0, error: { code: 'offline', message: 'Could not reach the server. Check your connection and try again.' } }
  }
  const json = (await res.json().catch(() => ({}))) as { error?: ApiError } & T
  if (res.ok) return { ok: true, status: res.status, data: json }
  if (res.status === 401 && !PUBLIC_ROUTES.has(route)) window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT))
  return { ok: false, status: res.status, error: json.error ?? { code: 'server_error', message: `The server answered ${res.status}.` } }
}
