import { planSteps, type DirectoryPerson, type KnownTicket, type PlannedStep } from '../../../src/automation/plan'
import type { ManualTask } from '../../../src/engine/types'
import { admin, applyOps, uuid, type Op } from './admin'
import { AiUnavailable, InvalidAiOutput, minConfidence, readEmail } from './ai'
import { ctxForProfile } from './context'
import { decryptSecret, encryptSecret } from './crypto'
import { gmailGet, newMessageIds, parseGmailMessage, refreshAccess, RevokedError, TransientError, type Fetch, type GmailMessage } from './gmail'
import { HttpError } from './http'
import { saveMinutesPage } from './kb'
import { auditOp, notificationOps, reviewerIds } from './notify'
import { decideAs } from './routes/work'
import { syncOrg } from './sync'

// Gmail → AI reading → tickets. Every step writes an automation_events row, so the activity
// feed only ever shows what really happened. Emails are never dropped: failures stay in
// inbound_emails with a retry time, and anything uncertain waits in the review list.

const MAX_ATTEMPTS = 5
const FETCH_PER_RUN = 40
const PROCESS_PER_RUN = 15

export function retryDelayMs(attempts: number): number {
  return Math.min(60, 2 ** attempts) * 60_000
}

export async function eventOp(orgId: string, kind: string, message: string, extra: { emailId?: string; taskKey?: string; detail?: unknown } = {}): Promise<void> {
  await admin().from('automation_events').insert({ org_id: orgId, kind, message: message.slice(0, 500), email_id: extra.emailId ?? null, task_key: extra.taskKey ?? null, detail: extra.detail ?? null })
}

// ---------------------------------------------------------------------------
// Gmail sync
// ---------------------------------------------------------------------------

interface AccountRow {
  id: string
  org_id: string
  email: string
  refresh_token_enc: string | null
  access_token_enc: string | null
  access_expires_at: string | null
  history_id: string | null
  initial_days: number
  messages_seen: number
  connected_by: string | null
}

async function accessToken(a: AccountRow, f: Fetch): Promise<string> {
  if (a.access_token_enc && a.access_expires_at && Date.parse(a.access_expires_at) > Date.now() + 60_000) return decryptSecret(a.access_token_enc)
  if (!a.refresh_token_enc) throw new RevokedError('No refresh token stored. Connect Gmail again.')
  const t = await refreshAccess(decryptSecret(a.refresh_token_enc), f)
  const expires = new Date(Date.now() + t.expires_in * 1000).toISOString()
  await admin()
    .from('gmail_accounts')
    .update({ access_token_enc: encryptSecret(t.access_token), access_expires_at: expires, ...(t.refresh_token ? { refresh_token_enc: encryptSecret(t.refresh_token) } : {}), updated_at: new Date().toISOString() })
    .eq('id', a.id)
  return t.access_token
}

