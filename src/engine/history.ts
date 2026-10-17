import type {
  Commitment,
  CommitmentEvent,
  Dataset,
  Deadline,
  Evidence,
  HumanDecision,
  IsoUtc,
  ManualTask,
  Message,
  Person,
  ReviewReason,
} from './types'
import { parseDeadline } from './deadline'
import { detectSignals, escapeRe, has, keywords, overlap, quote, titleFrom, type Signal } from './signals'
import { canDecide } from './permissions'

// Linking thresholds: share of the commitment's keywords found in a message
// from another thread. Strong links can change status; weak links only flag review.
export const STRONG_LINK = 0.5
export const WEAK_LINK = 0.3

const NUDGE = /\b(any update|status update|how'?s (it|that|the \w+) going|where are we|eta\b|following up|checking in|gentle reminder)\b/i

interface Working {
  c: Commitment
  words: string[]
  requestPending: boolean
  pendingDelegate?: string
  lastOwnerMsgAt?: number
  reasons: Set<ReviewReason>
}

interface Ctx {
  people: Map<string, Person>
  coordinators: Set<string>
  byMessage: Map<string, Working>
  open: Working[]
  messages: Map<string, Message>
}

function tzOf(ctx: Ctx, personId: string | null | undefined): string {
  return (personId && ctx.people.get(personId)?.timezone) || 'UTC'
}

function evidence(m: Message, rule: string): Evidence {
  return { messageId: m.id, threadId: m.threadId, at: m.sentAt, quote: quote(m.text), rule }
}

/** People addressed or mentioned in a message, excluding the author. */
export function mentionedPeople(m: Message, people: Person[]): string[] {
  const out: string[] = []
  const push = (id: string) => {
    if (id !== m.authorId && !out.includes(id)) out.push(id)
  }
  m.mentionIds?.forEach(push)
  const text = m.text
  const hits = people
    .flatMap((p) => {
      const first = p.name.split(/\s+/)[0]
      const re = new RegExp(`(^|[^\\w])@?(${escapeRe(p.name)}|${escapeRe(first)}|${escapeRe(p.id)})\\b`, 'i')
      const match = re.exec(text)
      return match ? [{ id: p.id, at: match.index }] : []
    })
    .sort((a, b) => a.at - b.at)
  hits.forEach((h) => push(h.id))
  return out
}

/**
 * Who a request is addressed to: a leading name ("Dev, please…") wins,
 * then explicit mentions, then any name in the text.
 */
export function addressees(m: Message, people: Person[]): string[] {
  const lead = people.find((p) => {
    const first = p.name.split(/\s+/)[0]
    return new RegExp(`^\\W*@?(${escapeRe(p.name)}|${escapeRe(first)})\\b\\s*[,:]`, 'i').test(m.text)
  })
  if (lead && lead.id !== m.authorId) return [lead.id]
  if (m.mentionIds && m.mentionIds.length > 0) return m.mentionIds.filter((id) => id !== m.authorId)
  return mentionedPeople(m, people)
}

function addEvent(w: Working, e: CommitmentEvent) {
  w.c.events.push(e)
}

function link(ctx: Ctx, w: Working, m: Message) {
  if (!w.c.linkedMessageIds!.includes(m.id)) w.c.linkedMessageIds!.push(m.id)
  if (!w.c.threadIds.includes(m.threadId)) w.c.threadIds.push(m.threadId)
  ctx.byMessage.set(m.id, w)
  if (m.authorId === w.c.ownerId) w.lastOwnerMsgAt = Date.parse(m.sentAt)
}

function involved(ctx: Ctx, w: Working, personId: string): boolean {
  return personId === w.c.ownerId || personId === w.c.requesterId || personId === w.pendingDelegate || ctx.coordinators.has(personId)
}

type Target = { w: Working; strength: 'strong' | 'weak'; rule: string } | { ambiguous: Working[] } | null

function findTarget(ctx: Ctx, m: Message, signals: Signal[]): Target {
  // 1. Reply chain
  let replyTo = m.replyToId
  const seen = new Set<string>()
  while (replyTo && !seen.has(replyTo)) {
    seen.add(replyTo)
    const w = ctx.byMessage.get(replyTo)
    if (w) return { w, strength: 'strong', rule: 'LINK_REPLY' }
    replyTo = ctx.messages.get(replyTo)?.replyToId
  }

  const words = keywords(m.text)
  // 2. Same thread, author involved: the commitment the text talks about
  const sameThread = ctx.open.filter((w) => w.c.threadIds.includes(m.threadId) && involved(ctx, w, m.authorId))
  const sameScored = sameThread.map((w) => ({ w, s: overlap(w.words, words) })).sort((a, b) => b.s - a.s)
  if (sameScored.length > 0 && sameScored[0].s > 0 && (sameScored.length === 1 || sameScored[0].s > sameScored[1].s)) {
    return { w: sameScored[0].w, strength: 'strong', rule: 'LINK_THREAD_SIMILARITY' }
  }

  // 3. Another thread: only for status-changing messages, by keyword similarity.
  // Authority is checked later, so a claim from someone else is flagged rather than ignored.
  const statusSignal = signals.some((s) => ['done', 'cancel', 'defer', 'reschedule', 'delegate'].includes(s.kind))
  const cross = statusSignal
    ? ctx.open
        .filter((w) => !w.c.threadIds.includes(m.threadId))
        .map((w) => ({ w, s: overlap(w.words, words), hits: w.words.filter((x) => words.includes(x)).length }))
        .filter((x) => x.s >= WEAK_LINK && x.hits >= Math.min(2, x.w.words.length))
        .sort((a, b) => b.s - a.s)
    : []
  const best = cross[0]
  const crossTie = cross.length > 1 && cross[1].s === best?.s
  if (best && best.s >= STRONG_LINK && !crossTie) return { w: best.w, strength: 'strong', rule: 'LINK_SIMILARITY' }

  if (sameThread.length === 1) return { w: sameThread[0], strength: 'strong', rule: 'LINK_THREAD' }
  if (sameThread.length > 1) {
    const owned = sameThread.filter((w) => w.c.ownerId === m.authorId || w.pendingDelegate === m.authorId)
    if (owned.length === 1) return { w: owned[0], strength: 'strong', rule: 'LINK_THREAD_OWNER' }
    return { ambiguous: sameThread }
  }
  if (best) return { w: best.w, strength: 'weak', rule: 'LINK_WEAK_SIMILARITY' }
  return null
}

function newCommitment(ctx: Ctx, m: Message, ownerId: string | null, requesterId: string | null, rule: string, deadline: Deadline | null): Working {
  const names = [...ctx.people.values()].flatMap((p) => [p.name, p.name.split(/\s+/)[0]])
  const title = titleFrom(m.text, names)
  const c: Commitment = {
    id: `c_${m.id}`,
    title,
    sourceMessageId: m.id,
    source: 'message',
    requesterId,
    ownerId,
    deadline: deadline
      ? { ...deadline, evidence: evidence(m, deadline.certainty === 'tentative' ? 'DEADLINE_TENTATIVE' : 'DEADLINE') }
      : { dueAt: null, certainty: 'none', phrase: '', interpretedTz: tzOf(ctx, ownerId ?? m.authorId) },
    status: 'open',
    responseState: 'pending',
    needsReview: false,
    reviewReasons: [],
    threadIds: [m.threadId],
    events: [{ type: 'created', at: m.sentAt, by: m.authorId, evidence: evidence(m, rule), to: ownerId }],
    linkedMessageIds: [],
  }
  const w: Working = { c, words: keywords(title), requestPending: rule === 'REQUEST', reasons: new Set() }
  if (!ownerId) w.reasons.add('unclear_owner')
  ctx.open.push(w)
  link(ctx, w, m)
  return w
}

function changeDeadline(w: Working, m: Message, d: Deadline, rule: string) {
  const prev = w.c.deadline
  if (prev.dueAt === d.dueAt && prev.certainty === d.certainty) return
  w.c.deadline = { ...d, evidence: evidence(m, rule) }
  addEvent(w, { type: 'deadline_changed', at: m.sentAt, by: m.authorId, evidence: evidence(m, rule), from: prev.dueAt, to: d.dueAt })
}

function setStatus(w: Working, m: Message, status: Commitment['status'], type: CommitmentEvent['type'], rule: string) {
  const from = w.c.status
  if (from === status) return
  w.c.status = status
  addEvent(w, { type, at: m.sentAt, by: m.authorId, evidence: evidence(m, rule), from, to: status })
}

function applyUpdate(ctx: Ctx, w: Working, m: Message, signals: Signal[], linkRule: string) {
  const a = m.authorId
  const c = w.c
  const isOwner = a === c.ownerId
  const isRequester = a === c.requesterId
  const isCoord = ctx.coordinators.has(a)
  const authority = isOwner || isRequester || isCoord
  const deadline = parseDeadline(m.text, { saidAt: m.sentAt, tz: tzOf(ctx, a) })
  const rule = (s: Signal) => (linkRule === 'LINK_REPLY' || linkRule.startsWith('LINK_THREAD') ? s.rule : `${s.rule}+${linkRule}`)

  link(ctx, w, m)

  // Acceptance of a request or of a delegation
  const accept = has(signals, 'accept') ?? has(signals, 'commit')
  if (accept && a === w.pendingDelegate) {
    const from = c.ownerId
    c.ownerId = a
    w.pendingDelegate = undefined
    w.reasons.delete('unaccepted_delegation')
    w.lastOwnerMsgAt = Date.parse(m.sentAt)
    addEvent(w, { type: 'delegated', at: m.sentAt, by: a, evidence: evidence(m, 'DELEGATION_ACCEPTED'), from, to: a })
    if (deadline) restateDeadline(ctx, w, m, deadline, 'DEADLINE_FROM_NEW_OWNER')
  } else if (accept && isOwner && w.requestPending && !has(signals, 'decline')) {
    w.requestPending = false
    addEvent(w, { type: 'accepted', at: m.sentAt, by: a, evidence: evidence(m, rule(accept)) })
    if (deadline) restateDeadline(ctx, w, m, deadline, 'DEADLINE_FROM_ACCEPTANCE')
  }

  if (has(signals, 'decline') && (isOwner || a === w.pendingDelegate)) w.reasons.add('unclear_owner')

  const delegate = has(signals, 'delegate')
  if (delegate && authority) {
    const targets = mentionedPeople(m, [...ctx.people.values()]).filter((p) => p !== c.ownerId)
    if (targets.length === 0 && !isOwner && /\b(i'?ll|i will|i can|i'?m)\b/i.test(m.text)) {
      // Someone involved volunteers to take it over
      const from = c.ownerId
      c.ownerId = a
      addEvent(w, { type: 'delegated', at: m.sentAt, by: a, evidence: evidence(m, rule(delegate)), from, to: a })
    } else if (targets.length >= 1) {
      w.pendingDelegate = targets[0]
      w.reasons.add('unaccepted_delegation')
      addEvent(w, { type: 'review_flagged', at: m.sentAt, by: a, evidence: evidence(m, rule(delegate)), to: targets[0] })
    } else {
      w.reasons.add('unclear_owner')
    }
  }

  const done = has(signals, 'done')
  const cancel = has(signals, 'cancel')
  const defer = has(signals, 'defer')
  const reschedule = has(signals, 'reschedule')

  if (cancel) {
    if (isRequester || isCoord) setStatus(w, m, 'cancelled', 'cancelled', rule(cancel))
    else w.reasons.add('conflicting_evidence')
    return
  }
  if (defer) {
    if (deadline && deadline.certainty === 'firm' && authority) {
      // Postponed to a concrete date is a deadline change, not a deferral
      changeDeadline(w, m, deadline, rule(defer))
      return
    }
    if (authority) setStatus(w, m, 'deferred', 'deferred', rule(defer))
    else w.reasons.add('conflicting_evidence')
    return
  }
  if (done) {
    if (authority) {
      setStatus(w, m, 'done', 'completed', rule(done))
      w.reasons.delete('ambiguous_completion')
    } else {
      w.reasons.add('unauthorised_status_claim')
      addEvent(w, { type: 'review_flagged', at: m.sentAt, by: a, evidence: evidence(m, rule(done)) })
    }
    return
  }
  if ((reschedule || (accept && !w.requestPending && isOwner)) && deadline && authority) {
    if (c.status !== 'open' && (isRequester || isCoord)) setStatus(w, m, 'open', 'reopened', 'REOPEN')
    if (c.status === 'open') {
      if (reschedule) changeDeadline(w, m, deadline, rule(reschedule))
      else restateDeadline(ctx, w, m, deadline, 'DEADLINE_RESTATED')
    }
  }
}

/**
 * An acceptance or restatement only moves the deadline when it names a different
 * local day; "sure, Friday" keeps an earlier "Friday 6pm". A hedge makes it tentative.
 */
function restateDeadline(ctx: Ctx, w: Working, m: Message, d: Deadline, rule: string) {
  const prev = w.c.deadline
  if (!prev.dueAt || !d.dueAt) return changeDeadline(w, m, d, rule)
  const tz = tzOf(ctx, w.c.ownerId)
  const day = (iso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, dateStyle: 'short' }).format(new Date(iso))
  if (day(prev.dueAt) !== day(d.dueAt)) return changeDeadline(w, m, d, rule)
  if (d.certainty === 'tentative' && prev.certainty === 'firm') changeDeadline(w, m, { ...prev, certainty: 'tentative', phrase: d.phrase }, rule)
}

