import type { ApiRequest } from '../../handlers'
import { admin, applyOps, shortId, temporaryPassword, uuid, type Op } from '../admin'
import { requireRole, requireUser, type AppRole, type Ctx } from '../context'
import { checkEmail, checkTimezone, checkUsername, isPlaceholderEmail, placeholderEmail } from '../defaults'
import { HttpError, bad, bodyOf, conflict, forbidden, json, notFound, rateLimit, str } from '../http'
import { auditOp, notificationOps } from '../notify'

const PUBLIC_PROFILE = 'id, full_name, username, email, role, timezone, person_id, is_active, must_change_password, last_login_at, created_at'

async function teamsOf(orgId: string) {
  const { data } = await admin().from('teams').select('id, team_key, name, description, lead_profile_id').eq('org_id', orgId).order('name')
  return data ?? []
}

/** Profiles a caller may manage: a coordinator manages the organization, a team lead the members of teams they lead. */
async function manageable(ctx: Ctx, profileId: string) {
  const { data: target } = await admin().from('profiles').select(PUBLIC_PROFILE + ', org_id').eq('id', profileId).maybeSingle<any>()
  if (!target || target.org_id !== ctx.orgId) throw notFound('Account not found')
  if (ctx.role === 'coordinator') return target
  if (ctx.role === 'team_lead' && target.role === 'member') {
    const { data } = await admin().from('team_members').select('team_id, teams!inner(team_key)').eq('profile_id', profileId)
    if ((data ?? []).some((m: any) => ctx.ledTeams.includes(m.teams.team_key))) return target
  }
  throw forbidden('You can only manage members of teams you lead')
}

export async function listAccounts(req: ApiRequest) {
  const ctx = await requireUser(req)
  requireRole(ctx, 'coordinator', 'team_lead')
  const [{ data: profiles }, teams, { data: members }, { data: people }] = await Promise.all([
    admin().from('profiles').select(PUBLIC_PROFILE).eq('org_id', ctx.orgId).order('full_name'),
    teamsOf(ctx.orgId),
    admin().from('team_members').select('team_id, profile_id'),
    admin().from('external_people').select('external_id, name, timezone, role, team_key, linked_profile_id').eq('org_id', ctx.orgId).order('name'),
  ])
  const teamIds = new Set(teams.map((t) => t.id))
  const membership = (members ?? []).filter((m) => teamIds.has(m.team_id))
  const ledIds = new Set(teams.filter((t) => ctx.ledTeams.includes(t.team_key)).map((t) => t.id))
  const visible = (profiles ?? []).filter(
    (p) => ctx.role === 'coordinator' || p.id === ctx.userId || membership.some((m) => m.profile_id === p.id && ledIds.has(m.team_id)),
  )
  return json(200, {
    accounts: visible.map((p) => ({ ...p, email: isPlaceholderEmail(p.email) ? null : p.email, teams: membership.filter((m) => m.profile_id === p.id).map((m) => teams.find((t) => t.id === m.team_id)?.team_key) })),
    teams,
    people: ctx.role === 'coordinator' ? people ?? [] : [],
  })
}

