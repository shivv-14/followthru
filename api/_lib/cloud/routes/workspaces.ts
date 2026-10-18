import type { ApiRequest } from '../../handlers'
import { admin, applyOps, uuid, type Op } from '../admin'
import { requireRole, requireUser } from '../context'
import { bad, bodyOf, conflict, json, notFound, rateLimit, str } from '../http'
import { auditOp, notificationOps, reviewerIds } from '../notify'
import { syncOrg } from '../sync'

/** Workspaces a signed-in person can discover, with their own membership or request status for each. */
export async function listWorkspaces(req: ApiRequest) {
  const ctx = await requireUser(req, { allowNoWorkspace: true })
  const [{ data: orgs }, { data: requests }, { data: coordinators }] = await Promise.all([
    admin().from('organizations').select('id, name, description, created_at').eq('discoverable', true).order('name').limit(200),
    admin().from('join_requests').select('id, org_id, status, created_at, decided_at, decision_reason').eq('profile_id', ctx.userId).order('created_at', { ascending: false }),
    admin().from('profiles').select('org_id, full_name').eq('role', 'coordinator').eq('is_active', true),
  ])
  const latest = new Map<string, NonNullable<typeof requests>[number]>()
  for (const r of requests ?? []) if (!latest.has(r.org_id)) latest.set(r.org_id, r)
  return json(200, {
    current: ctx.orgId || null,
    workspaces: (orgs ?? []).map((o) => {
      const r = latest.get(o.id)
      return {
        id: o.id,
        name: o.name,
        description: o.description,
        coordinators: (coordinators ?? []).filter((c) => c.org_id === o.id).map((c) => c.full_name),
        status: ctx.orgId === o.id ? 'member' : (r?.status ?? 'none'),
        requestedAt: r?.created_at ?? null,
        decidedAt: r?.decided_at ?? null,
        reason: r?.decision_reason ?? null,
      }
    }),
  })
}

/** A team member asks to join. Saved, the workspace's coordinators are notified, and the request waits for approval. */
export async function requestToJoin(req: ApiRequest) {
  const ctx = await requireUser(req, { allowNoWorkspace: true })
  rateLimit(`join:${ctx.userId}`, 20, 60 * 60_000)
  const b = bodyOf(req)
  const orgId = str(b, 'orgId', { max: 40 })
  const message = str(b, 'message', { max: 500, optional: true }) || null
  if (ctx.orgId === orgId) throw conflict('You are already a member of this workspace')
  if (ctx.orgId) throw conflict('You already belong to a workspace. One account works in one workspace at a time.')
  const { data: org } = await admin().from('organizations').select('id, name, discoverable').eq('id', orgId).maybeSingle()
  if (!org || !org.discoverable) throw notFound('Workspace not found')
  const { data: pending } = await admin().from('join_requests').select('id').eq('org_id', orgId).eq('profile_id', ctx.userId).eq('status', 'pending').maybeSingle()
  if (pending) throw conflict('Your request is already waiting for approval')
  const id = uuid()
  await applyOps([
    { op: 'insert', table: 'join_requests', row: { id, org_id: orgId, profile_id: ctx.userId, message } },
    auditOp(orgId, ctx.userId, null, 'workspace.join_request', 'join_request', id, null, { username: ctx.profile.username, message }, ctx.userId),
    ...notificationOps({
      orgId,
      recipients: await reviewerIds(orgId, null),
      type: 'join_request',
      title: `${ctx.profile.full_name} (@${ctx.profile.username}) asked to join ${org.name}`,
      body: message ?? undefined,
      link: '/people',
      eventKey: `join:${id}`,
    }),
  ])
  return json(201, { ok: true, message: `Request sent to ${org.name}. You will see the answer here.` })
}

/** Join requests for the coordinator's workspace, newest first. */
export async function listJoinRequests(req: ApiRequest) {
  const ctx = await requireUser(req)
  requireRole(ctx, 'coordinator', 'team_lead')
  const { data } = await admin()
    .from('join_requests')
    .select('id, status, message, created_at, decided_at, decision_reason, profiles!join_requests_profile_id_fkey(full_name, username, timezone)')
    .eq('org_id', ctx.orgId)
    .order('created_at', { ascending: false })
    .limit(100)
  return json(200, { requests: data ?? [] })
}

