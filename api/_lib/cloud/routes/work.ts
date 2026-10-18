import { approveDraft, canDecide, checkBeforeApproval, editDraft, rejectDraft, suppressDraft } from '../../../../src/engine'
import type { Commitment, DecisionType, Draft, HumanDecision, ManualTask, TaskProgress } from '../../../../src/engine/types'
import type { ApiRequest } from '../../handlers'
import { admin, applyOps, shortId, uuid, type Op } from '../admin'
import { canReview, engineRole, requireRole, requireUser, type Ctx } from '../context'
import { bad, bodyOf, conflict, forbidden, json, notFound, rateLimit, str } from '../http'
import { auditOp, deliverAfter, notificationOps, reviewerIds } from '../notify'
import { syncOrg } from '../sync'

const DECISIONS: DecisionType[] = [
  'mark_done', 'cancel', 'defer', 'reopen', 'reassign', 'change_deadline', 'resolve_review', 'set_progress', 'report_blocker',
  'resolve_blocker', 'submit_work', 'approve_submission', 'reject_submission', 'request_extension', 'decline_extension',
]
const PROGRESS: TaskProgress[] = ['not_started', 'in_progress', 'blocked', 'submitted']
const MAX_FILES_PER_SUBMISSION = 5

function isoOrNull(v: unknown, name: string): string | null {
  if (v === null || v === undefined || v === '') return null
  if (typeof v !== 'string' || Number.isNaN(Date.parse(v))) throw bad(`${name} must be a date`)
  return new Date(v).toISOString()
}

export async function taskRow(orgId: string, taskKey: string) {
  const { data } = await admin().from('tasks').select('id, task_key, team_key, owner_profile_id, owner_person, row_version, title').eq('org_id', orgId).eq('task_key', taskKey).maybeSingle()
  if (!data) throw notFound('Task not found')
  return data
}

/** Members act on their own tasks; coordinators everywhere; team leads review inside their teams. */
function decisionAllowed(ctx: Ctx, c: Commitment, type: DecisionType): boolean {
  const isOwner = c.ownerId === ctx.person.id
  if (ctx.role === 'team_lead' && !canReview(ctx, c.teamId)) return canDecide('member', type, isOwner)
  return canDecide(engineRole(ctx.role), type, isOwner)
}

export async function createTasks(req: ApiRequest) {
  const ctx = await requireUser(req)
  requireRole(ctx, 'coordinator', 'team_lead')
  const b = bodyOf(req)
  const title = str(b, 'title', { max: 300 })
  const ownerIds = Array.isArray(b.ownerIds) ? (b.ownerIds as unknown[]).filter((x): x is string => typeof x === 'string') : []
  if (ownerIds.length === 0 || ownerIds.length > 100) throw bad('Choose a person or a team')
  const dueAt = isoOrNull(b.dueAt, 'dueAt')
  const startAt = isoOrNull(b.startAt, 'startAt')
  if (startAt && dueAt && Date.parse(dueAt) < Date.parse(startAt)) throw bad('The end date must not be earlier than the start date')
  const description = str(b, 'description', { max: 4000, optional: true }) || null
  const priority = str(b, 'priority', { optional: true }) || 'normal'
  if (!['low', 'normal', 'high', 'critical'].includes(priority)) throw bad('Choose a priority: low, normal, high or critical')
  const teamId = str(b, 'teamId', { max: 40, optional: true }) || undefined
  const outcome = await syncOrg(ctx.orgId, ctx.userId, 'write')
  const people = new Map(outcome.input.dataset.people.map((p) => [p.id, p]))
  if (ownerIds.some((id) => !people.has(id))) throw bad('Choose people from this workspace')
  if (dueAt && Date.parse(dueAt) <= Date.parse(outcome.input.now)) throw bad('The deadline must be after the current evaluation time')
  if (ctx.role === 'team_lead' && ownerIds.some((id) => !ctx.ledTeams.includes(people.get(id)?.teamId ?? (teamId as string)))) {
    throw forbidden('Team leads assign work inside the teams they lead')
  }
  const groupKey = ownerIds.length > 1 ? shortId('group') : null
  const ops: Op[] = []
  for (const ownerId of ownerIds) {
    const manual: ManualTask = { id: shortId('task'), title, ownerId, requesterId: ctx.person.id, teamId: teamId ?? people.get(ownerId)?.teamId, dueAt, createdAt: outcome.input.now }
    const id = uuid()
    const ownerProfile = outcome.input.profileByPerson.get(ownerId) ?? null
    ops.push(
      {
        op: 'insert',
        table: 'tasks',
        row: { id, org_id: ctx.orgId, task_key: `c_${manual.id}`, source: 'manual', manual_task: manual, title, description, priority, owner_person: ownerId, owner_profile_id: ownerProfile, requester_person: ctx.person.id, team_key: manual.teamId ?? null, group_key: groupKey, start_at: startAt, due_at: dueAt, created_by: ctx.userId },
      },
      { op: 'insert', table: 'task_assignments', row: { org_id: ctx.orgId, task_id: id, assignee_person: ownerId, assignee_profile_id: ownerProfile, assigned_by: ctx.userId, reason: 'Assigned by hand' } },
      auditOp(ctx.orgId, ctx.userId, ctx.person.id, 'task.create', 'task', `c_${manual.id}`, null, manual),
      ...(ownerProfile ? notificationOps({ orgId: ctx.orgId, recipients: [ownerProfile], type: 'task_assigned', title: `New task: ${title}`, body: [startAt ? `Starts ${startAt}` : '', dueAt ? `Due ${dueAt}` : 'No deadline', description ?? ''].filter(Boolean).join(' · '), taskKey: `c_${manual.id}`, eventKey: `assign:${manual.id}`, skip: ctx.userId }) : []),
    )
  }
  await applyOps(ops)
  await syncOrg(ctx.orgId, ctx.userId, 'write')
  return json(201, { ok: true, message: ownerIds.length === 1 ? 'Task assigned' : `${ownerIds.length} tasks assigned` })
}

