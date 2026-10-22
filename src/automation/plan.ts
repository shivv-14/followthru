import { parseDeadline } from '../engine/deadline'
import { keywords, overlap } from '../engine/signals'
import type { DecisionType, IsoUtc } from '../engine/types'
import type { ActionItem, EmailAnalysis } from './schema'

// Turns one email reading into concrete steps. Pure: the server applies the steps.
// Rules: never invent a person or a date; anything uncertain goes to review; status
// changes need the same authority as everywhere else in FollowThru.

export interface DirectoryPerson {
  id: string
  name: string
  email?: string | null
  role?: 'coordinator' | 'member'
  timezone: string
}

export interface KnownTicket {
  taskKey: string
  title: string
  ownerId: string | null
  requesterId: string | null
  status: 'open' | 'done' | 'cancelled' | 'deferred'
  /** Gmail thread the ticket came from, when it came from email */
  threadId?: string | null
}

export interface PlanContext {
  now: IsoUtc
  messageId: string
  threadId: string
  sentAt: IsoUtc
  fromEmail: string | null
  toEmails: string[]
  directory: DirectoryPerson[]
  tickets: KnownTicket[]
  /** Below this confidence nothing is applied automatically */
  minConfidence: number
}

export type PlannedStep =
  | { kind: 'create'; ticketId: string; item: ActionItem; ownerId: string; requesterId: string | null; dueAt: IsoUtc | null; deadlineNote: string; assignReason: string }
  | { kind: 'decide'; taskKey: string; type: DecisionType; byPersonId: string; note: string; dueAt?: IsoUtc; reason: string }
  | { kind: 'review'; reason: string; item?: ActionItem; taskKey?: string; suggestedOwnerId?: string | null }
  | { kind: 'ignore'; reason: string }

