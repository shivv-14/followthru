import type { Commitment, Draft, EngineConfig, IsoUtc, Person } from './types'
import { desiredDraft, draftFields, NO_SNOOZE } from './drafts'

export const MAX_SNOOZE_DAYS = 30
const MAX_SNOOZE_REASON = 300
const UTC_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?Z$/

/**
 * Puts a pending draft aside until `until` (evaluation clock, UTC). It stays
 * pending: the queue hides it and approval is blocked until the time passes.
 */
export function snoozeDraft(draft: Draft, by: string, at: IsoUtc, until: IsoUtc, reason = ''): Draft {
  if (draft.state !== 'pending_review') throw new Error(`Only drafts waiting for review can be snoozed; this one is ${draft.state.replace('_', ' ')}`)
  if (!UTC_ISO.test(until) || Number.isNaN(Date.parse(until))) throw new Error('Choose a valid wake-up time')
  const ms = Date.parse(until) - Date.parse(at)
  if (ms <= 0) throw new Error('Choose a wake-up time after the current evaluation time')
  if (ms > MAX_SNOOZE_DAYS * 86_400_000) throw new Error(`Snooze for at most ${MAX_SNOOZE_DAYS} days`)
  const why = reason.trim().slice(0, MAX_SNOOZE_REASON)
  return { ...draft, snoozedUntil: until, snoozedBy: by, snoozedAt: at, snoozeReason: why || undefined }
}

/** Brings a snoozed draft back to review now. It never changes the draft state. */
export function unsnoozeDraft(draft: Draft): Draft {
  if (!draft.snoozedUntil) throw new Error('This draft is not snoozed')
  if (draft.state !== 'pending_review') throw new Error(`Draft is ${draft.state.replace('_', ' ')}, not waiting for review`)
  return { ...draft, ...NO_SNOOZE }
}

/**
 * Rewrites the draft from the commitment as it is now: a new version with cause
 * 'regenerated' that clears a coordinator's edit, rejection and snooze. A
 * suppressed or approved draft is never revived, and nothing is written when
 * the work no longer needs a reminder.
 */
export function regenerateDraft(draft: Draft, c: Commitment | undefined, config: EngineConfig, people: Map<string, Person>): Draft {
  if (draft.state === 'suppressed') throw new Error('A suppressed draft cannot be regenerated. It returns on its own only if the work needs chasing again.')
  if (draft.state === 'approved') throw new Error('This draft is already approved')
  if (!c) throw new Error('The commitment no longer exists in the current data')
  const want = desiredDraft(c, config, people)
  if (!want.active) throw new Error(`No reminder is needed now (${want.reason.replace(/_/g, ' ')})`)
  const fields = draftFields(c, want, people)
  const version = draft.version + 1
  const now = config.now
  return {
    ...draft,
    ...fields,
    ...NO_SNOOZE,
    recipientConfirmed: draft.recipientId === fields.recipientId ? draft.recipientConfirmed : false,
    state: 'pending_review',
    version,
    updatedAt: now,
    suppression: undefined,
    approvedBy: undefined,
    approvedAt: undefined,
    rejectedBy: undefined,
    rejectedAt: undefined,
    rejectReason: undefined,
    editedBody: undefined,
    editedBy: undefined,
    editedAt: undefined,
    history: [...draft.history, { version, at: now, dueAt: c.deadline.dueAt, recipientId: fields.recipientId, body: fields.body, subject: fields.subject, cause: 'regenerated' }],
  }
}