/** Every task workflow step: validated against a fresh engine run, written atomically with its projections, audit and notifications. */
export async function decide(req: ApiRequest) {
  const ctx = await requireUser(req)
  rateLimit(`decide:${ctx.userId}`, 120, 60_000)
  return decideAs(ctx, bodyOf(req))
}

/** The decision workflow for an already verified caller. The email automation calls it on behalf of the sender. */
export async function decideAs(ctx: Ctx, b: Record<string, unknown>) {
  const taskKey = str(b, 'taskKey', { max: 120 })
  const type = str(b, 'type') as DecisionType
  if (!DECISIONS.includes(type)) throw bad('Unknown action')
  const input = (b.input && typeof b.input === 'object' ? b.input : {}) as Record<string, unknown>
  const note = typeof input.note === 'string' ? input.note.trim().slice(0, 2000) : ''
  const expected = typeof b.expectedVersion === 'number' ? b.expectedVersion : undefined

  const outcome = await syncOrg(ctx.orgId, ctx.userId, 'write')
  const c = outcome.result.commitments.find((x) => x.id === taskKey)
  if (!c) throw notFound('Task not found')
  const task = await taskRow(ctx.orgId, taskKey)
  const canSee = ctx.role === 'coordinator' || task.owner_profile_id === ctx.userId || canReview(ctx, task.team_key)
  if (!canSee) throw notFound('Task not found')
  if (expected !== undefined && expected !== task.row_version) {
    throw conflict('This task changed since you opened it. The page now shows the latest version; check it and try again.', { currentVersion: task.row_version })
  }
  if (!decisionAllowed(ctx, c, type)) throw forbidden('Your role cannot do that on this task')

  const now = outcome.input.now
  const people = new Map(outcome.input.dataset.people.map((p) => [p.id, p]))
  const d: HumanDecision = { id: shortId('h'), commitmentId: taskKey, type, at: now, recordedAt: new Date().toISOString(), by: ctx.person.id, ...(note ? { note } : {}) }
  const ops: Op[] = []
  const ownerProfile = c.ownerId ? outcome.input.profileByPerson.get(c.ownerId) : undefined
  const reviewers = await reviewerIds(ctx.orgId, task.team_key)
  const notify = (recipients: (string | undefined)[], kind: string, title: string, body?: string) =>
    ops.push(...notificationOps({ orgId: ctx.orgId, recipients: recipients.filter((r): r is string => !!r), type: kind, title, body, taskKey, eventKey: `${d.id}:${kind}`, skip: ctx.userId }))

  switch (type) {
    case 'set_progress': {
      const progress = input.progress as TaskProgress
      if (!PROGRESS.includes(progress)) throw bad('Choose a progress value')
      d.progress = progress
      break
    }
    case 'report_blocker': {
      if (!note) throw bad('Describe the blocker')
      ops.push({ op: 'insert', table: 'blockers', row: { org_id: ctx.orgId, task_id: task.id, decision_key: d.id, reporter_profile_id: ctx.userId, reporter_person: ctx.person.id, description: note } })
      notify(reviewers, 'blocker_reported', `Blocker on ${c.title}`, note)
      break
    }
    case 'resolve_blocker':
      ops.push({ op: 'update', table: 'blockers', match: { task_id: task.id, status: 'open' }, set: { status: 'resolved', resolved_by: ctx.userId, resolved_at: new Date().toISOString() } })
      notify([ownerProfile], 'blocker_resolved', `Blocker resolved: ${c.title}`)
      break
    case 'submit_work': {
      const fileIds = Array.isArray(input.fileIds) ? (input.fileIds as unknown[]).filter((x): x is string => typeof x === 'string') : []
      if (fileIds.length > MAX_FILES_PER_SUBMISSION) throw bad(`Attach at most ${MAX_FILES_PER_SUBMISSION} files`)
      if (fileIds.length) {
        const { data: files } = await admin().from('files').select('id, uploader_profile_id, submission_key').eq('org_id', ctx.orgId).in('id', fileIds)
        if ((files ?? []).length !== fileIds.length || files!.some((f) => f.uploader_profile_id !== ctx.userId || f.submission_key)) throw bad('Attach files you uploaded for this submission')
      }
      d.submissionId = shortId('s')
      d.fileIds = fileIds
      ops.push({ op: 'insert', table: 'submissions', row: { org_id: ctx.orgId, task_id: task.id, submission_key: d.submissionId, submitter_profile_id: ctx.userId, submitter_person: ctx.person.id, note: note || null } })
      for (const id of fileIds) ops.push({ op: 'update', table: 'files', match: { id }, set: { task_id: task.id, submission_key: d.submissionId } })
      notify(reviewers, 'submission_received', `Work submitted: ${c.title}`, note || undefined)
      break
    }
    case 'approve_submission':
    case 'reject_submission': {
      const sub = c.submissions?.find((s) => s.id === input.submissionId && s.state === 'pending')
      if (!sub) throw conflict('That submission is not waiting for review any more')
      if (sub.by === ctx.person.id) throw forbidden('You cannot review your own work')
      if (type === 'reject_submission' && !note) throw bad('Say what needs to change before rejecting')
      d.submissionId = sub.id
      ops.push({ op: 'update', table: 'submissions', match: { org_id: ctx.orgId, submission_key: sub.id, status: 'pending' }, set: { status: type === 'approve_submission' ? 'approved' : 'rejected', reviewer_profile_id: ctx.userId, reviewed_at: new Date().toISOString(), review_note: note || null }, require_rows: true })
      notify([ownerProfile], type === 'approve_submission' ? 'submission_approved' : 'submission_rejected', type === 'approve_submission' ? `Work approved: ${c.title}` : `Changes requested: ${c.title}`, note || undefined)
      break
    }
    case 'request_extension': {
      const dueAt = isoOrNull(input.dueAt, 'dueAt')
      if (!dueAt || Date.parse(dueAt) <= Date.parse(now)) throw bad('Choose a new date after the current evaluation time')
      if (!note) throw bad('Say why you need more time')
      d.dueAt = dueAt
      ops.push({ op: 'insert', table: 'deadline_requests', row: { org_id: ctx.orgId, task_id: task.id, decision_key: d.id, requester_profile_id: ctx.userId, requester_person: ctx.person.id, proposed_due_at: dueAt, reason: note } })
      notify(reviewers, 'deadline_request', `More time requested: ${c.title}`, note)
      break
    }
    case 'decline_extension':
      ops.push({ op: 'update', table: 'deadline_requests', match: { task_id: task.id, status: 'pending' }, set: { status: 'declined', decided_by: ctx.userId, decided_at: new Date().toISOString(), decision_note: note || null } })
      notify([ownerProfile], 'deadline_decision', `Extension declined: ${c.title}`, note || undefined)
      break
    case 'change_deadline': {
      const dueAt = isoOrNull(input.dueAt, 'dueAt')
      d.dueAt = dueAt
      ops.push({ op: 'update', table: 'deadline_requests', match: { task_id: task.id, status: 'pending' }, set: { status: 'approved', decided_by: ctx.userId, decided_at: new Date().toISOString(), decision_note: note || null } })
      notify([ownerProfile], 'deadline_changed', `Deadline changed: ${c.title}`, dueAt ? `New deadline ${dueAt}` : 'Deadline removed')
      break
    }
    case 'reassign': {
      const ownerId = typeof input.ownerId === 'string' ? input.ownerId : ''
      if (!people.has(ownerId)) throw bad('Choose the new owner from this workspace')
      if (ownerId === c.ownerId) throw bad('That person already owns this task')
      if (!note) throw bad('Give a reason for reassigning')
      d.ownerId = ownerId
      const submission = c.submissions?.find((s) => s.state === 'pending')
      if (submission) ops.push({ op: 'update', table: 'submissions', match: { org_id: ctx.orgId, submission_key: submission.id }, set: { status: 'reassigned', reassigned_to_person: ownerId, reviewer_profile_id: ctx.userId, reviewed_at: new Date().toISOString(), review_note: note } })
      notify([outcome.input.profileByPerson.get(ownerId)], 'task_assigned', `Task assigned to you: ${c.title}`, note)
      notify([ownerProfile], 'task_removed', `Task reassigned: ${c.title}`, note)
      break
    }
    case 'mark_done':
    case 'cancel':
    case 'defer':
    case 'reopen':
    case 'resolve_review': {
      if (type !== 'resolve_review' && type !== 'mark_done' && !note) throw bad('Give a reason')
      if (type === 'reopen' && c.status === 'open') throw conflict('This task is already open')
      if ((type === 'cancel' || type === 'defer' || type === 'mark_done') && c.status !== 'open') throw conflict(`This task is already ${c.status}`)
      const label = { mark_done: 'marked done', cancel: 'cancelled', defer: 'deferred', reopen: 'reopened', resolve_review: 'reviewed' }[type]
      notify([ownerProfile], `task_${type}`, `Task ${label}: ${c.title}`, note || undefined)
      break
    }
  }

  ops.unshift({ op: 'insert', table: 'human_decisions', row: { org_id: ctx.orgId, decision_key: d.id, task_key: taskKey, type, at: d.at, recorded_at: d.recordedAt, by_person: ctx.person.id, by_profile_id: ctx.userId, payload: d } })
  // Bumping the task version makes concurrent edits from stale pages fail instead of overwriting
  ops.push({ op: 'update', table: 'tasks', match: { id: task.id, row_version: task.row_version }, set: { row_version: task.row_version + 1 }, require_rows: true })
  ops.push(auditOp(ctx.orgId, ctx.userId, ctx.person.id, `decision.${type}`, 'task', taskKey, { status: c.status, ownerId: c.ownerId, dueAt: c.deadline.dueAt }, d))
  await applyOps(ops)
  await syncOrg(ctx.orgId, ctx.userId, 'write')
  return json(200, { ok: true, message: 'Saved' })
}