/** Approve or reject. Approval makes the person a member of this workspace in one transaction. */
export async function decideJoinRequest(req: ApiRequest) {
  const ctx = await requireUser(req)
  requireRole(ctx, 'coordinator', 'team_lead')
  const b = bodyOf(req)
  const approve = b.approve === true
  const reason = str(b, 'reason', { max: 500, optional: true }) || null
  const { data: r } = await admin().from('join_requests').select('id, org_id, profile_id, status').eq('id', str(b, 'requestId', { max: 40 })).maybeSingle()
  if (!r || r.org_id !== ctx.orgId) throw notFound('Request not found')
  if (r.status !== 'pending') throw conflict(`This request was already ${r.status}`)
  if (!approve && !reason) throw bad('Give a short reason for rejecting')
  const { data: person } = await admin().from('profiles').select('id, org_id, full_name, username, timezone, person_id').eq('id', r.profile_id).single()
  if (!person) throw notFound('That account no longer exists')
  if (approve && person.org_id) throw conflict('That person already joined another workspace')
  const { data: org } = await admin().from('organizations').select('name').eq('id', ctx.orgId).single()
  const now = new Date().toISOString()
  const ops: Op[] = [
    { op: 'update', table: 'join_requests', match: { id: r.id, status: 'pending' }, set: { status: approve ? 'approved' : 'rejected', decided_by: ctx.userId, decided_at: now, decision_reason: reason }, require_rows: true },
    auditOp(ctx.orgId, ctx.userId, ctx.person.id, approve ? 'workspace.join_approved' : 'workspace.join_rejected', 'join_request', r.id, { status: 'pending' }, { status: approve ? 'approved' : 'rejected', reason }, person.id),
  ]
  if (approve) {
    ops.push(
      { op: 'insert', table: 'external_people', row: { org_id: ctx.orgId, external_id: person.person_id, name: person.full_name, timezone: person.timezone, role: 'member', linked_profile_id: null } },
      { op: 'update', table: 'profiles', match: { id: person.id, org_id: null }, set: { org_id: ctx.orgId }, require_rows: true },
      { op: 'update', table: 'external_people', match: { org_id: ctx.orgId, external_id: person.person_id }, set: { linked_profile_id: person.id } },
      ...notificationOps({ orgId: ctx.orgId, recipients: [person.id], type: 'join_approved', title: `You joined ${org?.name ?? 'the workspace'}`, body: 'Your tasks appear on your dashboard.', link: '/dashboard', eventKey: `join-approved:${r.id}` }),
    )
  }
  await applyOps(ops)
  if (approve) await syncOrg(ctx.orgId, ctx.userId, 'write')
  return json(200, { ok: true, message: approve ? `${person.full_name} joined the workspace` : 'Request rejected' })
}

const EXPERIMENT_FIELDS = ['commitment_key', 'intended_recipient', 'person_approached', 'approached_at', 'reminder_text', 'decision', 'delivery', 'response', 'response_at', 'useful', 'progressed', 'minutes_saved', 'false_reminder', 'notes'] as const

export async function listExperiments(req: ApiRequest) {
  const ctx = await requireUser(req)
  requireRole(ctx, 'coordinator', 'team_lead')
  const { data } = await admin().from('growth_experiments').select('*').eq('org_id', ctx.orgId).order('slot')
  return json(200, { rows: data ?? [] })
}

/** Saves one of the ten experiment rows exactly as entered; nothing is filled in automatically. */
export async function saveExperiment(req: ApiRequest) {
  const ctx = await requireUser(req)
  requireRole(ctx, 'coordinator', 'team_lead')
  const b = bodyOf(req)
  const slot = Number(b.slot)
  if (!Number.isInteger(slot) || slot < 1 || slot > 10) throw bad('Choose a row from 1 to 10')
  const values = (b.values && typeof b.values === 'object' ? b.values : {}) as Record<string, unknown>
  const row: Record<string, unknown> = { org_id: ctx.orgId, slot, updated_by: ctx.userId }
  for (const k of EXPERIMENT_FIELDS) {
    if (!(k in values)) continue
    const v = values[k]
    if (v !== null && !['string', 'number', 'boolean'].includes(typeof v)) throw bad(`${k} has an invalid value`)
    row[k] = v === '' ? null : v
  }
  for (const k of ['approached_at', 'response_at'] as const) {
    if (row[k] && Number.isNaN(Date.parse(String(row[k])))) throw bad(`${k} must be a date and time`)
  }
  if (row.decision && !['pending', 'approved', 'rejected'].includes(String(row.decision))) throw bad('Unknown decision')
  if (row.delivery && !['not_sent', 'shown_in_app', 'sent'].includes(String(row.delivery))) throw bad('Unknown delivery')
  await applyOps([
    { op: 'upsert', table: 'growth_experiments', conflict: ['org_id', 'slot'], row },
    auditOp(ctx.orgId, ctx.userId, ctx.person.id, 'experiment.save', 'data', `experiment-${slot}`, null, row),
  ])
  return json(200, { ok: true, message: `Row ${slot} saved` })
}

