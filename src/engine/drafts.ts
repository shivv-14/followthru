import type { Commitment, Draft, DraftKind, EngineConfig, Evidence, FlowTone, IsoUtc, Person, RecipientRole, ReplyState, SuppressionReason } from './types'
import { deadlineState, formatDeadline } from './deadline'
import { elapsedHours, flowFor, stepFor } from './flows'

type Desired =
  | { active: true; kind: DraftKind; tone: FlowTone; flowId: string; step: number; recipientRole: RecipientRole }
  | { active: false; reason: SuppressionReason; evidence?: Evidence }

const TERMINAL: Record<string, SuppressionReason> = { done: 'completed', cancelled: 'cancelled', deferred: 'deferred' }
const MAX_SUBJECT = 59

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
  if (state === 'tentative_passed') return { active: true, kind: 'clarify', tone: 'gentle', flowId: flow.id, step: 0, recipientRole: 'owner' }
  if (state !== 'overdue') return { active: false, reason: 'not_overdue' }
  const tz = people.get(c.ownerId)?.timezone ?? 'UTC'
  const hours = elapsedHours(Date.parse(c.deadline.dueAt!), Date.parse(config.now), flow.skipWeekends, tz)
  const step = stepFor(flow, hours)
  if (step < 0) return { active: false, reason: 'not_overdue' }
  const s = flow.steps[step]
  return { active: true, kind: 'reminder', tone: s.tone, flowId: flow.id, step, recipientRole: s.recipient ?? 'owner' }
}

function firstCoordinator(people: Map<string, Person>): string | null {
  return [...people.values()].filter((p) => p.role === 'coordinator').sort((a, b) => (a.id < b.id ? -1 : 1))[0]?.id ?? null
}

/** Owner by default; a requester step falls back to the coordinator when there is no requester. */
export function expectedRecipient(c: Commitment, role: RecipientRole | undefined, people: Map<string, Person>): string | null {
  if (role === 'requester') return c.requesterId ?? firstCoordinator(people)
  if (role === 'coordinator') return firstCoordinator(people)
  return c.ownerId
}

/** pending: nothing from the owner since the deadline; not_done: their latest update is "not yet" or progress. */
export function replyState(c: Commitment): ReplyState {
  if (c.responseState === 'pending') return 'pending'
  const latest = [...c.events].reverse().find((e) => e.type !== 'review_flagged')
  return latest && (latest.type === 'not_done' || latest.type === 'progress') ? 'not_done' : 'responded'
}

function firstName(people: Map<string, Person>, id: string | null | undefined): string {
  return people.get(id ?? '')?.name.split(/\s+/)[0] ?? 'there'
}

