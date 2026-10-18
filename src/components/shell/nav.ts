import { LayoutDashboard, ListChecks, Inbox, Workflow, Users, FileCheck2, UserCog, Bell, type LucideIcon } from 'lucide-react'
import { cloudEnabled } from '../../lib/supabase'
import type { Role } from '../../engine/types'

export interface NavEntry {
  to: string
  label: string
  /** Shorter label for the mobile tab bar */
  short: string
  icon: LucideIcon
  /** Show the count of drafts waiting for review */
  badge?: 'pending_drafts'
}

const COORDINATOR: NavEntry[] = [
  { to: '/dashboard', label: 'Dashboard', short: 'Dashboard', icon: LayoutDashboard },
  { to: '/commitments', label: 'Commitments', short: 'Items', icon: ListChecks },
  { to: '/queue', label: 'Queue', short: 'Queue', icon: Inbox, badge: 'pending_drafts' },
  { to: '/flows', label: 'Flows', short: 'Flows', icon: Workflow },
  { to: '/team', label: 'Team', short: 'Team', icon: Users },
  { to: '/evidence', label: 'Evidence', short: 'Evidence', icon: FileCheck2 },
  ...(cloudEnabled ? [{ to: '/people', label: 'People', short: 'People', icon: UserCog }] : []),
]

const MEMBER: NavEntry[] = [
  { to: '/dashboard', label: 'My work', short: 'My work', icon: LayoutDashboard },
  { to: '/team', label: 'My tasks', short: 'Tasks', icon: Users },
  { to: '/commitments', label: 'Commitments', short: 'Items', icon: ListChecks },
  { to: '/evidence', label: 'Evidence', short: 'Evidence', icon: FileCheck2 },
  ...(cloudEnabled ? [{ to: '/notifications', label: 'Notifications', short: 'Alerts', icon: Bell }] : []),
]

/** One list per role, shared by the sidebar, the bottom tab bar and the mobile sheet. */
export function navFor(role: Role | undefined): NavEntry[] {
  return role === 'coordinator' ? COORDINATOR : MEMBER
}

/** Routes only a coordinator can open */
export const COORDINATOR_ROUTES = ['/queue', '/flows']