const DRAFT_ACTIONS = ['confirm', 'unconfirm', 'approve', 'reject', 'edit'] as const

/** Reminder review. Approval re-checks freshness against a fresh engine run; approved reminders become in-app notifications only. */
export async function draftAction(req: ApiRequest) {
  const ctx = await requireUser(req)
  requireRole(ctx, 'coordinator', 'team_lead')
  const b = bodyOf(req)
  const draftKey = str(b, 'draftKey', { max: 140 })
  const action = str(b, 'action') as (typeof DRAFT_ACTIONS)[number]
  if (!DRAFT_ACTIONS.includes(action)) throw bad('Unknown draft action')
  const expected = typeof b.expectedVersion === 'number' ? b.expectedVersion : undefined

  const outcome = await syncOrg(ctx.orgId, ctx.userId, 'write')
  const draft = outcome.result.drafts.find((d) => d.id === draftKey)
  if (!draft) throw notFound('Draft not found')
  const c = outcome.result.commitments.find((x) => x.id === draft.commitmentId)
  if (!canReview(ctx, c?.teamId)) throw forbidden('You can review drafts for your own teams only')
  const { data: stored } = await admin().from('reminder_drafts').select('id, row_version').eq('org_id', ctx.orgId).eq('draft_key', draftKey).single()
  if (expected !== undefined && expected !== draft.version) throw conflict('This draft changed since you opened it. Review the new version.', { currentVersion: draft.version })

  const now = outcome.input.now
  let next: Draft
  let message = 'Saved'
  const extra: Op[] = []
  switch (action) {
    case 'confirm':
    case 'unconfirm':
      next = { ...draft, recipientConfirmed: action === 'confirm' }
      message = action === 'confirm' ? 'Recipient confirmed' : 'Confirmation removed'
      break
    case 'reject': {
      if (draft.state !== 'pending_review') throw conflict(`Draft is ${draft.state.replace('_', ' ')}, not waiting for review`)
      next = rejectDraft(draft, ctx.person.id, now, str(b, 'reason', { max: 1000 }))
      message = 'Draft rejected'
      break
    }
    case 'edit':
      try {
        next = editDraft(draft, ctx.person.id, now, str(b, 'body', { max: 2000 }))
      } catch (e) {
        throw bad((e as Error).message)
      }
      // Edits are kept on the draft until the engine writes a new version; the audit log records each edit
      message = 'Draft text saved'
      break
    case 'approve': {
      const people = new Map(outcome.input.dataset.people.map((p) => [p.id, p]))
      const check = checkBeforeApproval(draft, c, outcome.input.config, people)
      if (check.suppressWith) {
        next = suppressDraft(draft, check.suppressWith, now)
        await writeDraft(ctx, stored!, next, 'draft.suppress_on_approval', draft, [])
        throw conflict(`Suppressed instead of approved: ${check.blockers[0].message}`)
      }
      if (!check.ok) throw conflict(check.blockers.map((x) => x.message).join('. '))
      next = approveDraft(draft, ctx.person.id, now)
      // In-app delivery only, held until quiet hours end in the recipient's timezone
      const recipientProfile = draft.recipientId ? outcome.input.profileByPerson.get(draft.recipientId) : undefined
      const tz = (draft.recipientId && people.get(draft.recipientId)?.timezone) || 'UTC'
      const when = new Date(deliverAfter(Date.now(), tz, outcome.input.settings.quietHours, outcome.input.settings.skipWeekends)).toISOString()
      if (recipientProfile) {
        extra.push(
          ...notificationOps({ orgId: ctx.orgId, recipients: [recipientProfile], type: 'reminder', title: draft.subject ?? `Reminder: ${c?.title ?? ''}`, body: draft.editedBody ?? draft.body, taskKey: draft.commitmentId, eventKey: `reminder:${draft.id}:v${draft.version}`, deliverAfter: when }),
          { op: 'update', table: 'reminder_drafts', match: { id: stored!.id }, set: { delivered_at: when, delivery: { channel: 'in_app', deliverAfter: when } } },
        )
        message = when > new Date().toISOString() ? `Approved. The in-app reminder appears at ${when} (after quiet hours). Nothing is sent outside FollowThru.` : 'Approved and delivered in the app. Nothing is sent outside FollowThru.'
      } else {
        extra.push({ op: 'update', table: 'reminder_drafts', match: { id: stored!.id }, set: { delivery: { channel: 'none', reason: 'recipient has no FollowThru account' } } })
        message = 'Approved (shadow). The recipient has no FollowThru account, so nothing was delivered.'
      }
      break
    }
  }
  await writeDraft(ctx, stored!, next!, `draft.${action}`, draft, extra)
  return json(200, { ok: true, message })
}

