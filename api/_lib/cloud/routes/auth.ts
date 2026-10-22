import type { ApiRequest } from '../../handlers'
import { admin, applyOps, publicClient, sha256, shortId, uuid, type Op } from '../admin'
import { PROFILE_COLUMNS, requireUser, type ProfileRow } from '../context'
import { WORKSPACE_FLOWS, checkEmail, checkPassword, checkTimezone, checkUsername, placeholderEmail } from '../defaults'
import { HttpError, bad, bodyOf, clientIp, conflict, header, json, rateLimit, str } from '../http'
import { DEFAULT_ORG_SETTINGS, loadSettings } from '../orgData'
import { auditOp, notificationOps } from '../notify'

const GENERIC_LOGIN_FAILURE = 'Wrong username, email or password.'

async function authEvent(event: string, req: ApiRequest, identifier: string, profile?: Pick<ProfileRow, 'id' | 'org_id'> | null) {
  await admin()
    .from('auth_events')
    .insert({
      event,
      org_id: profile?.org_id ?? null,
      profile_id: profile?.id ?? null,
      identifier_hash: identifier ? sha256(identifier.toLowerCase()) : null,
      ip_hash: sha256(clientIp(req)),
      user_agent: header(req, 'user-agent').slice(0, 200) || null,
    })
}

async function session(email: string, password: string) {
  const { data, error } = await publicClient().auth.signInWithPassword({ email, password })
  return { data, error }
}

/**
 * Public signup: creates a workspace and its first account (coordinator, or team lead of a
 * "general" team). Members are never created here; coordinators and team leads create them.
 */
export async function signup(req: ApiRequest) {
  const b = bodyOf(req)
  const orgName = str(b, 'orgName', { max: 120 })
  const fullName = str(b, 'fullName', { max: 120 })
  const username = checkUsername(str(b, 'username', { max: 32 }))
  const email = checkEmail(str(b, 'email', { max: 254 }))
  const password = str(b, 'password', { max: 72 })
  checkPassword(password)
  const timezone = checkTimezone(str(b, 'timezone', { max: 64 }))
  // One role creates workspaces: Coordinator / Team Lead (stored as coordinator)
  const requested = str(b, 'role', { optional: true }) || 'coordinator'
  if (requested !== 'coordinator' && requested !== 'team_lead') throw bad('Team members use "Join as a team member" instead.')
  const role = 'coordinator'
  // Counted after validation, so only real account-creating attempts use up the limit
  rateLimit(`signup:${clientIp(req)}`, 5, 60 * 60_000)

  const { data: taken } = await admin().from('profiles').select('id').eq('username', username).maybeSingle()
  if (taken) throw conflict('That username is taken. Choose another.')

  const created = await admin().auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: fullName } })
  if (created.error || !created.data.user) {
    if (/already|exists|registered/i.test(created.error?.message ?? '')) throw conflict('An account with this email already exists. Sign in instead.')
    throw new HttpError(400, 'signup_failed', 'The account could not be created. Check the details and try again.')
  }
  const userId = created.data.user.id
  const orgId = uuid()
  const personId = shortId('u')
  const lead = false
  const ops: Op[] = [
    { op: 'insert', table: 'organizations', row: { id: orgId, name: orgName, description: str(b, 'description', { max: 500, optional: true }) || null, created_by: userId } },
    { op: 'insert', table: 'external_people', row: { org_id: orgId, external_id: personId, name: fullName, timezone, role: 'coordinator', team_key: lead ? 'general' : null } },
    { op: 'insert', table: 'profiles', row: { id: userId, org_id: orgId, full_name: fullName, username, email, role, timezone, person_id: personId } },
    { op: 'update', table: 'external_people', match: { org_id: orgId, external_id: personId }, set: { linked_profile_id: userId } },
    { op: 'insert', table: 'settings', row: { org_id: orgId, key: 'app', value: { ...DEFAULT_ORG_SETTINGS, ...(lead ? { defaultTeamKey: 'general' } : {}) }, updated_by: userId } },
    ...WORKSPACE_FLOWS.map((f): Op => ({
      op: 'insert',
      table: 'followup_flows',
      row: { org_id: orgId, flow_key: f.id, name: f.name, is_default: true, applies_to: f.appliesTo, definition: f, skip_weekends: f.skipWeekends, created_by: userId },
    })),
    ...(lead
      ? ([
          { op: 'insert', table: 'teams', row: { id: uuid(), org_id: orgId, team_key: 'general', name: 'General', lead_profile_id: userId, created_by: userId } },
        ] as Op[])
      : []),
    { op: 'insert', table: 'credential_events', row: { org_id: orgId, target_profile_id: userId, actor_profile_id: userId, event: 'account_created', details: { via: 'signup', role } } },
    auditOp(orgId, userId, personId, 'workspace.create', 'organization', orgId, null, { name: orgName, role }),
    ...notificationOps({ orgId, recipients: [userId], type: 'welcome', title: `Welcome to FollowThru, ${fullName.split(/\s+/)[0]}`, body: 'Import your team conversations or load the demo data to get started.', link: '/setup', eventKey: `welcome:${userId}` }),
  ]
  try {
    await applyOps(ops)
  } catch (e) {
    // No half-made workspaces: remove the auth account if the workspace could not be created
    await admin().auth.admin.deleteUser(userId)
    throw e
  }
  const { data } = await session(email, password)
  await authEvent('login_success', req, username, { id: userId, org_id: orgId })
  return json(201, { session: data.session ? { access_token: data.session.access_token, refresh_token: data.session.refresh_token } : null })
}

