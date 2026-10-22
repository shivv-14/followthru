import type { Commitment, Draft, Person } from '../../engine/types'
import { deadlineState } from '../../engine/deadline'
import { REVIEW_LABEL, SUPPRESSION_LABEL, personName, shortTime } from './view'

const CLOSE_VERB = { done: 'marked it done', cancelled: 'cancelled it', deferred: 'deferred it' } as const

/**
 * Plain-English answer to "why is this item in this state?", built only from the
 * commitment's own events, deadline and draft. Pure: the clock is passed in.
 */
export function explainCommitment(c: Commitment, draft: Draft | undefined, people: Map<string, Person>, now: string, tz?: string): string[] {
  const out: string[] = []
  const name = (id: string | null | undefined) => personName(people, id)
  const created = c.events.find((e) => e.type === 'created')

  if (c.source === 'manual') out.push(`${name(c.requesterId)} created this task by hand and gave it to ${name(c.ownerId)}.`)
  else if (created) out.push(`${name(created.by)} took this on in a message on ${shortTime(created.at, tz)}${c.requesterId && c.requesterId !== created.by ? `, asked by ${name(c.requesterId)}` : ''}.`)

  const delegated = [...c.events].reverse().find((e) => e.type === 'delegated')
  if (delegated) out.push(`It was handed to ${name(delegated.to)} on ${shortTime(delegated.at, tz)}, so ${name(c.ownerId)} is the owner now.`)

  if (c.status !== 'open') {
    const closing = [...c.events].reverse().find((e) => e.type === (c.status === 'done' ? 'completed' : c.status) || (e.type === 'human_decision' && e.to === c.status))
    out.push(`${closing ? name(closing.by) : 'Someone'} ${CLOSE_VERB[c.status]}${closing ? ` on ${shortTime(closing.at, tz)}` : ''}, so no reminder will ever be drafted for it.`)
  } else {
    const state = deadlineState(c.deadline, now)
    const due = c.deadline.dueAt ? shortTime(c.deadline.dueAt, tz) : ''
    const phrase = c.deadline.phrase ? ` ("${c.deadline.phrase}", read in ${c.deadline.interpretedTz})` : ''
    if (state === 'none') out.push('No deadline was given, so it can never be overdue. It stays open until someone closes it.')
    else if (state === 'upcoming') out.push(`It is due ${due}${phrase}. Nothing is late yet, so there is nothing to chase.`)
    else if (state === 'overdue') out.push(`It was due ${due}${phrase} and is still open, so it is overdue.`)
    else if (state === 'tentative_upcoming') out.push(`The date ${due}${phrase} was hedged, so it is treated as a guess, not a promise.`)
    else out.push(`The hedged date ${due}${phrase} has passed. The right next step is to ask for a firm date, not to chase.`)
    if (c.responseState === 'pending') out.push('The owner has not replied since. Silence never closes work; it only keeps the reply pending.')
  }

  for (const r of c.reviewReasons) out.push(`A person needs to look: ${REVIEW_LABEL[r].charAt(0).toLowerCase()}${REVIEW_LABEL[r].slice(1)}.`)

  if (c.extensionRequest?.state === 'pending') out.push(`${name(c.extensionRequest.by)} asked for more time; the deadline only moves if a coordinator approves.`)

  if (draft) {
    if (draft.state === 'pending_review') out.push(`A ${draft.kind === 'clarify' ? 'clarifying question' : 'reminder'} to ${name(draft.recipientId)} is waiting for a coordinator. Nothing is sent without review.`)
    else if (draft.state === 'approved') out.push('The reminder was approved in shadow mode, so it was recorded but not sent.')
    else if (draft.state === 'rejected') out.push(`A coordinator rejected the reminder${draft.rejectReason ? `: "${draft.rejectReason}"` : ''}.`)
    else if (draft.suppression) out.push(`The earlier reminder was held back: ${SUPPRESSION_LABEL[draft.suppression.reason].toLowerCase()}.`)
  }
  return out
}