function processMessage(ctx: Ctx, m: Message) {
  const signals = detectSignals(m.text)
  const a = m.authorId
  const target = findTarget(ctx, m, signals)

  if (target && 'ambiguous' in target) {
    if (has(signals, 'done') || has(signals, 'cancel')) {
      for (const w of target.ambiguous) w.reasons.add('ambiguous_completion')
      return
    }
  } else if (target?.strength === 'weak') {
    if (has(signals, 'done') || has(signals, 'cancel') || has(signals, 'defer')) {
      target.w.reasons.add('weak_cross_thread_link')
      addEvent(target.w, { type: 'review_flagged', at: m.sentAt, by: a, evidence: evidence(m, target.rule) })
    }
    return
  }

  const strong = target && !('ambiguous' in target) ? target : null
  const request = has(signals, 'request')
  const commit = has(signals, 'commit')
  const statusSignal = signals.some((s) => ['done', 'cancel', 'defer', 'reschedule', 'delegate', 'decline'].includes(s.kind))

  // A new request to someone opens a commitment unless it is about existing work
  const to = addressees(m, [...ctx.people.values()])
  const aboutExisting = strong && (strong.rule === 'LINK_REPLY' || overlap(strong.w.words, keywords(m.text)) >= STRONG_LINK || NUDGE.test(m.text))
  if (request && !statusSignal && to.length > 0 && !aboutExisting && !NUDGE.test(m.text)) {
    const deadline = parseDeadline(m.text, { saidAt: m.sentAt, tz: tzOf(ctx, a) })
    const w = newCommitment(ctx, m, to[0], a, 'REQUEST', deadline)
    if (to.length > 1) w.reasons.add('unclear_owner')
    return
  }

  if (strong) {
    const isNewPromise =
      commit && !statusSignal && !has(signals, 'accept') && strong.w.c.ownerId !== a && strong.w.pendingDelegate !== a && strong.rule !== 'LINK_REPLY'
    if (!isNewPromise) {
      applyUpdate(ctx, strong.w, m, signals, strong.rule)
      return
    }
  }

  // A promise by the author opens a commitment they own
  if (commit && !statusSignal && !request) {
    const replied = m.replyToId ? ctx.messages.get(m.replyToId) : undefined
    const requesterId = replied && replied.authorId !== a ? replied.authorId : null
    const deadline = parseDeadline(m.text, { saidAt: m.sentAt, tz: tzOf(ctx, a) })
    const w = newCommitment(ctx, m, a, requesterId, 'COMMIT', deadline)
    w.requestPending = false
  }
}