function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`
}

export function composeSubject(c: Commitment, kind: DraftKind, role: RecipientRole, reply: ReplyState): string {
  const prefix = kind === 'clarify' ? 'Date needed: ' : role !== 'owner' ? 'Overdue: ' : reply === 'not_done' ? 'New date for: ' : 'Quick check: '
  return prefix + clip(c.title, MAX_SUBJECT - prefix.length)
}

function lastReply(c: Commitment): IsoUtc | null {
  const ownerEvents = c.events.filter((e) => e.by === c.ownerId && e.evidence?.messageId)
  return ownerEvents.length > 0 ? ownerEvents[ownerEvents.length - 1].at : null
}

/**
 * Short, polite and specific (under 70 words). Uses the recipient's first name
 * and the deadline in the recipient's timezone. No elapsed-time text, so the
 * wording only changes when something real changes.
 */
export function composeBody(c: Commitment, kind: DraftKind, tone: FlowTone, people: Map<string, Person>, recipientId: string | null, reply: ReplyState): string {
  const recipient = people.get(recipientId ?? '')
  const name = firstName(people, recipientId)
  const tz = recipient?.timezone ?? c.deadline.interpretedTz
  const due = c.deadline.dueAt ? formatDeadline(c.deadline.dueAt, tz) : 'the agreed date'

  if (kind === 'clarify') {
    return `Hi ${name}, you mentioned "${c.deadline.phrase}" for "${c.title}". Could you confirm a firm date so we can plan around it?`
  }
  if (recipientId !== c.ownerId) {
    const owner = people.get(c.ownerId ?? '')?.name ?? 'the owner'
    const replied = lastReply(c)
    const replyText = reply === 'pending' || !replied ? 'There has been no reply since the deadline.' : `Last reply from them: ${formatDeadline(replied, tz)}.`
    return `Hi ${name}, "${c.title}" owned by ${owner} was due ${due} and is still open. ${replyText} Could you help agree the next step?`
  }
  if (reply === 'not_done') {
    return `Hi ${name}, thanks for the update on "${c.title}", which was due ${due}. What is a realistic new date we can plan around?${tone === 'gentle' ? '' : ' A reply today would help.'}`
  }
  const silence = reply === 'pending' ? " I haven't heard back yet." : ''
  if (tone === 'gentle') return `Hi ${name}, a quick check on "${c.title}", which was due ${due}.${silence} Could you share where it stands, or a new date if it has moved?`
  if (tone === 'firm') return `Hi ${name}, "${c.title}" is past its deadline (${due}).${silence} Please send an update today, or tell me what is blocking it.`
  const requester = people.get(c.requesterId ?? '')?.name.split(/\s+/)[0]
  return `Hi ${name}, "${c.title}" has been overdue since ${due}.${silence}${requester && requester !== name ? ` Looping in ${requester}` : ' Let us'} so we can agree the next step today.`
}

function lastDueAt(d: Draft): IsoUtc | null {
  return d.history.length > 0 ? d.history[d.history.length - 1].dueAt : null
}

/**
 * One draft per commitment (idempotency key = commitment id). A changed
 * deadline, recipient, kind, flow step or owner reply updates the same draft
 * and bumps its version. Done, cancelled and deferred work keeps zero active drafts.
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
      const recipientId = expectedRecipient(c, want.recipientRole, people)
      const reply = replyState(c)
      const body = composeBody(c, want.kind, want.tone, people, recipientId, reply)
      const subject = composeSubject(c, want.kind, want.recipientRole, reply)
      const fields = { kind: want.kind, recipientId, recipientRole: want.recipientRole, replyState: reply, body, subject, flowId: want.flowId, step: want.step }
      if (!p) {
        out.push({
          id: `d_${c.id}`,
          idempotencyKey: c.id,
          commitmentId: c.id,
          ...fields,
          recipientConfirmed: false,
          state: 'pending_review',
          version: 1,
          createdAt: now,
          updatedAt: now,
          history: [{ version: 1, at: now, dueAt: c.deadline.dueAt, recipientId, body, subject, cause: 'created' }],
        })
        continue
      }
      const cause =
        lastDueAt(p) !== c.deadline.dueAt
          ? 'deadline_changed'
          : p.recipientId !== recipientId
            ? 'recipient_changed'
            : p.kind !== want.kind
              ? 'kind_changed'
              : p.step !== want.step || p.flowId !== want.flowId
                ? 'step_changed'
                : p.state === 'suppressed'
                  ? 'reactivated'
                  : p.replyState !== undefined && p.replyState !== reply
                    ? 'reply_changed'
                    : null
      if (cause) {
        const version = p.version + 1
        out.push({
          ...p,
          ...fields,
          recipientConfirmed: p.recipientId === recipientId ? p.recipientConfirmed : false,
          state: 'pending_review',
          version,
          updatedAt: now,
          suppression: undefined,
          approvedBy: undefined,
          approvedAt: undefined,
          history: [...p.history, { version, at: now, dueAt: c.deadline.dueAt, recipientId, body, subject, cause }],
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
        history: [...p.history, { version, at: now, dueAt: c.deadline.dueAt, recipientId: p.recipientId, body: p.body, subject: p.subject, cause: 'deadline_changed' }],
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