/** Stable ticket id for item n of a message, so processing the same email twice creates nothing new. */
export function ticketIdFor(messageId: string, index: number): string {
  let h = 2166136261
  for (const ch of `${messageId}#${index}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0
  return `mail_${h.toString(36)}_${index}`
}

export function personByEmail(dir: DirectoryPerson[], email: string | null | undefined): DirectoryPerson | undefined {
  if (!email) return undefined
  const e = email.trim().toLowerCase()
  return dir.find((p) => p.email?.toLowerCase() === e)
}

function personByName(dir: DirectoryPerson[], name: string | null | undefined): DirectoryPerson | undefined {
  if (!name) return undefined
  const n = name.trim().toLowerCase()
  const exact = dir.filter((p) => p.name.toLowerCase() === n)
  if (exact.length === 1) return exact[0]
  const first = dir.filter((p) => p.name.split(/\s+/)[0].toLowerCase() === n.split(/\s+/)[0])
  return first.length === 1 ? first[0] : undefined
}

/** Owner of an action item: named email, then a unique name, then the only team-member recipient. */
export function resolveOwner(item: ActionItem, ctx: PlanContext): { person?: DirectoryPerson; reason: string } {
  const byMail = personByEmail(ctx.directory, item.assignee_email)
  if (byMail) return { person: byMail, reason: `Email address ${item.assignee_email} is ${byMail.name} in the team directory` }
  if (item.assignee_email) return { reason: `${item.assignee_email} is not in the team directory` }
  if (item.assignee_name) {
    const byName = personByName(ctx.directory, item.assignee_name)
    return byName ? { person: byName, reason: `"${item.assignee_name}" matches exactly one person (${byName.name})` } : { reason: `"${item.assignee_name}" matches no one, or more than one person` }
  }
  const sender = personByEmail(ctx.directory, ctx.fromEmail)
  // Only a teammate's request is assigned to its single recipient; outside mail must name the owner
  if (!sender) return { reason: 'The sender is outside the team and named no owner' }
  const recipients = ctx.toEmails.map((e) => personByEmail(ctx.directory, e)).filter((p): p is DirectoryPerson => !!p && p.id !== sender?.id)
  if (recipients.length === 1) return { person: recipients[0], reason: `The request was sent only to ${recipients[0].name}` }
  return { reason: recipients.length > 1 ? 'Several team members were addressed and none was named' : 'No team member was named or addressed' }
}

/** Resolves deadline wording in the sender's timezone. Hedged or unreadable wording gives no date. */
export function resolveDeadline(textIn: string | null, sentAt: IsoUtc, tz: string): { dueAt: IsoUtc | null; note: string; unclear: boolean } {
  if (!textIn) return { dueAt: null, note: 'No deadline in the email', unclear: false }
  const d = parseDeadline(`by ${textIn}`, { saidAt: sentAt, tz })
  if (!d || !d.dueAt) return { dueAt: null, note: `"${textIn}" is not a date FollowThru can pin down`, unclear: true }
  if (d.certainty === 'tentative') return { dueAt: null, note: `"${textIn}" is tentative, so no exact deadline was set`, unclear: true }
  return { dueAt: d.dueAt, note: `"${textIn}" read in ${tz}`, unclear: false }
}

/** Which existing ticket an update is about: same thread first, then the sender's own open tickets by wording. */
export function matchTicket(hint: string, senderId: string | undefined, ctx: PlanContext): { ticket?: KnownTicket; reason: string } {
  const words = keywords(hint)
  const rank = (list: KnownTicket[]) => list.map((t) => ({ t, s: overlap(keywords(t.title), words) })).sort((a, b) => b.s - a.s)
  const inThread = ctx.tickets.filter((t) => t.threadId === ctx.threadId)
  const openInThread = inThread.filter((t) => t.status === 'open')
  const pool = openInThread.length ? openInThread : inThread
  if (pool.length === 1) return { ticket: pool[0], reason: 'Only ticket created from this email thread' }
  if (pool.length > 1) {
    const r = rank(pool)
    if (r[0].s > 0 && r[0].s > r[1].s) return { ticket: r[0].t, reason: `Best wording match among ${pool.length} tickets in this thread` }
    return { reason: `${pool.length} tickets in this thread and the email does not say which` }
  }
  const mine = ctx.tickets.filter((t) => t.status === 'open' && senderId && (t.ownerId === senderId || t.requesterId === senderId))
  const r = rank(mine).filter((x) => x.s >= 0.5)
  if (r.length === 1 || (r.length > 1 && r[0].s > r[1].s)) return { ticket: r[0].t, reason: 'Strong wording match with one of the sender\'s open tickets' }
  return { reason: r.length > 1 ? 'Several tickets match equally well' : 'No ticket in this thread and no clear wording match' }
}

/** One email reading → steps to apply. */
export function planSteps(a: EmailAnalysis, ctx: PlanContext): PlannedStep[] {
  if (a.classification === 'automated') return [{ kind: 'ignore', reason: 'Automated or bulk email' }]
  if (!a.action_required && a.items.length === 0 && !a.update) return [{ kind: 'ignore', reason: `No action needed (${a.classification})` }]
  if (a.requires_human_review) return [{ kind: 'review', reason: `The reader asked for a human check: ${a.reasoning_summary || 'uncertain'}` }]
  if (a.confidence < ctx.minConfidence) return [{ kind: 'review', reason: `Confidence ${a.confidence.toFixed(2)} is below the ${ctx.minConfidence} threshold` }]

  const sender = personByEmail(ctx.directory, ctx.fromEmail)
  // Mail from outside the team that names no team member is not this team's work (job alerts, offers, newsletters)
  const namesMember = a.items.some((i) => personByEmail(ctx.directory, i.assignee_email) || personByName(ctx.directory, i.assignee_name))
  if (!sender && !namesMember && !(a.update && matchTicket(a.update.target_hint, undefined, ctx).ticket)) {
    return [{ kind: 'ignore', reason: 'From outside the team and about no team member or ticket' }]
  }
  const tzOf = (p?: DirectoryPerson) => p?.timezone ?? sender?.timezone ?? ctx.directory.find((x) => x.role === 'coordinator')?.timezone ?? 'UTC'
  const steps: PlannedStep[] = []

  a.items.forEach((item, i) => {
    const owner = resolveOwner(item, ctx)
    const deadline = resolveDeadline(item.deadline_text, ctx.sentAt, tzOf(sender))
    const duplicate = ctx.tickets.find((t) => t.status === 'open' && t.threadId === ctx.threadId && overlap(keywords(t.title), keywords(item.title)) >= 0.6)
    if (duplicate) {
      steps.push({ kind: 'ignore', reason: `"${item.title}" is already tracked as ${duplicate.taskKey}` })
      return
    }
    if (!owner.person) {
      steps.push({ kind: 'review', reason: `Owner unclear for "${item.title}": ${owner.reason}`, item })
      return
    }
    if (deadline.dueAt && Date.parse(deadline.dueAt) <= Date.parse(ctx.sentAt)) {
      steps.push({ kind: 'review', reason: `Deadline for "${item.title}" is before the email was sent`, item, suggestedOwnerId: owner.person.id })
      return
    }
    steps.push({ kind: 'create', ticketId: ticketIdFor(ctx.messageId, i), item, ownerId: owner.person.id, requesterId: sender?.id ?? null, dueAt: deadline.dueAt, deadlineNote: deadline.note, assignReason: owner.reason })
  })

  const u = a.update
  if (u) {
    const match = matchTicket(u.target_hint, sender?.id, ctx)
    const t = match.ticket
    if (!t) steps.push({ kind: 'review', reason: `Update could not be matched to a ticket: ${match.reason}` })
    else if (!sender) steps.push({ kind: 'review', reason: `Update about ${t.taskKey} came from someone outside the team directory`, taskKey: t.taskKey })
    else {
      const isOwner = t.ownerId === sender.id
      const isLead = sender.role === 'coordinator' || t.requesterId === sender.id
      const note = `From email: "${u.evidence_quote}"`
      const decide = (type: DecisionType, reason: string, dueAt?: IsoUtc) => steps.push({ kind: 'decide', taskKey: t.taskKey, type, byPersonId: sender.id, note, reason: `${match.reason}; ${reason}`, ...(dueAt ? { dueAt } : {}) })
      if (t.status !== 'open' && u.kind !== 'progress') steps.push({ kind: 'review', reason: `${t.taskKey} is already ${t.status}; the email needs a human look`, taskKey: t.taskKey })
      else if (!isOwner && !isLead) steps.push({ kind: 'review', reason: `${sender.name} is not the owner, requester or a coordinator of ${t.taskKey}`, taskKey: t.taskKey })
      else if (u.kind === 'completed') {
        if (sender.role === 'coordinator') decide('mark_done', 'a coordinator reported it done')
        else if (isOwner) decide('submit_work', 'the owner reported it done; a coordinator approves the submission')
        else decide('mark_done', 'the requester confirmed it is done')
      } else if (u.kind === 'blocker') decide('report_blocker', 'blocker reported')
      else if (u.kind === 'cancelled') {
        if (isLead) decide('cancel', 'cancelled by the requester or a coordinator')
        else steps.push({ kind: 'review', reason: 'Only a coordinator or the requester can cancel work', taskKey: t.taskKey })
      } else if (u.kind === 'extension_request' || u.kind === 'deadline_change') {
        const d = resolveDeadline(u.new_deadline_text, ctx.sentAt, tzOf(sender))
        if (!d.dueAt || Date.parse(d.dueAt) <= Date.parse(ctx.now)) steps.push({ kind: 'review', reason: `New date unclear for ${t.taskKey}: ${d.note}`, taskKey: t.taskKey })
        else if (sender.role === 'coordinator' && u.kind === 'deadline_change') decide('change_deadline', 'a coordinator set the new deadline', d.dueAt)
        else if (isOwner) decide('request_extension', 'the owner asked for more time; a coordinator approves', d.dueAt)
        else if (sender.role === 'coordinator') decide('change_deadline', 'a coordinator set the new deadline', d.dueAt)
        else steps.push({ kind: 'review', reason: 'Only the owner can ask for more time', taskKey: t.taskKey })
      } else if (u.kind === 'progress' && isOwner) steps.push({ kind: 'ignore', reason: 'Progress note recorded on the email only' })
    }
  }

  if (steps.length === 0) steps.push({ kind: 'review', reason: 'Action needed but nothing specific could be extracted' })
  return steps
}
