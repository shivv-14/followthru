import { runEngine } from '../../../src/engine'
import { deadlineState } from '../../../src/engine/deadline'
import type { Commitment, Draft, EngineResult } from '../../../src/engine/types'
import { VERSION } from '../handlers'
import { applyOps, sha256, uuid, type Op } from './admin'
import { HttpError } from './http'
import { loadOrgInput, type OrgInput } from './orgData'

export type SyncTrigger = 'login' | 'interval' | 'manual' | 'write' | 'import'

export interface SyncOutcome {
  input: OrgInput
  result: EngineResult
  changed: { tasks: number; drafts: number; events: number }
}

/** Stored task status: overdue is derived from the deadline at evaluation time, in_progress from the owner's progress. */
export function taskStatus(c: Commitment, now: string): string {
  if (c.status !== 'open') return c.status
  if (deadlineState(c.deadline, now) === 'overdue') return 'overdue'
  return c.progress && c.progress !== 'not_started' ? 'in_progress' : 'open'
}

export function reviewState(c: Commitment): string {
  const last = c.submissions?.at(-1)
  if (!last) return 'none'
  return last.state === 'pending' ? 'submitted' : last.state
}

function taskColumns(c: Commitment, input: OrgInput) {
  const closed = [...c.events].reverse().find((e) => e.type === 'completed')
  return {
    title: c.title.slice(0, 300),
    owner_person: c.ownerId,
    owner_profile_id: (c.ownerId && input.profileByPerson.get(c.ownerId)) || null,
    requester_person: c.requesterId,
    team_key: c.teamId ?? null,
    due_at: c.deadline.dueAt,
    timezone: c.deadline.interpretedTz,
    deadline_certainty: c.deadline.certainty,
    deadline_phrase: c.deadline.phrase || null,
    status: taskStatus(c, input.now),
    review_state: reviewState(c),
    response_state: c.responseState,
    needs_review: c.needsReview,
    review_reasons: c.reviewReasons,
    extraction_method: 'rules',
    thread_ids: c.threadIds,
    completed_at: c.status === 'done' ? (closed?.at ?? null) : null,
    snapshot: c,
  }
}

function draftColumns(d: Draft, taskId: string | undefined) {
  return {
    draft_key: d.id,
    task_key: d.commitmentId,
    task_id: taskId ?? null,
    kind: d.kind,
    recipient_person: d.recipientId,
    recipient_confirmed: d.recipientConfirmed,
    subject: d.subject ?? null,
    body: d.editedBody ?? d.body,
    flow_key: d.flowId ?? null,
    stage: d.step ?? null,
    state: d.state,
    version: d.version,
    evidence: d.suppression?.evidence ?? null,
    approved_by_person: d.approvedBy ?? null,
    approved_at: d.approvedAt ?? null,
    snapshot: d,
  }
}

