import type { Commitment, Dataset, Draft, EngineConfig, IsoUtc, Person, SuppressionReason } from './types'
import { blockingReviewReasons, expectedRecipient } from './drafts'
import { isOverdue } from './deadline'
import { toWallTime } from './time'

export interface ApprovalBlocker {
  code: SuppressionReason | 'not_pending'
  message: string
}

export interface ApprovalCheck {
  ok: boolean
  blockers: ApprovalBlocker[]
  /** When set, the draft should be suppressed with this reason instead of approved */
  suppressWith?: SuppressionReason
}

const TERMINAL: Partial<Record<Commitment['status'], SuppressionReason>> = { done: 'completed', cancelled: 'cancelled', deferred: 'deferred' }

/**
 * Freshness and recipient check run right before approval, against the
 * latest commitment state. Anything outdated is suppressed with a visible reason.
 */
export function checkBeforeApproval(draft: Draft, c: Commitment | undefined, config: EngineConfig, people?: Map<string, Person>): ApprovalCheck {
  const blockers: ApprovalBlocker[] = []
  let suppressWith: SuppressionReason | undefined
  if (!c) {
    return { ok: false, blockers: [{ code: 'superseded', message: 'The commitment no longer exists in the current data' }], suppressWith: 'superseded' }
  }
  const terminal = TERMINAL[c.status]
  if (terminal) {
    blockers.push({ code: terminal, message: `The commitment is now ${c.status}; this reminder is no longer needed` })
    suppressWith = terminal
  }
  if (draft.state !== 'pending_review') blockers.push({ code: 'not_pending', message: `Draft is ${draft.state.replace('_', ' ')}, not waiting for review` })
  if (blockingReviewReasons(c).length > 0) blockers.push({ code: 'needs_review', message: `Needs review first: ${blockingReviewReasons(c).join(', ').replace(/_/g, ' ')}` })
  const draftedDue = draft.history[draft.history.length - 1]?.dueAt ?? null
  if (draftedDue !== c.deadline.dueAt) {
    blockers.push({ code: 'stale', message: 'The deadline changed after this draft was written' })
    suppressWith ??= 'stale'
  }
  // Owner-addressed drafts go stale when the owner changes; escalation drafts check their own recipient.
  const role = draft.recipientRole ?? 'owner'
  const expected = people ? expectedRecipient(c, role, people) : role === 'owner' ? c.ownerId : role === 'requester' && c.requesterId ? c.requesterId : draft.recipientId
  if (draft.recipientId !== expected) {
    blockers.push({ code: 'stale', message: role === 'owner' ? 'The owner changed after this draft was written' : 'The escalation recipient changed after this draft was written' })
    suppressWith ??= 'stale'
  }
  if (draft.kind === 'reminder' && !terminal && !isOverdue(c.deadline, c.status, config.now)) {
    blockers.push({ code: 'not_overdue', message: 'The commitment is not overdue at the evaluation time' })
    suppressWith ??= 'not_overdue'
  }
  if (config.flags.recipientReview && !draft.recipientConfirmed) {
    blockers.push({ code: 'recipient_unconfirmed', message: 'Confirm the recipient before approving' })
  }
  const ageHours = (Date.parse(config.now) - Date.parse(draft.updatedAt)) / 3_600_000
  if (config.flags.staleSuppression && ageHours > config.staleAfterHours) {
    blockers.push({ code: 'stale', message: `Drafted more than ${config.staleAfterHours} hours ago; review the latest messages first` })
  }
  return { ok: blockers.length === 0, blockers, suppressWith }
}

export function approveDraft(draft: Draft, by: string, at: IsoUtc): Draft {
  return { ...draft, state: 'approved', approvedBy: by, approvedAt: at }
}

export function suppressDraft(draft: Draft, reason: SuppressionReason, at: IsoUtc): Draft {
  return { ...draft, state: 'suppressed', suppression: { reason, at }, updatedAt: at }
}

/** Things a coordinator should look at before confirming who receives a reminder. */
export function recipientWarnings(draft: Draft, c: Commitment | undefined, dataset: Dataset, now: IsoUtc): string[] {
  const warnings: string[] = []
  if (!c || !draft.recipientId) return ['No recipient: the owner is unknown']
  const person = dataset.people.find((p) => p.id === draft.recipientId)
  if (!person) return [`Recipient ${draft.recipientId} is not in the people list`]
  if (c.events.some((e) => e.type === 'delegated')) warnings.push('Ownership was delegated; check this is the current owner')
  const threads = dataset.threads.filter((t) => c.threadIds.includes(t.id))
  if (threads.length > 0 && !threads.some((t) => t.participantIds?.includes(person.id))) warnings.push('Recipient has not posted in the related threads')
  const local = toWallTime(Date.parse(now), person.timezone)
  if (local.hour < 9 || local.hour >= 19) {
    warnings.push(`Outside working hours for ${person.name.split(/\s+/)[0]} (${String(local.hour).padStart(2, '0')}:${String(local.minute).padStart(2, '0')} local)`)
  }
  if (local.weekday === 0 || local.weekday === 6) warnings.push('It is the weekend in the recipient timezone')
  return warnings
}
