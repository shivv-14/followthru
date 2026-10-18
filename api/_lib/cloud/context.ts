import type { ApiRequest } from '../handlers'
import type { Person, Role } from '../../../src/engine/types'
import { admin } from './admin'
import { HttpError, forbidden, header, unauthorized } from './http'

export type AppRole = 'coordinator' | 'team_lead' | 'member'

export interface ProfileRow {
  id: string
  /** Null for a team member who has not joined a workspace yet */
  org_id: string | null
  full_name: string
  username: string
  email: string | null
  role: AppRole
  timezone: string
  person_id: string
  is_active: boolean
  must_change_password: boolean
}

export interface Ctx {
  userId: string
  token: string
  profile: ProfileRow
  orgId: string
  role: AppRole
  /** Team keys this user leads (team leads only) */
  ledTeams: string[]
  /** The engine person this account acts as */
  person: Person
}

export const PROFILE_COLUMNS = 'id, org_id, full_name, username, email, role, timezone, person_id, is_active, must_change_password'

/** Engine roles: team leads review like coordinators, inside the teams they lead. */
export const engineRole = (role: AppRole): Role => (role === 'member' ? 'member' : 'coordinator')

/**
 * Verifies the bearer token with Supabase Auth and loads the caller's profile. The role and
 * organization always come from the database, never from the request.
 */
export async function requireUser(req: ApiRequest, opts: { allowMustChange?: boolean; allowNoWorkspace?: boolean } = {}): Promise<Ctx> {
  const token = header(req, 'authorization').replace(/^Bearer\s+/i, '')
  if (!token) throw unauthorized()
  // Verifies the JWT signature locally against the project's signing keys (cached), so most
  // requests skip a round trip to Supabase Auth. Disabled accounts are still caught below.
  const { data, error } = await admin().auth.getClaims(token)
  const userId = data?.claims?.sub
  if (error || !userId) throw unauthorized('Your session has expired. Sign in again.')
  const [{ data: profile }, { data: teams }] = await Promise.all([
    admin().from('profiles').select(PROFILE_COLUMNS).eq('id', userId).maybeSingle<ProfileRow>(),
    admin().from('teams').select('team_key').eq('lead_profile_id', userId),
  ])
  if (!profile) throw forbidden('This account has no FollowThru workspace.')
  if (!profile.is_active) throw forbidden('This account is disabled. Ask your coordinator.')
  if (profile.must_change_password && !opts.allowMustChange) throw new HttpError(403, 'must_change_password', 'Choose a new password before continuing.')
  if (!profile.org_id && !opts.allowNoWorkspace) throw new HttpError(403, 'no_workspace', 'Join a workspace first.')
  const { data: person } = await admin().from('external_people').select('external_id, name, timezone, role, team_key').eq('org_id', profile.org_id).eq('external_id', profile.person_id).maybeSingle()
  return {
    userId: profile.id,
    token,
    profile,
    orgId: profile.org_id ?? '',
    role: profile.role,
    ledTeams: (teams ?? []).map((t) => t.team_key as string),
    person: {
      id: profile.person_id,
      name: (person?.name as string) ?? profile.full_name,
      timezone: (person?.timezone as string) ?? profile.timezone,
      role: engineRole(profile.role),
      teamId: (person?.team_key as string | null) ?? undefined,
    },
  }
}

export function requireRole(ctx: Ctx, ...roles: AppRole[]): void {
  if (!roles.includes(ctx.role)) throw forbidden()
}

/** Coordinators review everything in their organization; team leads only their teams' work. */
export function canReview(ctx: Ctx, teamKey: string | null | undefined): boolean {
  return ctx.role === 'coordinator' || (ctx.role === 'team_lead' && !!teamKey && ctx.ledTeams.includes(teamKey))
}
