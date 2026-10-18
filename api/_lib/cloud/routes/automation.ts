import { ticketIdFor } from '../../../../src/automation/plan'
import type { ActionItem } from '../../../../src/automation/schema'
import type { ApiRequest, ApiResponse } from '../../handlers'
import { admin, uuid } from '../admin'
import { aiConfig, minConfidence } from '../ai'
import { createTicket, eventOp, EMAIL_COLUMNS, processEmail, tick, type EmailRow } from '../automation'
import { requireRole, requireUser } from '../context'
import { encryptSecret, signState, verifyState } from '../crypto'
import { authUrl, exchangeCode, gmailGet, gmailThreadLink, googleConfig, revoke } from '../gmail'
import { bad, bodyOf, forbidden, header, json, notFound, rateLimit, str } from '../http'
import { auditOp } from '../notify'
import { applyOps } from '../admin'
import { syncOrg } from '../sync'

function query(req: ApiRequest, key: string): string {
  const q = req.query?.[key]
  if (typeof q === 'string') return q
  try {
    return new URL(req.url ?? '', 'http://x').searchParams.get(key) ?? ''
  } catch {
    return ''
  }
}

const redirect = (to: string): ApiResponse => ({ status: 302, body: {}, headers: { Location: to } })

/** Starts Google OAuth for the workspace. Coordinators only; read-only Gmail scope. */
export async function gmailConnect(req: ApiRequest) {
  const ctx = await requireUser(req)
  requireRole(ctx, 'coordinator')
  const b = bodyOf(req)
  const days = Number(b.initialDays ?? 7)
  if (!Number.isInteger(days) || days < 1 || days > 90) throw bad('Choose between 1 and 90 days of history')
  const state = signState({ org: ctx.orgId, profile: ctx.userId, days })
  return json(200, { url: authUrl(state, typeof b.loginHint === 'string' ? b.loginHint : undefined) })
}

/** Google redirects here after consent. The signed state proves this server started the request. */
export async function gmailCallback(req: ApiRequest) {
  const fail = (reason: string) => redirect(`/automation?gmail=error&reason=${encodeURIComponent(reason)}`)
  if (query(req, 'error')) return fail(query(req, 'error') === 'access_denied' ? 'You declined access in Google.' : 'Google returned an error.')
  const state = verifyState<{ org: string; profile: string; days: number }>(query(req, 'state'))
  if (!state) return fail('The connection link expired. Try Connect Gmail again.')
  const code = query(req, 'code')
  if (!code) return fail('Google did not return an authorization code.')
  try {
    const tokens = await exchangeCode(code)
    const profile = await gmailGet<{ emailAddress: string; historyId: string }>('/profile', tokens.access_token)
    const email = profile.emailAddress.toLowerCase()
    const { data: existing } = await admin().from('gmail_accounts').select('id, refresh_token_enc').eq('org_id', state.org).eq('email', email).maybeSingle()
    const refresh = tokens.refresh_token ? encryptSecret(tokens.refresh_token) : (existing?.refresh_token_enc as string | null)
    if (!refresh) return fail('Google did not grant offline access. Remove FollowThru from your Google account permissions and connect again.')
    const row = {
      org_id: state.org,
      connected_by: state.profile,
      email,
      refresh_token_enc: refresh,
      access_token_enc: encryptSecret(tokens.access_token),
      access_expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
      scope: tokens.scope ?? null,
      status: 'connected',
      initial_days: state.days,
      last_error: null,
      updated_at: new Date().toISOString(),
      ...(existing ? {} : { history_id: null }),
    }
    await admin().from('gmail_accounts').upsert(row, { onConflict: 'org_id,email' })
    await applyOps([auditOp(state.org, state.profile, null, 'gmail.connect', 'gmail', email, null, { email, scope: tokens.scope, initialDays: state.days })])
    await eventOp(state.org, 'gmail_connected', `Gmail connected: ${email} (read-only, last ${state.days} days)`)
    return redirect(`/automation?gmail=connected`)
  } catch (e) {
    console.error('gmail callback failed', e instanceof Error ? e.message : e)
    return fail('Could not finish connecting Gmail. Check the server Google settings and try again.')
  }
}