async function writeDraft(ctx: Ctx, stored: { id: string; row_version: number }, next: Draft, action: string, before: Draft, extra: Op[]) {
  await applyOps([
    {
      op: 'update',
      table: 'reminder_drafts',
      match: { id: stored.id, row_version: stored.row_version },
      set: {
        state: next.state,
        recipient_confirmed: next.recipientConfirmed,
        body: next.editedBody ?? next.body,
        approved_by_person: next.approvedBy ?? null,
        approved_at: next.approvedAt ?? null,
        snapshot: next,
        row_version: stored.row_version + 1,
      },
      require_rows: true,
    },
    ...(next.suppression && next.suppression !== before.suppression
      ? ([{ op: 'upsert', table: 'suppressions', conflict: ['draft_id', 'reason', 'at'], ignore_duplicates: true, row: { org_id: ctx.orgId, task_key: next.commitmentId, draft_id: stored.id, reason: next.suppression.reason, at: next.suppression.at } }] as Op[])
      : []),
    ...extra,
    auditOp(ctx.orgId, ctx.userId, ctx.person.id, action, 'draft', next.id, { state: before.state, version: before.version, recipientConfirmed: before.recipientConfirmed }, {
      state: next.state,
      version: next.version,
      recipientConfirmed: next.recipientConfirmed,
      suppression: next.suppression?.reason,
      rejectReason: next.rejectReason,
      edited: next.editedBody !== undefined,
    }),
  ])
}

