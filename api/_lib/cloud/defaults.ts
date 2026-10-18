import type { Flow } from '../../../src/engine/types'
import { isValidTimeZone } from '../../../src/engine/time'
import { bad } from './http'

/** The three flows every new workspace starts with (locked; coordinators duplicate them to change). */
export const WORKSPACE_FLOWS: Flow[] = [
  {
    id: 'flow_standard',
    name: 'Standard',
    isDefault: true,
    appliesTo: 'all',
    steps: [
      { afterHours: 2, tone: 'gentle' },
      { afterHours: 48, tone: 'firm' },
      { afterHours: 120, tone: 'escalate' },
    ],
    skipWeekends: false,
  },
  {
    id: 'flow_client_critical',
    name: 'Client-critical',
    isDefault: true,
    appliesTo: 'none',
    steps: [
      { afterHours: 0, tone: 'gentle' },
      { afterHours: 24, tone: 'firm' },
      { afterHours: 48, tone: 'escalate' },
    ],
    skipWeekends: false,
  },
  {
    id: 'flow_gentle',
    name: 'Gentle',
    isDefault: true,
    appliesTo: 'none',
    steps: [
      { afterHours: 24, tone: 'gentle' },
      { afterHours: 168, tone: 'escalate' },
    ],
    skipWeekends: true,
  },
]

export const USERNAME = /^[a-z0-9][a-z0-9._-]{2,31}$/
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function checkUsername(u: string): string {
  const v = u.toLowerCase()
  if (!USERNAME.test(v)) throw bad('Usernames are 3 to 32 characters: letters, numbers, dots, dashes or underscores, starting with a letter or number')
  return v
}

export function checkEmail(e: string): string {
  const v = e.toLowerCase()
  if (!EMAIL.test(v) || v.length > 254) throw bad('Enter a valid email address')
  return v
}

export function checkPassword(p: string): void {
  if (p.length < 10) throw bad('Use at least 10 characters for the password')
  if (p.length > 72) throw bad('Use at most 72 characters for the password')
  if (!/[A-Za-z]/.test(p) || !/[0-9]/.test(p)) throw bad('Use at least one letter and one number in the password')
}

export function checkTimezone(tz: string): string {
  if (!isValidTimeZone(tz)) throw bad('Choose a valid timezone, for example Asia/Kolkata')
  return tz
}

/** Accounts without a real email sign in by username; Supabase Auth still needs an address, so they get one that can never receive mail. */
export const placeholderEmail = (username: string, orgId: string) => `${username}.${orgId.slice(0, 8)}@accounts.followthru.invalid`
export const isPlaceholderEmail = (email: string | null | undefined) => !!email && email.endsWith('@accounts.followthru.invalid')
