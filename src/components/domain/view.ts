import type { Commitment, Draft, Person, ReviewReason, SuppressionReason } from '../../engine/types'
import { deadlineState } from '../../engine/deadline'
import type { StatusColorKey } from '../../styles/tokens'

export interface StatusView {
  key: StatusColorKey
  label: string
}

/** One colour per status; overdue and tentative are shown for open work. */
export function statusView(c: Commitment, now: string): StatusView {
  if (c.status === 'done') return { key: 'done', label: 'Done' }
  if (c.status === 'cancelled') return { key: 'cancelled', label: 'Cancelled' }
  if (c.status === 'deferred') return { key: 'deferred', label: 'Deferred' }
  const state = deadlineState(c.deadline, now)
  if (state === 'overdue') return { key: 'overdue', label: 'Overdue' }
  if (state === 'tentative_passed' || state === 'tentative_upcoming') return { key: 'tentative', label: 'Tentative' }
  return { key: 'open', label: 'Open' }
}

export function draftStateView(d: Draft): StatusView {
  if (d.state === 'approved') return { key: 'done', label: 'Approved (shadow)' }
  if (d.state === 'pending_review') return { key: 'overdue', label: 'Needs review' }
  if (d.state === 'stale') return { key: 'tentative', label: 'Stale' }
  return { key: 'cancelled', label: 'Suppressed' }
}

export const REVIEW_LABEL: Record<ReviewReason, string> = {
  unauthorised_status_claim: 'Someone outside the commitment says it is done',
  ambiguous_completion: 'A completion message could match more than one item',
  tentative_deadline: 'Tentative deadline has passed; ask for a firm date',
  unclear_owner: 'Owner is unclear',
  unaccepted_delegation: 'Handed to someone who has not accepted yet',
  conflicting_evidence: 'Messages conflict (for example the owner tried to cancel)',
  weak_cross_thread_link: 'A message in another thread may be about this',
  missing_deadline: 'No deadline given',
}

export const SUPPRESSION_LABEL: Record<SuppressionReason, string> = {
  completed: 'Work is done',
  cancelled: 'Work was cancelled',
  deferred: 'Work was deferred',
  not_overdue: 'Not overdue any more',
  needs_review: 'Waiting for human review',
  stale: 'Out of date',
  recipient_unconfirmed: 'Recipient not confirmed',
  superseded: 'Commitment no longer in the data',
}

export const PROGRESS_LABEL = { not_started: 'Not started', in_progress: 'In progress', blocked: 'Blocked', submitted: 'Submitted for approval' } as const

export function personName(people: Map<string, Person>, id: string | null | undefined): string {
  if (!id) return 'Unassigned'
  return people.get(id)?.name ?? id
}

export function firstName(people: Map<string, Person>, id: string | null | undefined): string {
  return personName(people, id).split(/\s+/)[0]
}

export function shortTime(iso: string, tz?: string): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: tz, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso))
}

/** "in 3 h", "2 d ago" relative to the evaluation clock */
export function relative(iso: string, now: string): string {
  const diff = Date.parse(iso) - Date.parse(now)
  const abs = Math.abs(diff)
  const h = abs / 3_600_000
  const text = h < 1 ? `${Math.max(1, Math.round(abs / 60_000))} min` : h < 48 ? `${Math.round(h)} h` : `${Math.round(h / 24)} d`
  return diff >= 0 ? `in ${text}` : `${text} ago`
}

export function downloadText(filename: string, text: string, mime: string) {
  const url = URL.createObjectURL(new Blob([text], { type: mime }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