/** Fetches new mail for one connected account and stores each message once. */
export async function syncAccount(a: AccountRow, f: Fetch = fetch): Promise<{ fetched: number; error?: string }> {
  try {
    const token = await accessToken(a, f)
    const { ids, historyId } = await newMessageIds(token, a.history_id, a.initial_days, f)
    const { data: known } = ids.length ? await admin().from('inbound_emails').select('gmail_message_id').eq('org_id', a.org_id).in('gmail_message_id', ids) : { data: [] }
    const seen = new Set((known ?? []).map((k) => k.gmail_message_id as string))
    let fetched = 0
    for (const id of ids.filter((x) => !seen.has(x)).slice(0, FETCH_PER_RUN)) {
      const m = parseGmailMessage(await gmailGet<GmailMessage>(`/messages/${encodeURIComponent(id)}?format=full`, token, f))
      const { data: inserted } = await admin()
        .from('inbound_emails')
        .upsert(
          {
            org_id: a.org_id,
            account_id: a.id,
            source: 'gmail',
            gmail_message_id: m.gmailMessageId,
            gmail_thread_id: m.gmailThreadId,
            from_email: m.fromEmail,
            from_name: m.fromName,
            to_emails: m.toEmails,
            cc_emails: m.ccEmails,
            subject: m.subject,
            sent_at: m.sentAt,
            body_text: m.body,
            automated: m.automated,
          },
          { onConflict: 'org_id,gmail_message_id', ignoreDuplicates: true },
        )
        .select('id')
      if (inserted?.length) {
        fetched++
        await eventOp(a.org_id, 'email_detected', `New email detected: "${m.subject || '(no subject)'}" from ${m.fromName ?? m.fromEmail ?? 'unknown'}`, { emailId: inserted[0].id as string })
      }
    }
    await admin()
      .from('gmail_accounts')
      .update({ history_id: historyId ?? a.history_id, last_sync_at: new Date().toISOString(), last_error: null, status: 'connected', messages_seen: a.messages_seen + fetched, updated_at: new Date().toISOString() })
      .eq('id', a.id)
    return { fetched }
  } catch (e) {
    const revoked = e instanceof RevokedError
    const message = e instanceof Error ? e.message : 'Gmail sync failed'
    await admin().from('gmail_accounts').update({ status: revoked ? 'revoked' : 'error', last_error: message.slice(0, 300), updated_at: new Date().toISOString() }).eq('id', a.id)
    await eventOp(a.org_id, 'gmail_error', `Gmail sync for ${a.email} failed: ${message}`)
    if (!revoked && !(e instanceof TransientError) && !(e instanceof HttpError)) console.error('gmail sync failed', a.id, message)
    return { fetched: 0, error: message }
  }
}

// ---------------------------------------------------------------------------
// Processing one email
// ---------------------------------------------------------------------------

export interface EmailRow {
  id: string
  org_id: string
  account_id: string | null
  source: 'gmail' | 'test'
  gmail_message_id: string
  gmail_thread_id: string
  from_email: string | null
  from_name: string | null
  to_emails: string[]
  cc_emails: string[]
  subject: string | null
  sent_at: string
  body_text: string
  automated: boolean
  attempts: number
}

const EMAIL_COLUMNS = 'id, org_id, account_id, source, gmail_message_id, gmail_thread_id, from_email, from_name, to_emails, cc_emails, subject, sent_at, body_text, automated, attempts'

async function directoryFor(orgId: string): Promise<{ directory: DirectoryPerson[]; profileByPerson: Map<string, string> }> {
  const [{ data: people }, { data: profiles }] = await Promise.all([
    admin().from('external_people').select('external_id, name, timezone, role, email').eq('org_id', orgId),
    admin().from('profiles').select('id, person_id, email, role, is_active').eq('org_id', orgId),
  ])
  const byPerson = new Map((profiles ?? []).map((p) => [p.person_id as string, p]))
  const directory = (people ?? []).map((p) => {
    const prof = byPerson.get(p.external_id as string)
    return {
      id: p.external_id as string,
      name: p.name as string,
      email: ((p.email as string | null) || (prof?.email as string | null) || null)?.toLowerCase() ?? null,
      role: (prof ? (prof.role === 'member' ? 'member' : 'coordinator') : p.role === 'coordinator' ? 'coordinator' : 'member') as 'coordinator' | 'member',
      timezone: (p.timezone as string) || 'UTC',
    }
  })
  return { directory, profileByPerson: new Map((profiles ?? []).filter((p) => p.is_active).map((p) => [p.person_id as string, p.id as string])) }
}

async function ticketsFor(orgId: string): Promise<KnownTicket[]> {
  const { data } = await admin().from('tasks').select('task_key, title, owner_person, requester_person, status, origin').eq('org_id', orgId).limit(2000)
  return (data ?? []).map((t) => ({
    taskKey: t.task_key as string,
    title: (t.title as string) ?? '',
    ownerId: (t.owner_person as string | null) ?? null,
    requesterId: (t.requester_person as string | null) ?? null,
    // in_progress and overdue are stored views of open work
    status: (['done', 'cancelled', 'deferred'].includes(t.status as string) ? t.status : 'open') as KnownTicket['status'],
    threadId: ((t.origin as { threadId?: string } | null)?.threadId as string | undefined) ?? null,
  }))
}

