import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { HttpError, conflict } from './http'

/** Server configuration. The secret key is read here only and never sent to the browser. */
export function serverConfig() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || ''
  const secret = process.env.SUPABASE_SECRET_KEY || ''
  const publishable = process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_PUBLISHABLE_KEY || ''
  if (!url || !secret || !publishable) {
    throw new HttpError(503, 'not_configured', 'The server is missing its Supabase settings (SUPABASE_SECRET_KEY, VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY).')
  }
  return { url, secret, publishable }
}

let adminClient: SupabaseClient | undefined
/** Service-role client: bypasses RLS, so every route checks permissions itself before using it. */
export function admin(): SupabaseClient {
  if (!adminClient) {
    const { url, secret } = serverConfig()
    adminClient = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } })
  }
  return adminClient
}

/** Client with the publishable key, used only to check a password on the user's behalf. */
export function publicClient(): SupabaseClient {
  const { url, publishable } = serverConfig()
  return createClient(url, publishable, { auth: { persistSession: false, autoRefreshToken: false } })
}

export type Op =
  | { op: 'insert'; table: string; row: Record<string, unknown>; returning?: string }
  | { op: 'upsert'; table: string; row: Record<string, unknown>; conflict: string[]; ignore_duplicates?: boolean; returning?: string }
  | { op: 'update'; table: string; match: Record<string, unknown>; set: Record<string, unknown>; require_rows?: boolean }
  | { op: 'delete'; table: string; match: Record<string, unknown>; require_rows?: boolean }

/** Applies a change set in one database transaction (public.apply_ops). */
export async function applyOps(ops: Op[]): Promise<unknown[]> {
  if (ops.length === 0) return []
  const { data, error } = await admin().rpc('apply_ops', { p_ops: ops })
  if (error) {
    if (error.code === 'P0409') throw conflict('Someone changed this a moment ago. The page has the latest version now; try again.')
    if (error.code === '23505') throw conflict('That already exists.')
    console.error('apply_ops failed', error.code, error.message)
    throw new HttpError(500, 'server_error', 'The change could not be saved. Nothing was changed.')
  }
  return data as unknown[]
}

/** Reads every row of a query, a page at a time (the Data API returns at most 1000 rows per request). */
export async function selectAll<T>(table: string, columns: string, filter: (q: any) => any, order = 'id'): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await filter(admin().from(table).select(columns)).order(order).range(from, from + 999)
    if (error) {
      console.error('select failed', table, error.code, error.message)
      throw new HttpError(500, 'server_error', 'Could not read the workspace data.')
    }
    out.push(...((data ?? []) as T[]))
    if (!data || data.length < 1000) return out
  }
}

export const uuid = () => randomUUID()
export const shortId = (prefix: string) => `${prefix}_${randomBytes(6).toString('hex')}`
export const sha256 = (text: string | Buffer) => createHash('sha256').update(text).digest('hex')

/** Strong temporary password: shown once to the person who created the account, never stored. */
export function temporaryPassword(): string {
  const sets = ['ABCDEFGHJKLMNPQRSTUVWXYZ', 'abcdefghijkmnpqrstuvwxyz', '23456789', '!@#$%*?']
  const all = sets.join('')
  const bytes = randomBytes(16)
  const chars = [...bytes].map((b) => all[b % all.length])
  sets.forEach((s, i) => (chars[i] = s[bytes[i] % s.length]))
  // Shuffle so the guaranteed characters are not always first
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomBytes(1)[0] % (i + 1)
    ;[chars[i], chars[j]] = [chars[j], chars[i]]
  }
  return chars.join('')
}