/** JSON with object keys sorted and undefined dropped: Postgres jsonb reorders keys, so plain JSON.stringify cannot compare stored and fresh values. */
export function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map((x) => (x === undefined ? 'null' : canonical(x))).join(',')}]`
  if (v && typeof v === 'object') {
    return `{${Object.keys(v as Record<string, unknown>)
      .filter((k) => (v as Record<string, unknown>)[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`)
      .join(',')}}`
  }
  return JSON.stringify(v)
}

const same = (a: unknown, b: unknown) => canonical(a) === canonical(b)

/** Builds the change set that makes the database match one engine run. Pure, so it is unit-tested. */
export function buildSyncOps(input: OrgInput, result: EngineResult, actorProfileId: string | null): { ops: Op[]; changed: SyncOutcome['changed']; taskIds: Map<string, string> } {
  const ops: Op[] = []
  const changed = { tasks: 0, drafts: 0, events: 0 }
  const stored = new Map(input.tasks.map((t) => [t.task_key, t]))
  const taskIds = new Map(input.tasks.map((t) => [t.task_key, t.id]))
  const at = new Date().toISOString()

  for (const c of result.commitments) {
    const cols = taskColumns(c, input)
    const prev = stored.get(c.id)
    if (!prev) {
      const id = uuid()
      taskIds.set(c.id, id)
      ops.push({ op: 'insert', table: 'tasks', row: { id, org_id: input.orgId, task_key: c.id, source: 'conversation', ...cols } })
      if (c.ownerId) ops.push({ op: 'insert', table: 'task_assignments', row: { org_id: input.orgId, task_id: id, assignee_person: c.ownerId, assignee_profile_id: cols.owner_profile_id, reason: 'Owner found in conversation' } })
      changed.tasks++
    } else if (!same(prev.snapshot, c) || prev.status !== cols.status || prev.owner_profile_id !== cols.owner_profile_id) {
      ops.push({ op: 'update', table: 'tasks', match: { id: prev.id, row_version: prev.row_version }, set: { ...cols, row_version: prev.row_version + 1 }, require_rows: true })
      if (prev.owner_person !== c.ownerId) {
        ops.push({ op: 'update', table: 'task_assignments', match: { task_id: prev.id, ended_at: null }, set: { ended_at: at } })
        if (c.ownerId) ops.push({ op: 'insert', table: 'task_assignments', row: { org_id: input.orgId, task_id: prev.id, assignee_person: c.ownerId, assignee_profile_id: cols.owner_profile_id, reason: 'Owner changed' } })
      }
      changed.tasks++
    }
    const taskId = taskIds.get(c.id)!
    for (const e of c.events) {
      // Same event, same key: repeated runs never duplicate history
      const key = sha256(JSON.stringify([c.id, e.type, e.at, e.by, e.evidence?.rule ?? '', e.to ?? '', e.evidence?.messageId ?? '']))
      ops.push({
        op: 'upsert',
        table: 'task_events',
        conflict: ['org_id', 'event_key'],
        ignore_duplicates: true,
        row: {
          org_id: input.orgId,
          task_id: taskId,
          event_key: key,
          event_type: e.type,
          actor_person: e.by,
          actor_profile_id: input.profileByPerson.get(e.by) ?? null,
          at: e.at,
          message_external_id: e.evidence?.messageId ?? null,
          thread_external_id: e.evidence?.threadId ?? null,
          evidence: e.evidence ?? null,
          rule: e.evidence?.rule ?? null,
          metadata: { from: e.from ?? null, to: e.to ?? null },
        },
      })
    }
  }

  const storedDrafts = new Map(input.drafts.map((d) => [d.draft_key, d]))
  const keep = new Set(result.drafts.map((d) => d.id))
  for (const d of result.drafts) {
    const prev = storedDrafts.get(d.id)
    const cols = draftColumns(d, taskIds.get(d.commitmentId))
    let draftId = prev?.id
    if (!prev) {
      draftId = uuid()
      ops.push({ op: 'insert', table: 'reminder_drafts', row: { id: draftId, org_id: input.orgId, ...cols } })
      changed.drafts++
    } else if (!same(prev.snapshot, d)) {
      ops.push({ op: 'update', table: 'reminder_drafts', match: { id: prev.id, row_version: prev.row_version }, set: { ...cols, row_version: prev.row_version + 1 }, require_rows: true })
      changed.drafts++
    } else continue
    for (const v of d.history) {
      if (prev && v.version <= prev.version) continue
      ops.push({
        op: 'upsert',
        table: 'reminder_draft_versions',
        conflict: ['draft_id', 'version'],
        ignore_duplicates: true,
        row: { org_id: input.orgId, draft_id: draftId, version: v.version, change_note: v.cause, subject: v.subject ?? null, body: v.body, recipient_person: v.recipientId, editor_profile_id: actorProfileId },
      })
    }
    if (d.suppression) {
      ops.push({
        op: 'upsert',
        table: 'suppressions',
        conflict: ['draft_id', 'reason', 'at'],
        ignore_duplicates: true,
        row: { org_id: input.orgId, task_key: d.commitmentId, draft_id: draftId, reason: d.suppression.reason, evidence: d.suppression.evidence ?? null, at: d.suppression.at },
      })
    }
  }
  // Drafts whose commitment left the data (for example after a data reset)
  for (const prev of input.drafts) {
    if (!keep.has(prev.draft_key)) {
      ops.push({ op: 'delete', table: 'reminder_drafts', match: { id: prev.id, row_version: prev.row_version } })
      changed.drafts++
    }
  }
  changed.events = ops.filter((o) => o.table === 'task_events').length
  return { ops, changed, taskIds }
}

/**
 * Runs the engine for one organization and saves the result. Human approvals, rejections and
 * edits live in the stored drafts, which the engine keeps; a concurrent change makes the
 * optimistic version check fail, and the run is simply repeated on fresh data.
 */
export async function syncOrg(orgId: string, actorProfileId: string | null, trigger: SyncTrigger): Promise<SyncOutcome> {
  for (let attempt = 0; ; attempt++) {
    const started = Date.now()
    const input = await loadOrgInput(orgId)
    const result = runEngine({ dataset: input.dataset, decisions: input.decisions, manualTasks: input.manualTasks, previousDrafts: input.drafts.map((d) => d.snapshot) }, input.config)
    const { ops, changed } = buildSyncOps(input, result, actorProfileId)
    const writes = ops.filter((o) => o.table !== 'task_events' || changed.tasks > 0)
    const hasChanges = changed.tasks > 0 || changed.drafts > 0
    if (hasChanges || trigger !== 'interval') {
      writes.push({
        op: 'insert',
        table: 'engine_runs',
        row: {
          org_id: orgId,
          actor_profile_id: actorProfileId,
          trigger,
          evaluated_at: input.now,
          flags: input.settings.flags,
          extractor: result.mode,
          engine_version: VERSION,
          result_hash: sha256(JSON.stringify({ c: result.commitments, d: result.drafts.map((d) => ({ ...d, updatedAt: undefined })) })),
          counts: {
            commitments: result.commitments.length,
            open: result.commitments.filter((c) => c.status === 'open').length,
            overdue: result.commitments.filter((c) => taskStatus(c, input.now) === 'overdue').length,
            drafts: result.drafts.length,
            pendingReview: result.drafts.filter((d) => d.state === 'pending_review').length,
            suppressed: result.drafts.filter((d) => d.state === 'suppressed').length,
            changedTasks: changed.tasks,
            changedDrafts: changed.drafts,
          },
          status: 'ok',
          duration_ms: Date.now() - started,
        },
      })
    }
    try {
      await applyOps(hasChanges || trigger !== 'interval' ? writes : [])
      return { input, result, changed }
    } catch (e) {
      if (e instanceof HttpError && e.status === 409 && attempt < 2) continue
      throw e
    }
  }
}