function applyDecision(ctx: Ctx, w: Working, d: HumanDecision) {
  const role = ctx.people.get(d.by)?.role ?? 'member'
  if (!canDecide(role, d.type, d.by === w.c.ownerId)) return
  const c = w.c
  const ev = (type: CommitmentEvent['type'], from?: string | null, to?: string | null): CommitmentEvent => ({
    type,
    at: d.at,
    by: d.by,
    evidence: { messageId: '', threadId: '', at: d.at, quote: quote(d.note ?? d.type.replace(/_/g, ' ')), rule: `HUMAN_${d.type.toUpperCase()}` },
    from,
    to,
  })
  const status = (s: Commitment['status']) => {
    if (c.status === s) return
    c.events.push(ev('human_decision', c.status, s))
    c.status = s
  }
  switch (d.type) {
    case 'mark_done':
      return status('done')
    case 'cancel':
      return status('cancelled')
    case 'defer':
      return status('deferred')
    case 'reopen':
      return status('open')
    case 'reassign':
      if (d.ownerId && d.ownerId !== c.ownerId) {
        c.events.push(ev('delegated', c.ownerId, d.ownerId))
        c.ownerId = d.ownerId
        w.pendingDelegate = undefined
        w.reasons.delete('unaccepted_delegation')
        w.reasons.delete('unclear_owner')
      }
      return
    case 'change_deadline':
      c.events.push(ev('deadline_changed', c.deadline.dueAt, d.dueAt ?? null))
      c.deadline = {
        dueAt: d.dueAt ?? null,
        certainty: d.dueAt ? 'firm' : 'none',
        phrase: 'set by coordinator',
        interpretedTz: tzOf(ctx, c.ownerId),
        evidence: ev('deadline_changed').evidence,
      }
      w.reasons.delete('tentative_deadline')
      return
    case 'resolve_review':
      c.events.push(ev('human_decision', 'needs_review', 'reviewed'))
      w.reasons.clear()
      w.pendingDelegate = undefined
      return
    case 'set_progress':
      if (d.progress) c.progress = d.progress
      if (d.by === c.ownerId) w.lastOwnerMsgAt = Date.parse(d.at)
      return
    case 'report_blocker':
      c.blockers = [...(c.blockers ?? []), { at: d.at, by: d.by, text: d.note ?? '', resolved: false }]
      c.progress = 'blocked'
      if (d.by === c.ownerId) w.lastOwnerMsgAt = Date.parse(d.at)
      return
    case 'resolve_blocker':
      c.blockers = (c.blockers ?? []).map((b) => ({ ...b, resolved: true }))
      if (c.progress === 'blocked') c.progress = 'in_progress'
      return
    case 'submit_work':
      c.submissions = [
        ...(c.submissions ?? []),
        { id: d.submissionId ?? d.id, at: d.at, by: d.by, note: d.note ?? '', fileIds: d.fileIds ?? [], state: 'pending' },
      ]
      c.progress = 'submitted'
      if (d.by === c.ownerId) w.lastOwnerMsgAt = Date.parse(d.at)
      return
    case 'approve_submission':
    case 'reject_submission': {
      const approve = d.type === 'approve_submission'
      c.submissions = (c.submissions ?? []).map((s) =>
        s.id === d.submissionId && s.state === 'pending' ? { ...s, state: approve ? 'approved' : 'rejected', decidedBy: d.by, decidedAt: d.at } : s,
      )
      if (approve) {
        if (c.status !== 'done') {
          c.events.push({ ...ev('completed', c.status, 'done') })
          c.status = 'done'
        }
      } else c.progress = 'in_progress'
      return
    }
  }
}