function summarise(s: PlannedStep): Record<string, unknown> {
  if (s.kind === 'create') return { kind: s.kind, taskKey: `c_${s.ticketId}`, title: s.item.title, ownerId: s.ownerId, dueAt: s.dueAt, assignReason: s.assignReason, deadlineNote: s.deadlineNote, priority: s.item.priority, priorityReason: s.item.priority_reason }
  if (s.kind === 'decide') return { kind: s.kind, taskKey: s.taskKey, type: s.type, by: s.byPersonId, reason: s.reason, dueAt: s.dueAt ?? null }
  if (s.kind === 'review') return { kind: s.kind, reason: s.reason, taskKey: s.taskKey ?? null, item: s.item ?? null, suggestedOwnerId: s.suggestedOwnerId ?? null }
  return { kind: s.kind, reason: s.reason }
}

/** Creates one ticket from an email action item. Idempotent: the ticket id is derived from the message. */
export async function createTicket(
  e: EmailRow,
  step: Extract<PlannedStep, { kind: 'create' }>,
  meta: { mode: string; model: string; confidence: number; actorProfileId: string | null; requesterId: string; profileByPerson: Map<string, string>; teamOf: (id: string) => string | undefined; approvedBy?: string },
): Promise<string | null> {
  const taskKey = `c_${step.ticketId}`
  const { data: exists } = await admin().from('tasks').select('id').eq('org_id', e.org_id).eq('task_key', taskKey).maybeSingle()
  if (exists) return null
  const manual: ManualTask = { id: step.ticketId, title: step.item.title.slice(0, 300), ownerId: step.ownerId, requesterId: step.requesterId ?? meta.requesterId, teamId: meta.teamOf(step.ownerId), dueAt: step.dueAt, createdAt: e.sent_at }
  const id = uuid()
  const ownerProfile = meta.profileByPerson.get(step.ownerId) ?? null
  const origin = {
    kind: e.source,
    emailId: e.id,
    messageId: e.gmail_message_id,
    threadId: e.gmail_thread_id,
    subject: e.subject,
    from: e.from_email,
    mode: meta.mode,
    model: meta.model,
    confidence: meta.confidence,
    assignReason: step.assignReason,
    deadlineNote: step.deadlineNote,
    priorityReason: step.item.priority_reason,
    approvedBy: meta.approvedBy ?? null,
  }
  const description = [step.item.description, step.item.blockers.length ? `Blockers: ${step.item.blockers.join('; ')}` : '', `From email "${e.subject ?? ''}" (${e.from_email ?? 'unknown sender'})`].filter(Boolean).join('\n')
  const ops: Op[] = [
    {
      op: 'insert',
      table: 'tasks',
      row: { id, org_id: e.org_id, task_key: taskKey, source: 'manual', manual_task: manual, title: manual.title, description: description.slice(0, 4000), priority: step.item.priority, owner_person: step.ownerId, owner_profile_id: ownerProfile, requester_person: manual.requesterId, team_key: manual.teamId ?? null, due_at: step.dueAt, created_by: meta.actorProfileId, origin },
    },
    { op: 'insert', table: 'task_assignments', row: { org_id: e.org_id, task_id: id, assignee_person: step.ownerId, assignee_profile_id: ownerProfile, assigned_by: meta.actorProfileId, reason: meta.approvedBy ? `Approved from email by a coordinator: ${step.assignReason}` : `Automatic from email: ${step.assignReason}` } },
    auditOp(e.org_id, meta.actorProfileId, 'automation', meta.approvedBy ? 'automation.ticket_approved' : 'automation.ticket_created', 'task', taskKey, null, { manual, origin }),
    ...(ownerProfile ? notificationOps({ orgId: e.org_id, recipients: [ownerProfile], type: 'task_assigned', title: `New task from email: ${manual.title}`, body: step.dueAt ? `Due ${step.dueAt}` : 'No deadline in the email', taskKey, eventKey: `mail:${step.ticketId}` }) : []),
  ]
  for (const blocker of step.item.blockers.slice(0, 5)) {
    ops.push({ op: 'insert', table: 'blockers', row: { org_id: e.org_id, task_id: id, decision_key: null, reporter_profile_id: null, reporter_person: 'automation', description: blocker.slice(0, 2000) } })
  }
  await applyOps(ops)
  return taskKey
}