/** Username or email plus password. Failures are generic so the response never reveals which accounts exist. */
export async function login(req: ApiRequest) {
  const b = bodyOf(req)
  const identifier = str(b, 'identifier', { max: 254 }).toLowerCase()
  const password = str(b, 'password', { max: 200 })
  try {
    rateLimit(`login-ip:${clientIp(req)}`, 30, 10 * 60_000)
    rateLimit(`login-id:${identifier}`, 8, 10 * 60_000)
  } catch (e) {
    await authEvent('login_rate_limited', req, identifier)
    throw e
  }

  let profile: ProfileRow | null = null
  if (identifier.includes('@')) {
    const { data } = await admin().from('profiles').select(PROFILE_COLUMNS).eq('email', identifier).maybeSingle<ProfileRow>()
    profile = data
  } else {
    const { data } = await admin().from('profiles').select(PROFILE_COLUMNS).eq('username', identifier).maybeSingle<ProfileRow>()
    profile = data
  }
  const email = profile?.email ?? (identifier.includes('@') ? identifier : null)
  if (!email) {
    await authEvent('login_failure', req, identifier)
    throw new HttpError(401, 'invalid_credentials', GENERIC_LOGIN_FAILURE)
  }
  const { data, error } = await session(email, password)
  if (error || !data.session) {
    const banned = /banned/i.test(error?.message ?? '')
    await authEvent(banned ? 'login_disabled' : 'login_failure', req, identifier, profile)
    if (banned) throw new HttpError(403, 'disabled', 'This account is disabled. Ask your coordinator.')
    throw new HttpError(401, 'invalid_credentials', GENERIC_LOGIN_FAILURE)
  }
  if (!profile || !profile.is_active) {
    await admin().auth.admin.signOut(data.session.access_token)
    await authEvent('login_disabled', req, identifier, profile)
    throw new HttpError(403, 'disabled', profile ? 'This account is disabled. Ask your coordinator.' : 'This account has no FollowThru workspace.')
  }
  await Promise.all([authEvent('login_success', req, identifier, profile), admin().from('profiles').update({ last_login_at: new Date().toISOString() }).eq('id', profile.id)])
  return json(200, {
    session: { access_token: data.session.access_token, refresh_token: data.session.refresh_token },
    mustChangePassword: profile.must_change_password,
    role: profile.role,
  })
}