// ---------------------------------------------------------------------------
// Comments with @mentions
// ---------------------------------------------------------------------------

export async function readableTask(ctx: Ctx, taskKey: string) {
  const task = await taskRow(ctx.orgId, taskKey)
  if (!(ctx.role === 'coordinator' || task.owner_profile_id === ctx.userId || canReview(ctx, task.team_key))) throw notFound('Task not found')
  return task
}

export async function addComment(req: ApiRequest) {
  const ctx = await requireUser(req)
  rateLimit(`comment:${ctx.userId}`, 60, 60_000)
  const b = bodyOf(req)
  const task = await readableTask(ctx, str(b, 'taskKey', { max: 120 }))
  const body = str(b, 'body', { max: 4000 })
  const handles = [...new Set([...body.matchAll(/@([a-z0-9][a-z0-9._-]{2,31})/gi)].map((m) => m[1].toLowerCase()))]
  const { data: mentioned } = handles.length ? await admin().from('profiles').select('id').eq('org_id', ctx.orgId).eq('is_active', true).in('username', handles) : { data: [] }
  const mentionIds = (mentioned ?? []).map((m) => m.id as string)
  const id = uuid()
  await applyOps([
    { op: 'insert', table: 'comments', row: { id, org_id: ctx.orgId, task_id: task.id, author_profile_id: ctx.userId, body, mentions: mentionIds } },
    auditOp(ctx.orgId, ctx.userId, ctx.person.id, 'comment.add', 'task', task.task_key, null, { commentId: id, mentions: mentionIds.length }),
    ...notificationOps({ orgId: ctx.orgId, recipients: mentionIds, type: 'mention', title: `${ctx.profile.full_name} mentioned you on ${task.title}`, body: body.slice(0, 300), taskKey: task.task_key, eventKey: `mention:${id}`, skip: ctx.userId }),
    ...notificationOps({ orgId: ctx.orgId, recipients: [task.owner_profile_id].filter((x): x is string => !!x && !mentionIds.includes(x)), type: 'comment', title: `New comment on ${task.title}`, body: body.slice(0, 300), taskKey: task.task_key, eventKey: `comment:${id}`, skip: ctx.userId }),
  ])
  return json(201, { ok: true, message: 'Comment added' })
}