/** Reads, plans and applies one stored email. Safe to call twice: it claims the row first. */
export async function processEmail(row: EmailRow, f: Fetch = fetch): Promise<{ status: string; taskKeys: string[] }> {
  const { data: claimed } = await admin().from('inbound_emails').update({ status: 'processing' }).eq('id', row.id).in('status', ['pending', 'failed']).select('id')
  if (!claimed?.length) return { status: 'skipped', taskKeys: [] }
  const orgId = row.org_id
  try {
    const [{ directory, profileByPerson }, tickets, { data: earlier }, { data: account }] = await Promise.all([
      directoryFor(orgId),
      ticketsFor(orgId),
      admin().from('inbound_emails').select('from_email, from_name, sent_at, body_text').eq('org_id', orgId).eq('gmail_thread_id', row.gmail_thread_id).lt('sent_at', row.sent_at).order('sent_at').limit(10),
      row.account_id ? admin().from('gmail_accounts').select('connected_by').eq('id', row.account_id).maybeSingle() : Promise.resolve({ data: null }),
    ])
    const sender = directory.find((p) => p.email && p.email === row.from_email?.toLowerCase())
    const reading = await readEmail(
      {
        subject: row.subject ?? '',
        fromName: row.from_name,
        fromEmail: row.from_email,
        toEmails: [...row.to_emails, ...row.cc_emails],
        sentAt: row.sent_at,
        senderTimezone: sender?.timezone ?? 'UTC',
        body: row.body_text,
        automated: row.automated,
        thread: (earlier ?? []).map((m) => ({ from: (m.from_name as string) ?? (m.from_email as string) ?? 'unknown', sentAt: m.sent_at as string, body: (m.body_text as string) ?? '' })),
        directory: directory.map((p) => ({ name: p.name, email: p.email, role: p.role })),
        openTickets: tickets.filter((t) => t.threadId === row.gmail_thread_id && t.status === 'open').map((t) => ({ title: t.title, owner: directory.find((p) => p.id === t.ownerId)?.name ?? null })),
      },
      f,
    )
    const a = reading.analysis
    await eventOp(orgId, a.action_required ? 'actionable' : 'not_actionable', a.action_required ? `${reading.mode === 'ai' ? 'AI' : 'Rules'} identified ${a.classification.replace('_', ' ')}: "${row.subject ?? ''}"` : `No action needed (${a.classification}): "${row.subject ?? ''}"`, { emailId: row.id, detail: { confidence: a.confidence, mode: reading.mode } })

    const steps = planSteps(a, { now: new Date().toISOString(), messageId: row.gmail_message_id, threadId: row.gmail_thread_id, sentAt: row.sent_at, fromEmail: row.from_email, toEmails: [...row.to_emails, ...row.cc_emails], directory, tickets, minConfidence: minConfidence() })
    const coordinatorPerson = directory.find((p) => p.role === 'coordinator')?.id ?? 'automation'
    const connectedBy = (account as { connected_by?: string } | null)?.connected_by ?? null
    const teamOf = new Map((await admin().from('external_people').select('external_id, team_key').eq('org_id', orgId)).data?.map((p) => [p.external_id as string, (p.team_key as string | null) ?? undefined]) ?? [])
    const taskKeys: string[] = []
    let applied = 0
    let review = 0
    const outcomes: Record<string, unknown>[] = []

    for (const s of steps) {
      if (s.kind === 'create') {
        const key = await createTicket(row, s, { mode: reading.mode, model: reading.model, confidence: a.confidence, actorProfileId: connectedBy, requesterId: s.requesterId ?? coordinatorPerson, profileByPerson, teamOf: (id) => teamOf.get(id) })
        const owner = directory.find((p) => p.id === s.ownerId)?.name ?? s.ownerId
        if (key) {
          applied++
          taskKeys.push(key)
          await eventOp(orgId, 'ticket_created', `Ticket created automatically: "${s.item.title}"`, { emailId: row.id, taskKey: key, detail: { dueAt: s.dueAt, priority: s.item.priority } })
          await eventOp(orgId, 'ticket_assigned', `Assigned to ${owner}: ${s.assignReason}`, { emailId: row.id, taskKey: key })
        } else outcomes.push({ kind: 'ignore', reason: `Ticket c_${s.ticketId} already exists (duplicate delivery)` })
        outcomes.push(summarise(s))
        continue
      }
      if (s.kind === 'decide') {
        const profileId = profileByPerson.get(s.byPersonId)
        const ctx = profileId ? await ctxForProfile(profileId) : null
        if (!ctx || ctx.orgId !== orgId) {
          review++
          outcomes.push({ kind: 'review', reason: `${s.reason}; but the sender has no active FollowThru account to act as`, taskKey: s.taskKey })
          await eventOp(orgId, 'review_needed', `Message requires human review: sender of "${row.subject ?? ''}" has no active account`, { emailId: row.id, taskKey: s.taskKey })
          continue
        }
        try {
          await decideAs(ctx, { taskKey: s.taskKey, type: s.type, input: { note: s.note, ...(s.dueAt ? { dueAt: s.dueAt } : {}) } })
          applied++
          taskKeys.push(s.taskKey)
          outcomes.push(summarise(s))
          const label = { report_blocker: 'Blocker detected', request_extension: 'Deadline extension requested', submit_work: 'Completion reported (waiting for coordinator approval)', mark_done: 'Marked done', cancel: 'Cancelled', change_deadline: 'Deadline changed' }[s.type as string] ?? 'Updated'
          await eventOp(orgId, s.type === 'report_blocker' ? 'blocker_detected' : s.type === 'request_extension' ? 'extension_requested' : 'ticket_updated', `Existing ticket updated from an email reply: ${label}`, { emailId: row.id, taskKey: s.taskKey, detail: { reason: s.reason } })
        } catch (err) {
          review++
          const msg = err instanceof HttpError ? err.message : 'could not be applied'
          outcomes.push({ kind: 'review', reason: `${s.reason}; not applied: ${msg}`, taskKey: s.taskKey })
          await eventOp(orgId, 'review_needed', `Message requires human review: ${msg}`, { emailId: row.id, taskKey: s.taskKey })
        }
        continue
      }
      if (s.kind === 'review') {
        review++
        outcomes.push(summarise(s))
        await eventOp(orgId, 'review_needed', `Message requires human review: ${s.reason}`, { emailId: row.id, taskKey: s.taskKey })
        continue
      }
      outcomes.push(summarise(s))
    }

    const status = review > 0 ? 'review' : applied > 0 ? 'processed' : 'ignored'
    if (status === 'ignored') await eventOp(orgId, 'ignored', `Ignored: ${steps.map((s) => ('reason' in s ? s.reason : '')).join('; ')}`, { emailId: row.id })
    await admin()
      .from('inbound_emails')
      .update({ status, classification: a.classification, ai_mode: reading.mode, ai_model: reading.model, confidence: a.confidence, ai_result: a, decision: { steps: outcomes }, task_keys: taskKeys, processed_at: new Date().toISOString(), last_error: null, attempts: row.attempts + 1 })
      .eq('id', row.id)
    if (a.classification === 'meeting_minutes' && a.minutes) {
      // The knowledge base is a side effect: if saving the page fails, the email still counts as processed
      try {
        const tickets = new Set(steps.flatMap((s) => (s.kind === 'create' ? [`c_${s.ticketId}`] : [])))
        const page = await saveMinutesPage(row, a, tickets, connectedBy)
        if (page.created) await eventOp(orgId, 'minutes_saved', `Meeting minutes saved to the knowledge base as a draft: "${page.title}"`, { emailId: row.id, detail: { pageId: page.pageId } })
      } catch (err) {
        await eventOp(orgId, 'minutes_not_saved', `Meeting minutes could not be saved to the knowledge base: ${err instanceof Error ? err.message : 'unknown error'}`, { emailId: row.id })
      }
    }
    if (applied > 0) await syncOrg(orgId, connectedBy, 'write')
    if (review > 0) {
      const reviewers = await reviewerIds(orgId, null)
      await applyOps(notificationOps({ orgId, recipients: reviewers, type: 'email_review', title: `Email needs review: ${row.subject ?? '(no subject)'}`, body: 'Open Automation to decide', link: '/automation', eventKey: `email_review:${row.id}` }))
    }
    return { status, taskKeys }
  } catch (err) {
    const attempts = row.attempts + 1
    const message = err instanceof Error ? err.message : 'Processing failed'
    const invalid = err instanceof InvalidAiOutput
    // Invalid AI output twice goes to a person; provider or network trouble retries with backoff
    const status = invalid && attempts >= 2 ? 'review' : attempts >= MAX_ATTEMPTS ? 'failed' : 'pending'
    await admin()
      .from('inbound_emails')
      .update({ status, attempts, last_error: message.slice(0, 300), next_attempt_at: new Date(Date.now() + retryDelayMs(attempts)).toISOString() })
      .eq('id', row.id)
    await eventOp(orgId, status === 'pending' ? 'retry_scheduled' : 'processing_failed', `${invalid ? 'AI output rejected' : err instanceof AiUnavailable ? 'AI provider unavailable' : 'Processing failed'} for "${row.subject ?? ''}": ${message}${status === 'pending' ? ' (will retry)' : ''}`, { emailId: row.id })
    if (!(err instanceof AiUnavailable) && !invalid && !(err instanceof HttpError)) console.error('email processing failed', row.id, message)
    return { status, taskKeys: [] }
  }
}