/** Creates a member or team lead with a temporary password, returned once and never stored. */
export async function createAccount(req: ApiRequest) {
  const ctx = await requireUser(req)
  requireRole(ctx, 'coordinator', 'team_lead')
  rateLimit(`create-account:${ctx.userId}`, 30, 60 * 60_000)
  const b = bodyOf(req)
  const fullName = str(b, 'fullName', { max: 120 })
  const username = checkUsername(str(b, 'username', { max: 32 }))
  const rawEmail = str(b, 'email', { max: 254, optional: true })
  const timezone = checkTimezone(str(b, 'timezone', { max: 64 }))
  const role = str(b, 'role') as AppRole
  const teamKeys = Array.isArray(b.teamKeys) ? (b.teamKeys as unknown[]).filter((k): k is string => typeof k === 'string') : []
  const personExternalId = str(b, 'personExternalId', { max: 80, optional: true })
  if (!['member', 'team_lead', 'coordinator'].includes(role)) throw bad('Choose member, team lead or coordinator')
  if (ctx.role === 'team_lead') {
    if (role !== 'member') throw forbidden('Team leads can create member accounts only')
    if (teamKeys.length === 0 || teamKeys.some((k) => !ctx.ledTeams.includes(k))) throw forbidden('Add the member to a team you lead')
  }
  const teams = await teamsOf(ctx.orgId)
  const unknownTeam = teamKeys.find((k) => !teams.some((t) => t.team_key === k))
  if (unknownTeam) throw bad(`Team ${unknownTeam} does not exist`)

  const { data: taken } = await admin().from('profiles').select('id').eq('username', username).maybeSingle()
  if (taken) throw conflict('That username is taken. Choose another.')
  if (personExternalId) {
    const { data: person } = await admin().from('external_people').select('linked_profile_id').eq('org_id', ctx.orgId).eq('external_id', personExternalId).maybeSingle()
    if (!person) throw bad('That person is not in the imported data')
    if (person.linked_profile_id) throw conflict('That person already has an account')
  }

  const orgId = ctx.orgId
  const email = rawEmail ? checkEmail(rawEmail) : placeholderEmail(username, orgId)
  const password = temporaryPassword()
  const created = await admin().auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: fullName } })
  if (created.error || !created.data.user) {
    if (/already|exists|registered/i.test(created.error?.message ?? '')) throw conflict('An account with this email already exists.')
    throw new HttpError(400, 'create_failed', 'The account could not be created. Check the details and try again.')
  }
  const userId = created.data.user.id
  const personId = personExternalId || shortId('u')
  const engineRole = role === 'member' ? 'member' : 'coordinator'
  const ops: Op[] = [
    personExternalId
      ? { op: 'update', table: 'external_people', match: { org_id: orgId, external_id: personId }, set: { role: engineRole } }
      : { op: 'insert', table: 'external_people', row: { org_id: orgId, external_id: personId, name: fullName, timezone, role: engineRole, team_key: teamKeys[0] ?? null } },
    { op: 'insert', table: 'profiles', row: { id: userId, org_id: orgId, full_name: fullName, username, email, role, timezone, person_id: personId, must_change_password: true, created_by: ctx.userId } },
    { op: 'update', table: 'external_people', match: { org_id: orgId, external_id: personId }, set: { linked_profile_id: userId } },
    ...teamKeys.map((k): Op => ({ op: 'insert', table: 'team_members', row: { team_id: teams.find((t) => t.team_key === k)!.id, profile_id: userId, added_by: ctx.userId }, returning: 'team_id' })),
    { op: 'insert', table: 'credential_events', row: { org_id: orgId, target_profile_id: userId, actor_profile_id: ctx.userId, event: 'account_created', details: { role, teams: teamKeys } } },
    auditOp(orgId, ctx.userId, ctx.person.id, 'account.create', 'profile', userId, null, { username, role, teams: teamKeys, linkedPerson: personExternalId || null }),
    ...notificationOps({ orgId, recipients: [userId], type: 'welcome', title: `Welcome to FollowThru, ${fullName.split(/\s+/)[0]}`, body: 'Your coordinator created this account. Your tasks appear on the dashboard.', link: '/dashboard', eventKey: `welcome:${userId}` }),
  ]
  try {
    await applyOps(ops)
  } catch (e) {
    await admin().auth.admin.deleteUser(userId)
    throw e
  }
  return json(201, {
    account: { id: userId, username, fullName, role },
    temporaryPassword: password,
    handoff: rawEmail
      ? 'No email was sent. Give this temporary password to the person directly; they must change it when they first sign in.'
      : 'This account signs in with its username. No email was sent. Give the username and temporary password to the person directly; they must change it when they first sign in.',
  })
}

export async function resetPassword(req: ApiRequest) {
  const ctx = await requireUser(req)
  requireRole(ctx, 'coordinator', 'team_lead')
  rateLimit(`reset:${ctx.userId}`, 30, 60 * 60_000)
  const target = await manageable(ctx, str(bodyOf(req), 'profileId'))
  if (target.id === ctx.userId) throw bad('Use Change password for your own account')
  const password = temporaryPassword()
  const { error } = await admin().auth.admin.updateUserById(target.id, { password })
  if (error) throw new HttpError(500, 'server_error', 'The password could not be reset.')
  await applyOps([
    { op: 'update', table: 'profiles', match: { id: target.id }, set: { must_change_password: true } },
    { op: 'insert', table: 'credential_events', row: { org_id: ctx.orgId, target_profile_id: target.id, actor_profile_id: ctx.userId, event: 'password_reset' } },
    auditOp(ctx.orgId, ctx.userId, ctx.person.id, 'account.password_reset', 'profile', target.id),
    ...notificationOps({ orgId: ctx.orgId, recipients: [target.id], type: 'password_reset', title: 'Your password was reset', body: 'Sign in with the temporary password your coordinator gave you, then choose a new one.', eventKey: `pwreset:${target.id}:${Date.now()}` }),
  ])
  return json(200, { temporaryPassword: password, handoff: 'No email was sent. Give this temporary password to the person directly.' })
}