/** Authors may edit or delete their own comments for 15 minutes; deletion is soft. */
async function ownComment(ctx: Ctx, id: string) {
  const { data } = await admin().from('comments').select('id, org_id, author_profile_id, created_at, deleted_at, task_id').eq('id', id).maybeSingle()
  if (!data || data.org_id !== ctx.orgId || data.deleted_at) throw notFound('Comment not found')
  if (data.author_profile_id !== ctx.userId) throw forbidden('You can only change your own comments')
  if (Date.now() - Date.parse(data.created_at) > 15 * 60_000) throw conflict('Comments can be changed for 15 minutes after posting')
  return data
}

export async function editComment(req: ApiRequest) {
  const ctx = await requireUser(req)
  const b = bodyOf(req)
  const c = await ownComment(ctx, str(b, 'id'))
  await applyOps([
    { op: 'update', table: 'comments', match: { id: c.id }, set: { body: str(b, 'body', { max: 4000 }), edited_at: new Date().toISOString() } },
    auditOp(ctx.orgId, ctx.userId, ctx.person.id, 'comment.edit', 'comment', c.id),
  ])
  return json(200, { ok: true, message: 'Comment updated' })
}

export async function deleteComment(req: ApiRequest) {
  const ctx = await requireUser(req)
  const c = await ownComment(ctx, str(bodyOf(req), 'id'))
  await applyOps([
    { op: 'update', table: 'comments', match: { id: c.id }, set: { deleted_at: new Date().toISOString() } },
    auditOp(ctx.orgId, ctx.userId, ctx.person.id, 'comment.delete', 'comment', c.id),
  ])
  return json(200, { ok: true, message: 'Comment deleted' })
}