function manualCommitment(ctx: Ctx, t: ManualTask): Working {
  const c: Commitment = {
    id: `c_${t.id}`,
    title: t.title,
    sourceMessageId: '',
    source: 'manual',
    teamId: t.teamId,
    requesterId: t.requesterId,
    ownerId: t.ownerId,
    deadline: { dueAt: t.dueAt, certainty: t.dueAt ? 'firm' : 'none', phrase: t.dueAt ? 'set by coordinator' : '', interpretedTz: tzOf(ctx, t.ownerId) },
    status: 'open',
    responseState: 'pending',
    needsReview: false,
    reviewReasons: [],
    threadIds: [],
    events: [
      {
        type: 'created',
        at: t.createdAt,
        by: t.requesterId,
        to: t.ownerId,
        evidence: { messageId: '', threadId: '', at: t.createdAt, quote: quote(t.title), rule: 'MANUAL_TASK' },
      },
    ],
    linkedMessageIds: [],
    progress: 'not_started',
    blockers: [],
    submissions: [],
  }
  return { c, words: keywords(t.title), requestPending: false, reasons: new Set() }
}

/**
 * Replays the whole history in time order and returns every commitment with
 * owner, deadline, status, response state and review flags resolved.
 */
export function resolveCommitments(dataset: Dataset, now: IsoUtc, decisions: HumanDecision[] = [], manualTasks: ManualTask[] = []): Commitment[] {
  const ctx: Ctx = {
    people: new Map(dataset.people.map((p) => [p.id, p])),
    coordinators: new Set(dataset.people.filter((p) => p.role === 'coordinator').map((p) => p.id)),
    byMessage: new Map(),
    open: [],
    messages: new Map(dataset.messages.map((m) => [m.id, m])),
  }
  for (const m of dataset.messages) processMessage(ctx, m)

  const all = [...ctx.open, ...manualTasks.map((t) => manualCommitment(ctx, t))]
  const byId = new Map(all.map((w) => [w.c.id, w]))
  const sorted = [...decisions].sort((a, b) => (a.at === b.at ? (a.id < b.id ? -1 : 1) : a.at < b.at ? -1 : 1))
  for (const d of sorted) {
    const w = byId.get(d.commitmentId)
    if (w) applyDecision(ctx, w, d)
  }

  const nowMs = Date.parse(now)
  return all.map((w) => finalise(w, nowMs, ctx.people))
}

function finalise(w: Working, nowMs: number, people: Map<string, Person>): Commitment {
  const c = w.c
  const teamId = c.teamId ?? (c.ownerId ? people.get(c.ownerId)?.teamId : undefined)
  if (c.deadline.certainty === 'tentative' && c.deadline.dueAt && nowMs > Date.parse(c.deadline.dueAt) && c.status === 'open') {
    w.reasons.add('tentative_deadline')
  }
  if (c.status !== 'open') {
    // Terminal work never waits on review for chasing; keep only reasons that still matter
    w.reasons.delete('tentative_deadline')
  }
  const due = c.deadline.dueAt ? Date.parse(c.deadline.dueAt) : null
  const created = Date.parse(c.events[0].at)
  const last = w.lastOwnerMsgAt
  // Open work past its deadline needs a reply after the deadline; otherwise any reply from the owner counts
  const responded = last !== undefined && (c.status === 'open' && due !== null && nowMs > due ? last > due : last >= created)
  return {
    ...c,
    ...(teamId ? { teamId } : {}),
    responseState: responded ? 'responded' : 'pending',
    reviewReasons: [...w.reasons].sort(),
    needsReview: w.reasons.size > 0,
  }
}