/** Disabling blocks sign-in (Supabase ban) and hides all data (RLS checks is_active). You cannot lock out yourself or the last coordinator. */
export async function setActive(req: ApiRequest) {
  const ctx = await requireUser(req)
  requireRole(ctx, 'coordinator', 'team_lead')
  const b = bodyOf(req)
  const target = await manageable(ctx, str(b, 'profileId'))
  const active = b.active === true
  if (target.id === ctx.userId) throw bad('You cannot disable your own account')
  if (!active && target.role === 'coordinator') {
    const { count } = await admin().from('profiles').select('id', { count: 'exact', head: true }).eq('org_id', ctx.orgId).eq('role', 'coordinator').eq('is_active', true)
    if ((count ?? 0) <= 1) throw conflict('This is the last active coordinator; the workspace would be locked out')
  }
  const { error } = await admin().auth.admin.updateUserById(target.id, { ban_duration: active ? 'none' : '876000h' })
  if (error) throw new HttpError(500, 'server_error', 'The account could not be updated.')
  await applyOps([
    { op: 'update', table: 'profiles', match: { id: target.id }, set: { is_active: active } },
    { op: 'insert', table: 'credential_events', row: { org_id: ctx.orgId, target_profile_id: target.id, actor_profile_id: ctx.userId, event: active ? 'account_enabled' : 'account_disabled' } },
    auditOp(ctx.orgId, ctx.userId, ctx.person.id, active ? 'account.enable' : 'account.disable', 'profile', target.id, { is_active: target.is_active }, { is_active: active }),
  ])
  return json(200, { ok: true, message: active ? 'Account enabled' : 'Account disabled and signed out' })
}

export async function updateAccount(req: ApiRequest) {
  const ctx = await requireUser(req)
  requireRole(ctx, 'coordinator')
  const b = bodyOf(req)
  const target = await manageable(ctx, str(b, 'profileId'))
  const set: Record<string, unknown> = {}
  if (b.fullName !== undefined) set.full_name = str(b, 'fullName', { max: 120 })
  if (b.timezone !== undefined) set.timezone = checkTimezone(str(b, 'timezone', { max: 64 }))
  const ops: Op[] = []
  if (b.role !== undefined) {
    const role = str(b, 'role') as AppRole
    if (!['member', 'team_lead', 'coordinator'].includes(role)) throw bad('Unknown role')
    if (target.id === ctx.userId && role !== 'coordinator') throw bad('You cannot remove your own coordinator role')
    if (target.role === 'coordinator' && role !== 'coordinator') {
      const { count } = await admin().from('profiles').select('id', { count: 'exact', head: true }).eq('org_id', ctx.orgId).eq('role', 'coordinator').eq('is_active', true)
      if ((count ?? 0) <= 1) throw conflict('This is the last coordinator')
    }
    set.role = role
    ops.push({ op: 'update', table: 'external_people', match: { org_id: ctx.orgId, external_id: target.person_id }, set: { role: role === 'member' ? 'member' : 'coordinator' } })
    ops.push({ op: 'insert', table: 'credential_events', row: { org_id: ctx.orgId, target_profile_id: target.id, actor_profile_id: ctx.userId, event: 'role_changed', details: { from: target.role, to: role } } })
  }
  if (Object.keys(set).length === 0) throw bad('Nothing to change')
  await applyOps([
    { op: 'update', table: 'profiles', match: { id: target.id }, set },
    ...ops,
    auditOp(ctx.orgId, ctx.userId, ctx.person.id, 'account.update', 'profile', target.id, { role: target.role, full_name: target.full_name, timezone: target.timezone }, set),
  ])
  return json(200, { ok: true, message: 'Account updated' })
}

/** Points an account at an imported person, so tasks owned by that person become this account's tasks. */
export async function linkPerson(req: ApiRequest) {
  const ctx = await requireUser(req)
  requireRole(ctx, 'coordinator')
  const b = bodyOf(req)
  const target = await manageable(ctx, str(b, 'profileId'))
  const externalId = str(b, 'externalId', { max: 80 })
  const { data: person } = await admin().from('external_people').select('linked_profile_id').eq('org_id', ctx.orgId).eq('external_id', externalId).maybeSingle()
  if (!person) throw notFound('Person not found')
  if (person.linked_profile_id && person.linked_profile_id !== target.id) throw conflict('That person is linked to another account')
  await applyOps([
    { op: 'update', table: 'external_people', match: { org_id: ctx.orgId, external_id: target.person_id }, set: { linked_profile_id: null } },
    { op: 'update', table: 'profiles', match: { id: target.id }, set: { person_id: externalId } },
    { op: 'update', table: 'external_people', match: { org_id: ctx.orgId, external_id: externalId }, set: { linked_profile_id: target.id, role: target.role === 'member' ? 'member' : 'coordinator' } },
    auditOp(ctx.orgId, ctx.userId, ctx.person.id, 'account.link_person', 'profile', target.id, { person: target.person_id }, { person: externalId }),
  ])
  return json(200, { ok: true, message: 'Account linked. Their tasks now show on their dashboard.' })
}

