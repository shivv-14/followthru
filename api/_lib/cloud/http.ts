import type { ApiRequest, ApiResponse } from '../handlers'

/** Error with an HTTP status and a message that is safe to show to the user. */
export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public extra?: Record<string, unknown>,
  ) {
    super(message)
  }
}

export const bad = (message: string, code = 'invalid_request') => new HttpError(400, code, message)
export const unauthorized = (message = 'Sign in again to continue') => new HttpError(401, 'unauthorized', message)
export const forbidden = (message = 'Your role cannot do that') => new HttpError(403, 'forbidden', message)
export const notFound = (message = 'Not found') => new HttpError(404, 'not_found', message)
export const conflict = (message: string, extra?: Record<string, unknown>) => new HttpError(409, 'conflict', message, extra)

export function json(status: number, body: unknown): ApiResponse {
  return { status, body, headers: { 'Cache-Control': 'no-store' } }
}

export function header(req: ApiRequest, name: string): string {
  const v = req.headers[name.toLowerCase()]
  return (Array.isArray(v) ? v[0] : v) ?? ''
}

export function bodyOf(req: ApiRequest): Record<string, unknown> {
  let b = req.body
  if (typeof b === 'string') {
    try {
      b = b ? JSON.parse(b) : {}
    } catch {
      throw bad('Send valid JSON')
    }
  }
  if (!b || typeof b !== 'object' || Array.isArray(b)) return {}
  return b as Record<string, unknown>
}

export function str(b: Record<string, unknown>, key: string, opts: { max?: number; optional?: boolean } = {}): string {
  const v = b[key]
  if (v === undefined || v === null || v === '') {
    if (opts.optional) return ''
    throw bad(`Missing ${key}`)
  }
  if (typeof v !== 'string') throw bad(`${key} must be text`)
  const t = v.trim()
  if (opts.max && t.length > opts.max) throw bad(`${key} is too long (max ${opts.max} characters)`)
  return t
}

/** Fixed-window limiter. Per server instance only: on Vercel each instance keeps its own counts, and Supabase Auth adds its own limits. */
const windows = new Map<string, { start: number; count: number }>()
export function rateLimit(key: string, max: number, windowMs: number, now = Date.now()): void {
  const w = windows.get(key)
  if (!w || now - w.start > windowMs) {
    windows.set(key, { start: now, count: 1 })
    return
  }
  w.count++
  if (w.count > max) throw new HttpError(429, 'rate_limited', 'Too many attempts. Wait a few minutes and try again.')
}

export function clientIp(req: ApiRequest): string {
  return header(req, 'x-forwarded-for').split(',')[0].trim() || header(req, 'x-real-ip') || 'local'
}
