import type { Commitment, Draft, DraftKind, EngineConfig, Evidence, FlowTone, IsoUtc, Person, SuppressionReason } from './types'
import { deadlineState, formatDeadline } from './deadline'
import { elapsedHours, flowFor, stepFor } from './flows'

type Desired =
  | { active: true; kind: DraftKind; tone: FlowTone; flowId: string; step: number }
  | { active: false; reason: SuppressionReason; evidence?: Evidence }

const TERMINAL: Record<string, SuppressionReason> = { done: 'completed', cancelled: 'cancelled', deferred: 'deferred' }

/** Reasons that block chasing. A passed tentative deadline still gets a clarify draft. */
export function blockingReviewReasons(c: Commitment) {
  return c.reviewReasons.filter((r) => r !== 'tentative_deadline')
}

function lastStatusEvidence(c: Commitment): Evidence | undefined {
  return [...c.events].reverse().find((e) => ['completed', 'cancelled', 'deferred', 'human_decision'].includes(e.type))?.evidence
}

export function desiredDraft(c: Commitment, config: EngineConfig, people: Map<string, Person>): Desired {
  if (c.status !== 'open') return { active: false, reason: TERMINAL[c.status], evidence: lastStatusEvidence(c) }
  if (blockingReviewReasons(c).length > 0 || !c.ownerId) return { active: false, reason: 'needs_review' }
  const state = deadlineState(c.deadline, config.now)
  const flow = flowFor(c, config.flows)
  if (state === 'tentative_passed') return { active: true, kind: 'clarify', tone: 'gentle', flowId: flow.id, step: 0 }
  if (state !== 'overdue') return { active: false, reason: 'not_overdue' }
  const tz = people.get(c.ownerId)?.timezone ?? 'UTC'
  const hours = elapsedHours(Date.parse(c.deadline.dueAt!), Date.parse(config.now), flow.skipWeekends, tz)
  const step = stepFor(flow, hours)
  if (step < 0) return { active: false, reason: 'not_overdue' }
  return { active: true, kind: 'reminder', tone: flow.steps[step].tone, flowId: flow.id, step }
}

function overdueFor(dueAt: IsoUtc, now: IsoUtc): string {
  const hours = Math.max(0, (Date.parse(now) - Date.parse(dueAt)) / 3_600_000)
  if (hours < 1) return 'less than an hour'
  if (hours < 48) return `${Math.floor(hours)} hour${Math.floor(hours) === 1 ? '' : 's'}`
  return `${Math.floor(hours / 24)} days`
}

export function composeBody(c: Commitment, kind: DraftKind, tone: FlowTone, people: Map<string, Person>, now: IsoUtc): string {
  const owner = people.get(c.ownerId ?? '')
  const name = owner?.name.split(/\s+/)[0] ?? 'there'
  const due = c.deadline.dueAt ? formatDeadline(c.deadline.dueAt, owner?.timezone ?? c.deadline.interpretedTz) : 'the agreed date'
  if (kind === 'clarify') {
    return `Hi ${name}, you mentioned "${c.deadline.phrase}" for "${c.title}". Could you confirm a firm date so we can plan around it?`
  }
  const late = c.deadline.dueAt ? overdueFor(c.deadline.dueAt, now) : ''
  if (tone === 'gentle') return `Hi ${name}, a quick check on "${c.title}", which was due ${due}. Could you share where it stands, or a new date if it has moved?`
  if (tone === 'firm') return `Hi ${name}, "${c.title}" is now ${late} past its deadline (${due}). Please send an update today, or tell me what is blocking it.`
  const requester = people.get(c.requesterId ?? '')?.name.split(/\s+/)[0]
  return `Hi ${name}, "${c.title}" has been overdue since ${due}.${requester && requester !== name ? ` Looping in ${requester}` : ' Let us'} so we can agree the next step today.`
}

function lastDueAt(d: Draft): IsoUtc | null {
  return d.history.length > 0 ? d.history[d.history.length - 1].dueAt : null
}

/**
 * One draft per commitment (idempotency key = commitment id). A changed
 * deadline, recipient, kind or flow step updates the same draft and bumps its
 * version. Done, cancelled and deferred work keeps zero active drafts.
 */
export function buildDrafts(commitments: Commitment[], previous: Draft[], config: EngineConfig, people: Map<string, Person>): Draft[] {
  const now = config.now
  const prevByKey = new Map(previous.map((d) => [d.idempotencyKey, d]))
  const out: Draft[] = []

  for (const c of commitments) {
    const p = prevByKey.get(c.id)
    prevByKey.delete(c.id)
    const want = desiredDraft(c, config, people)

    if (want.active) {
      const body = composeBody(c, want.kind, want.tone, people, now)
      if (!p) {
        out.push({
          id: `d_${c.id}`,
          idempotencyKey: c.id,
          commitmentId: c.id,
          kind: want.kind,
          recipientId: c.ownerId,
          recipientConfirmed: false,
          state: 'pending_review',
          version: 1,
          body,
          createdAt: now,
          updatedAt: now,
          history: [{ version: 1, at: now, dueAt: c.deadline.dueAt, recipientId: c.ownerId, body, cause: 'created' }],
          flowId: want.flowId,
          step: want.step,
        })
        continue
      }
      const cause =
        lastDueAt(p) !== c.deadline.dueAt
          ? 'deadline_changed'
          : p.recipientId !== c.ownerId
            ? 'recipient_changed'
            : p.kind !== want.kind
              ? 'kind_changed'
              : p.step !== want.step || p.flowId !== want.flowId
                ? 'step_changed'
                : p.state === 'suppressed'
                  ? 'reactivated'
                  : null
      if (cause) {
        const version = p.version + 1
        out.push({
          ...p,
          kind: want.kind,
          recipientId: c.ownerId,
          recipientConfirmed: p.recipientId === c.ownerId ? p.recipientConfirmed : false,
          state: 'pending_review',
          version,
          body,
          updatedAt: now,
          suppression: undefined,
          approvedBy: undefined,
          approvedAt: undefined,
          flowId: want.flowId,
          step: want.step,
          history: [...p.history, { version, at: now, dueAt: c.deadline.dueAt, recipientId: c.ownerId, body, cause }],
        })
        continue
      }
      const ageHours = (Date.parse(now) - Date.parse(p.updatedAt)) / 3_600_000
      if (config.flags.staleSuppression && p.state === 'pending_review' && ageHours > config.staleAfterHours) {
        out.push({ ...p, state: 'stale', suppression: { reason: 'stale', at: now } })
      } else out.push(p)
      continue
    }

    if (!p) continue
    let next = p
    if (lastDueAt(p) !== c.deadline.dueAt) {
      const version = p.version + 1
      next = {
        ...p,
        version,
        updatedAt: now,
        history: [...p.history, { version, at: now, dueAt: c.deadline.dueAt, recipientId: c.ownerId, body: p.body, cause: 'deadline_changed' }],
      }
    }
    if (next.state !== 'suppressed' || next.suppression?.reason !== want.reason || next !== p) {
      next = { ...next, state: 'suppressed', suppression: { reason: want.reason, at: next === p ? now : next.updatedAt, evidence: want.evidence }, updatedAt: now }
    }
    out.push(next)
  }

  // Drafts whose commitment disappeared (for example after a data change) are kept, suppressed.
  for (const p of prevByKey.values()) {
    out.push(p.state === 'suppressed' && p.suppression?.reason === 'superseded' ? p : { ...p, state: 'suppressed', suppression: { reason: 'superseded', at: now }, updatedAt: now })
  }
  return out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}
