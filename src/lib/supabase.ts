import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined

/**
 * Cloud mode: real accounts and a Supabase database. Off when the two browser settings are missing,
 * when VITE_BACKEND=local is set, in Vite mode "demo" (vite --mode demo), and in unit tests; the app then runs in the browser-only demo mode.
 */
export const cloudEnabled = Boolean(url && key) && import.meta.env.VITE_BACKEND !== 'local' && import.meta.env.MODE !== 'test' && import.meta.env.MODE !== 'demo'

/** A half-done configuration is a setup mistake worth saying out loud. */
export const cloudConfigProblem: string | null =
  Boolean(url) !== Boolean(key) ? 'Supabase is half configured: set both VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY in .env.local, then restart npm run dev.' : null

let client: SupabaseClient | null = null

/** The one browser Supabase client (publishable key only; RLS decides what it can read). */
export function supabase(): SupabaseClient {
  if (!cloudEnabled) throw new Error('Supabase is not configured')
  if (!client) client = createClient(url!, key!, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } })
  return client
}