export async function gmailDisconnect(req: ApiRequest) {
  const ctx = await requireUser(req)
  requireRole(ctx, 'coordinator')
  const id = str(bodyOf(req), 'accountId', { max: 64 })
  const { data: a } = await admin().from('gmail_accounts').select('id, email, refresh_token_enc').eq('org_id', ctx.orgId).eq('id', id).maybeSingle()
  if (!a) throw notFound('Gmail account not found')
  if (a.refresh_token_enc) {
    try {
      const { decryptSecret } = await import('../crypto')
      await revoke(decryptSecret(a.refresh_token_enc as string))
    } catch {
      // Revoking is best effort; the stored tokens are deleted either way
    }
  }
  await admin().from('gmail_accounts').delete().eq('id', a.id)
  await applyOps([auditOp(ctx.orgId, ctx.userId, ctx.person.id, 'gmail.disconnect', 'gmail', a.email as string, { email: a.email }, null)])
  await eventOp(ctx.orgId, 'gmail_disconnected', `Gmail disconnected: ${a.email}. Tokens deleted; stored emails and tickets are kept.`)
  return json(200, { ok: true, message: 'Gmail disconnected and its tokens deleted' })
}

/** Everything the Automation page shows. Counts come from stored rows only. */
export async function overview(req: ApiRequest) {
  const ctx = await requireUser(req)
  requireRole(ctx, 'coordinator', 'team_lead')
  const org = ctx.orgId
  const count = async (status?: string) => {
    let q = admin().from('inbound_emails').select('id', { count: 'exact', head: true }).eq('org_id', org)
    if (status) q = q.eq('status', status)
    return (await q).count ?? 0
  }
  const countEvents = async (kind: string) => (await admin().from('automation_events').select('id', { count: 'exact', head: true }).eq('org_id', org).eq('kind', kind)).count ?? 0
  const [accounts, total, processed, ignored, review, failed, pending, actionable, created, updated, blockers, extensions, events, reviewRows, recent, minutes] = await Promise.all([
    admin().from('gmail_accounts').select('id, email, status, last_sync_at, last_error, messages_seen, initial_days, created_at').eq('org_id', org),
    count(),
    count('processed'),
    count('ignored'),
    count('review'),
    count('failed'),
    count('pending'),
    countEvents('actionable'),
    countEvents('ticket_created'),
    countEvents('ticket_updated'),
    countEvents('blocker_detected'),
    countEvents('extension_requested'),
    admin().from('automation_events').select('id, kind, message, email_id, task_key, created_at').eq('org_id', org).order('created_at', { ascending: false }).limit(60),
    admin().from('inbound_emails').select(`${EMAIL_COLUMNS}, status, classification, confidence, ai_mode, ai_model, ai_result, decision, last_error`).eq('org_id', org).in('status', ['review', 'failed']).order('sent_at', { ascending: false }).limit(50),
    admin().from('inbound_emails').select('id, source, gmail_thread_id, from_email, from_name, subject, sent_at, status, classification, confidence, ai_mode, task_keys, last_error').eq('org_id', org).order('sent_at', { ascending: false }).limit(40),
    admin().from('inbound_emails').select('id, subject, sent_at, from_name, from_email, gmail_thread_id, ai_result, task_keys').eq('org_id', org).eq('classification', 'meeting_minutes').order('sent_at', { ascending: false }).limit(20),
  ])
  const ai = aiConfig()
  const accountEmail = (accounts.data ?? [])[0]?.email as string | undefined
  return json(200, {
    google: { configured: googleConfig().configured },
    ai: ai ? { mode: 'ai', provider: ai.provider, model: ai.model } : { mode: 'rules', provider: null, model: 'rules-v1' },
    minConfidence: minConfidence(),
    accounts: accounts.data ?? [],
    stats: { total, processed, ignored, review, failed, pending, actionable, created, updated: updated + blockers + extensions },
    events: events.data ?? [],
    review: (reviewRows.data ?? []).map((r) => ({ ...r, link: r.source === 'gmail' ? gmailThreadLink(r.gmail_thread_id as string, accountEmail) : null })),
    recent: (recent.data ?? []).map((r) => ({ ...r, link: r.source === 'gmail' ? gmailThreadLink(r.gmail_thread_id as string, accountEmail) : null })),
    minutes: (minutes.data ?? []).map((m) => ({ id: m.id, subject: m.subject, sentAt: m.sent_at, from: m.from_name ?? m.from_email, minutes: (m.ai_result as { minutes?: unknown } | null)?.minutes ?? null, taskKeys: m.task_keys })),
  })
}