/** Processes emails that are due, oldest first. */
export async function processPending(orgId: string, f: Fetch = fetch, limit = PROCESS_PER_RUN): Promise<{ processed: number }> {
  const { data } = await admin().from('inbound_emails').select(EMAIL_COLUMNS).eq('org_id', orgId).eq('status', 'pending').lte('next_attempt_at', new Date().toISOString()).order('sent_at').limit(limit)
  let processed = 0
  for (const row of (data ?? []) as EmailRow[]) {
    await processEmail(row, f)
    processed++
  }
  return { processed }
}

/** One automation round for a workspace: fetch new Gmail messages, then process what is due. */
export async function tick(orgId: string, f: Fetch = fetch, minIntervalMs = 45_000): Promise<{ fetched: number; processed: number; errors: string[] }> {
  const { data: accounts } = await admin().from('gmail_accounts').select('id, org_id, email, refresh_token_enc, access_token_enc, access_expires_at, history_id, initial_days, messages_seen, connected_by, last_sync_at, status').eq('org_id', orgId).neq('status', 'revoked')
  let fetched = 0
  const errors: string[] = []
  for (const a of accounts ?? []) {
    if (a.last_sync_at && Date.now() - Date.parse(a.last_sync_at as string) < minIntervalMs) continue
    const r = await syncAccount(a as AccountRow, f)
    fetched += r.fetched
    if (r.error) errors.push(`${a.email}: ${r.error}`)
  }
  const { processed } = await processPending(orgId, f)
  return { fetched, processed, errors }
}

export { EMAIL_COLUMNS }