/** Signed-in password change; also how a temporary password is replaced (clears the server-side flag). */
export async function changePassword(req: ApiRequest) {
  const ctx = await requireUser(req, { allowMustChange: true, allowNoWorkspace: true })
  rateLimit(`pw:${ctx.userId}`, 10, 60 * 60_000)
  const password = str(bodyOf(req), 'password', { max: 72 })
  checkPassword(password)
  const { error } = await admin().auth.admin.updateUserById(ctx.userId, { password })
  if (error) throw new HttpError(400, 'password_rejected', 'That password was not accepted. Try a different one.')
  await applyOps([
    { op: 'update', table: 'profiles', match: { id: ctx.userId }, set: { must_change_password: false } },
    { op: 'insert', table: 'auth_events', row: { org_id: ctx.orgId || null, profile_id: ctx.userId, event: 'password_changed' } },
    // Workspace records only exist once the person belongs to a workspace
    ...(ctx.orgId
      ? ([
          { op: 'insert', table: 'credential_events', row: { org_id: ctx.orgId, target_profile_id: ctx.userId, actor_profile_id: ctx.userId, event: 'password_changed' } },
          auditOp(ctx.orgId, ctx.userId, ctx.person.id, 'account.password_change', 'profile', ctx.userId, null, null, ctx.userId),
        ] as Op[])
      : []),
  ])
  // Supabase ends existing sessions when the password changes; hand back a fresh one
  const fresh = ctx.profile.email ? (await session(ctx.profile.email, password)).data.session : null
  return json(200, { ok: true, message: 'Password changed', session: fresh ? { access_token: fresh.access_token, refresh_token: fresh.refresh_token } : null })
}

export async function logout(req: ApiRequest) {
  const ctx = await requireUser(req, { allowMustChange: true, allowNoWorkspace: true })
  await admin().auth.admin.signOut(ctx.token, 'global')
  await authEvent('logout', req, ctx.profile.username, ctx.profile)
  return json(200, { ok: true })
}

/** The signed-in account, its workspace and the engine person it acts as. */
export async function me(req: ApiRequest) {
  const ctx = await requireUser(req, { allowMustChange: true, allowNoWorkspace: true })
  const p = ctx.profile
  const profile = { id: p.id, fullName: p.full_name, username: p.username, email: p.email, role: p.role, timezone: p.timezone, personId: p.person_id, mustChangePassword: p.must_change_password }
  // A team member who has not joined a workspace yet
  if (!ctx.orgId) return json(200, { profile, org: null, person: ctx.person, ledTeams: [], dataClock: null })
  const [{ data: org }, settings, { data: ref }, { data: last }] = await Promise.all([
    admin().from('organizations').select('id, name').eq('id', ctx.orgId).single(),
    loadSettings(ctx.orgId),
    admin().from('imports').select('reference_time').eq('org_id', ctx.orgId).not('reference_time', 'is', null).order('created_at', { ascending: false }).limit(1).maybeSingle(),
    admin().from('messages').select('sent_at').eq('org_id', ctx.orgId).order('sent_at', { ascending: false }).limit(1).maybeSingle(),
  ])
  // The data clock for everyone, including members who cannot read the whole import
  const dataClock = ref?.reference_time ?? last?.sent_at ?? null
  return json(200, {
    profile,
    org,
    person: ctx.person,
    ledTeams: ctx.ledTeams,
    dataClock: settings.clockMode === 'dataset' && dataClock ? new Date(dataClock).toISOString() : null,
  })
}

/** Team member sign-up: an account with no workspace yet. They then ask to join one, and a coordinator approves. */
export async function signupMember(req: ApiRequest) {
  const b = bodyOf(req)
  const fullName = str(b, 'fullName', { max: 120 })
  const username = checkUsername(str(b, 'username', { max: 32 }))
  const rawEmail = str(b, 'email', { max: 254, optional: true })
  const password = str(b, 'password', { max: 72 })
  checkPassword(password)
  const timezone = checkTimezone(str(b, 'timezone', { max: 64 }))
  rateLimit(`signup:${clientIp(req)}`, 5, 60 * 60_000)
  const { data: taken } = await admin().from('profiles').select('id').eq('username', username).maybeSingle()
  if (taken) throw conflict('That username is taken. Choose another.')
  const email = rawEmail ? checkEmail(rawEmail) : placeholderEmail(username, 'members')
  const created = await admin().auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: fullName } })
  if (created.error || !created.data.user) {
    if (/already|exists|registered/i.test(created.error?.message ?? '')) throw conflict('An account with this email already exists. Sign in instead.')
    throw new HttpError(400, 'signup_failed', 'The account could not be created. Check the details and try again.')
  }
  const userId = created.data.user.id
  try {
    await applyOps([{ op: 'insert', table: 'profiles', row: { id: userId, org_id: null, full_name: fullName, username, email, role: 'member', timezone, person_id: shortId('u') } }])
  } catch (e) {
    await admin().auth.admin.deleteUser(userId)
    throw e
  }
  const { data } = await session(email, password)
  await authEvent('login_success', req, username, null)
  return json(201, { session: data.session ? { access_token: data.session.access_token, refresh_token: data.session.refresh_token } : null })
}