export async function saveTeam(req: ApiRequest) {
  const ctx = await requireUser(req)
  requireRole(ctx, 'coordinator')
  const b = bodyOf(req)
  const teamKey = str(b, 'teamKey', { max: 40 }).toLowerCase()
  if (!/^[a-z0-9][a-z0-9_-]{0,39}$/.test(teamKey)) throw bad('Team ids use lowercase letters, numbers, dashes or underscores')
  const name = str(b, 'name', { max: 80 })
  const description = str(b, 'description', { max: 500, optional: true }) || null
  const lead = str(b, 'leadProfileId', { optional: true }) || null
  if (lead) {
    const target = await manageable(ctx, lead)
    if (target.role !== 'team_lead' && target.role !== 'coordinator') throw bad('The lead must be a team lead or coordinator')
  }
  const { data: existing } = await admin().from('teams').select('id, name, lead_profile_id').eq('org_id', ctx.orgId).eq('team_key', teamKey).maybeSingle()
  const id = existing?.id ?? uuid()
  await applyOps([
    existing
      ? { op: 'update', table: 'teams', match: { id }, set: { name, description, lead_profile_id: lead } }
      : { op: 'insert', table: 'teams', row: { id, org_id: ctx.orgId, team_key: teamKey, name, description, lead_profile_id: lead, created_by: ctx.userId } },
    auditOp(ctx.orgId, ctx.userId, ctx.person.id, existing ? 'team.update' : 'team.create', 'team', teamKey, existing, { name, lead }),
    ...(lead && lead !== existing?.lead_profile_id
      ? notificationOps({ orgId: ctx.orgId, recipients: [lead], type: 'team_membership', title: `You now lead ${name}`, link: '/people', eventKey: `lead:${id}:${lead}` })
      : []),
  ])
  return json(200, { ok: true, message: existing ? 'Team updated' : 'Team created' })
}

export async function teamMembers(req: ApiRequest) {
  const ctx = await requireUser(req)
  requireRole(ctx, 'coordinator', 'team_lead')
  const b = bodyOf(req)
  const teamKey = str(b, 'teamKey', { max: 40 })
  if (ctx.role === 'team_lead' && !ctx.ledTeams.includes(teamKey)) throw forbidden('You can only change teams you lead')
  const { data: team } = await admin().from('teams').select('id, name').eq('org_id', ctx.orgId).eq('team_key', teamKey).maybeSingle()
  if (!team) throw notFound('Team not found')
  const list = (k: string) => (Array.isArray(b[k]) ? (b[k] as unknown[]).filter((x): x is string => typeof x === 'string') : [])
  const add = list('add')
  const remove = list('remove')
  for (const id of [...add, ...remove]) {
    const target = await manageable(ctx, id).catch(async (e) => {
      // Team leads may add any member of their organization to a team they lead
      if (ctx.role !== 'team_lead') throw e
      const { data } = await admin().from('profiles').select('id, role, org_id').eq('id', id).maybeSingle()
      if (!data || data.org_id !== ctx.orgId || data.role !== 'member') throw e
      return data
    })
    if (!target) throw notFound()
  }
  const ops: Op[] = [
    ...add.map((profileId): Op => ({ op: 'upsert', table: 'team_members', conflict: ['team_id', 'profile_id'], ignore_duplicates: true, row: { team_id: team.id, profile_id: profileId, added_by: ctx.userId }, returning: 'team_id' })),
    ...remove.map((profileId): Op => ({ op: 'delete', table: 'team_members', match: { team_id: team.id, profile_id: profileId } })),
    auditOp(ctx.orgId, ctx.userId, ctx.person.id, 'team.members', 'team', teamKey, null, { add, remove }),
    ...notificationOps({ orgId: ctx.orgId, recipients: add, type: 'team_membership', title: `You were added to ${team.name}`, link: '/team', eventKey: `team-add:${team.id}:${Date.now()}` }),
    ...notificationOps({ orgId: ctx.orgId, recipients: remove, type: 'team_membership', title: `You were removed from ${team.name}`, link: '/team', eventKey: `team-remove:${team.id}:${Date.now()}` }),
  ]
  await applyOps(ops)
  return json(200, { ok: true, message: 'Team updated' })
}
