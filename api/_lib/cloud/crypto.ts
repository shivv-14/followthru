import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { HttpError } from './http'

// OAuth tokens are stored encrypted (AES-256-GCM). The key lives only in the server environment
// (TOKEN_ENCRYPTION_KEY, 32 bytes as base64) and is never sent to the browser or written to logs.

function key(): Buffer {
  const raw = process.env.TOKEN_ENCRYPTION_KEY ?? ''
  const k = Buffer.from(raw, 'base64')
  if (k.length !== 32) throw new HttpError(503, 'not_configured', 'The server is missing TOKEN_ENCRYPTION_KEY (32 bytes, base64).')
  return k
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12)
  const c = createCipheriv('aes-256-gcm', key(), iv)
  const body = Buffer.concat([c.update(plain, 'utf8'), c.final()])
  return ['v1', iv.toString('base64'), c.getAuthTag().toString('base64'), body.toString('base64')].join('.')
}

export function decryptSecret(sealed: string): string {
  const [v, iv, tag, body] = sealed.split('.')
  if (v !== 'v1' || !iv || !tag || !body) throw new Error('Unknown token format')
  const d = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64'))
  d.setAuthTag(Buffer.from(tag, 'base64'))
  return Buffer.concat([d.update(Buffer.from(body, 'base64')), d.final()]).toString('utf8')
}

/** Signed, expiring OAuth state so the Google callback can only finish a connection this server started. */
export function signState(payload: Record<string, unknown>, ttlMs = 10 * 60_000, now = Date.now()): string {
  const body = Buffer.from(JSON.stringify({ ...payload, exp: now + ttlMs, n: randomBytes(8).toString('hex') })).toString('base64url')
  const mac = createHmac('sha256', key()).update(body).digest('base64url')
  return `${body}.${mac}`
}

export function verifyState<T extends Record<string, unknown>>(state: string, now = Date.now()): T | null {
  const [body, mac] = state.split('.')
  if (!body || !mac) return null
  const expected = createHmac('sha256', key()).update(body).digest('base64url')
  const a = Buffer.from(mac)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null
  try {
    const data = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as T & { exp: number }
    return data.exp > now ? data : null
  } catch {
    return null
  }
}