/** Runs one automation round now (also called every two minutes while a coordinator has the app open). */
export async function runTick(req: ApiRequest) {
  const ctx = await requireUser(req)
  requireRole(ctx, 'coordinator', 'team_lead')
  rateLimit(`tick:${ctx.orgId}`, 30, 60_000)
  const b = bodyOf(req)
  const r = await tick(ctx.orgId, fetch, b.force === true ? 0 : 45_000)
  return json(200, { ok: true, ...r, message: `Fetched ${r.fetched} new emails, processed ${r.processed}${r.errors.length ? `. Errors: ${r.errors.join('; ')}` : ''}` })
}

/**
 * Runs a pasted email through exactly the same pipeline, without Gmail. Stored with source "test"
 * and labelled as a test everywhere, so it is never mistaken for real mail.
 */
export async function testEmail(req: ApiRequest) {
  const ctx = await requireUser(req)
  requireRole(ctx, 'coordinator')
  rateLimit(`test-email:${ctx.orgId}`, 40, 60 * 60_000)
  const b = bodyOf(req)
  const from = str(b, 'from', { max: 320 }).toLowerCase()
  const subject = str(b, 'subject', { max: 300, optional: true })
  const body = str(b, 'body', { max: 20000 })
  const to = (Array.isArray(b.to) ? (b.to as unknown[]) : String(b.to ?? '').split(/[,;\s]+/)).filter((x): x is string => typeof x === 'string' && x.includes('@')).map((x) => x.toLowerCase()).slice(0, 20)
  const threadId = str(b, 'threadId', { max: 120, optional: true }) || `test-thread-${uuid().slice(0, 8)}`
  if (!from.includes('@')) throw bad('Enter the sender email address')
  const id = uuid()
  const row = { id, org_id: ctx.orgId, source: 'test', gmail_message_id: `test-${id}`, gmail_thread_id: threadId, from_email: from, from_name: str(b, 'fromName', { max: 120, optional: true }) || null, to_emails: to, cc_emails: [], subject: subject || null, sent_at: new Date().toISOString(), body_text: body, automated: false }
  await admin().from('inbound_emails').insert(row)
  await eventOp(ctx.orgId, 'email_detected', `Test email received (not from Gmail): "${subject || '(no subject)'}" from ${from}`, { emailId: id })
  const result = await processEmail({ ...(row as unknown as EmailRow), account_id: null, attempts: 0 })
  return json(201, { ok: true, emailId: id, threadId, ...result, message: `Test email processed: ${result.status}${result.taskKeys.length ? `, tickets ${result.taskKeys.join(', ')}` : ''}` })
}

/** A coordinator turns a review item into a ticket, choosing the owner (and deadline) the AI could not. */
export async function reviewCreate(req: ApiRequest) {
  const ctx = await requireUser(req)
  requireRole(ctx, 'coordinator')
  const b = bodyOf(req)
  const emailId = str(b, 'emailId', { max: 64 })
  const ownerId = str(b, 'ownerId', { max: 120 })
  const index = Number(b.itemIndex ?? 0)
  const { data: row } = await admin().from('inbound_emails').select(`${EMAIL_COLUMNS}, ai_result, task_keys`).eq('org_id', ctx.orgId).eq('id', emailId).maybeSingle()
  if (!row) throw notFound('Email not found')
  const items = ((row.ai_result as { items?: ActionItem[] } | null)?.items ?? []) as ActionItem[]
  const title = str(b, 'title', { max: 300, optional: true })
  const item: ActionItem = items[index] ?? { title: title || (row.subject as string) || 'Follow up on email', description: null, assignee_email: null, assignee_name: null, deadline_text: null, priority: 'normal', priority_reason: null, blockers: [] }
  const outcome = await syncOrg(ctx.orgId, ctx.userId, 'write')
  const people = new Map(outcome.input.dataset.people.map((p) => [p.id, p]))
  if (!people.has(ownerId)) throw bad('Choose the owner from this workspace')
  const dueAt = typeof b.dueAt === 'string' && b.dueAt ? new Date(b.dueAt).toISOString() : null
  const key = await createTicket(
    row as unknown as EmailRow,
    { kind: 'create', ticketId: ticketIdFor(row.gmail_message_id as string, Number.isInteger(index) ? index : 0), item: { ...item, title: title || item.title }, ownerId, requesterId: ctx.person.id, dueAt, deadlineNote: dueAt ? 'Set by a coordinator during review' : 'No deadline', assignReason: `Chosen by ${ctx.person.name} during review` },
    { mode: 'human', model: 'review', confidence: 1, actorProfileId: ctx.userId, requesterId: ctx.person.id, profileByPerson: outcome.input.profileByPerson, teamOf: (id) => people.get(id)?.teamId, approvedBy: ctx.person.name },
  )
  if (!key) throw bad('That ticket already exists')
  const keys = [...new Set([...((row.task_keys as string[] | undefined) ?? []), key])]
  await admin().from('inbound_emails').update({ status: 'processed', task_keys: keys, processed_at: new Date().toISOString() }).eq('id', emailId)
  await eventOp(ctx.orgId, 'ticket_created', `Ticket created from review by ${ctx.person.name}: "${title || item.title}"`, { emailId, taskKey: key })
  await syncOrg(ctx.orgId, ctx.userId, 'write')
  return json(201, { ok: true, taskKey: key, message: 'Ticket created' })
}

export async function dismissEmail(req: ApiRequest) {
  const ctx = await requireUser(req)
  requireRole(ctx, 'coordinator')
  const b = bodyOf(req)
  const emailId = str(b, 'emailId', { max: 64 })
  const reason = str(b, 'reason', { max: 300 })
  const { data } = await admin().from('inbound_emails').update({ status: 'ignored', last_error: null }).eq('org_id', ctx.orgId).eq('id', emailId).in('status', ['review', 'failed']).select('id, subject')
  if (!data?.length) throw notFound('That email is not waiting for review')
  await applyOps([auditOp(ctx.orgId, ctx.userId, ctx.person.id, 'automation.dismiss', 'email', emailId, null, { reason })])
  await eventOp(ctx.orgId, 'dismissed', `Dismissed by ${ctx.person.name}: "${data[0].subject ?? ''}" (${reason})`, { emailId })
  return json(200, { ok: true, message: 'Dismissed' })
}

export async function retryEmail(req: ApiRequest) {
  const ctx = await requireUser(req)
  requireRole(ctx, 'coordinator')
  const emailId = str(bodyOf(req), 'emailId', { max: 64 })
  const { data } = await admin().from('inbound_emails').update({ status: 'pending', next_attempt_at: new Date().toISOString(), attempts: 0 }).eq('org_id', ctx.orgId).eq('id', emailId).in('status', ['review', 'failed']).select(EMAIL_COLUMNS)
  if (!data?.length) throw notFound('That email is not waiting for review')
  const r = await processEmail(data[0] as unknown as EmailRow)
  return json(200, { ok: true, ...r, message: `Processed again: ${r.status}` })
}

/** Scheduled fallback (Vercel Cron or any scheduler). Needs Authorization: Bearer CRON_SECRET. */
export async function cron(req: ApiRequest) {
  const secret = process.env.CRON_SECRET ?? ''
  if (!secret || header(req, 'authorization') !== `Bearer ${secret}`) throw forbidden('Not allowed')
  const { data } = await admin().from('gmail_accounts').select('org_id').neq('status', 'revoked')
  const orgs = [...new Set((data ?? []).map((a) => a.org_id as string))]
  const results = []
  for (const org of orgs) results.push({ org, ...(await tick(org)) })
  return json(200, { ok: true, workspaces: results.length, fetched: results.reduce((n, r) => n + r.fetched, 0), processed: results.reduce((n, r) => n + r.processed, 0) })
}
