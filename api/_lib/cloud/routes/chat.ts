import type { ApiRequest } from '../../handlers'
import { ALL_TEAMS, MAX_CHAT_TEXT, canUseChat, chatThreadId, chatTitle } from '../../../../src/lib/chat'
import { admin, applyOps, uuid, type Op } from '../admin'
import { requireUser, type Ctx } from '../context'
import { bad, bodyOf, forbidden, json, rateLimit, str } from '../http'
import { auditOp } from '../notify'
import { syncOrg } from '../sync'

const TEAM_ID = /^[\w .-]{1,80}$/

function teamOf(ctx: Ctx, b: Record<string, unknown>): string {
  const teamId = str(b, 'teamId', { max: 80 })
  if (!TEAM_ID.test(teamId)) throw bad('Unknown team')
  if (!canUseChat(ctx.role, ctx.person.teamId, ctx.ledTeams, teamId)) throw forbidden('You can only use the chat of your own team')
  return teamId
}

/** Chats this account can open: the workspace chat plus teams, each with its latest line. */
export async function listChats(req: ApiRequest) {
  const ctx = await requireUser(req)
  const { data: people } = await admin().from('external_people').select('team_key').eq('org_id', ctx.orgId)
  const teams = [...new Set((people ?? []).map((p) => p.team_key as string | null).filter((t): t is string => !!t))].sort()
  const allowed = [ALL_TEAMS, ...teams].filter((t) => canUseChat(ctx.role, ctx.person.teamId, ctx.ledTeams, t))
  return json(200, { teams: allowed.map((id) => ({ id, title: chatTitle(id) })) })
}

/** Messages of one team chat, oldest first, with author names. */
export async function chatMessages(req: ApiRequest) {
  const ctx = await requireUser(req)
  const teamId = teamOf(ctx, bodyOf(req))
  const { data: rows, error } = await admin()
    .from('messages')
    .select('external_id, author_external_id, text, sent_at, reply_to_external_id')
    .eq('org_id', ctx.orgId)
    .eq('thread_external_id', chatThreadId(teamId))
    .order('sent_at', { ascending: false })
    .limit(300)
  if (error) throw error
  const authors = [...new Set((rows ?? []).map((r) => r.author_external_id as string))]
  const { data: people } = authors.length
    ? await admin().from('external_people').select('external_id, name').eq('org_id', ctx.orgId).in('external_id', authors)
    : { data: [] }
  const names = new Map((people ?? []).map((p) => [p.external_id as string, p.name as string]))
  return json(200, {
    teamId,
    messages: (rows ?? []).reverse().map((r) => ({
      id: r.external_id,
      authorId: r.author_external_id,
      authorName: names.get(r.author_external_id as string) ?? r.author_external_id,
      text: r.text,
      sentAt: new Date(r.sent_at as string).toISOString(),
      replyToId: r.reply_to_external_id ?? undefined,
    })),
  })
}

/** Posts one chat line as the signed-in person, then re-runs the engine so commitments follow the conversation. */
export async function postChat(req: ApiRequest) {
  const ctx = await requireUser(req)
  const b = bodyOf(req)
  const teamId = teamOf(ctx, b)
  const text = str(b, 'text', { max: MAX_CHAT_TEXT }).trim()
  if (!text) throw bad('Write a message first')
  const replyToId = typeof b.replyToId === 'string' && b.replyToId ? str(b, 'replyToId', { max: 120 }) : null
  rateLimit(`chat:${ctx.userId}`, 60, 60_000)
  const thread = chatThreadId(teamId)
  const id = `chat_${uuid().replace(/-/g, '').slice(0, 16)}`
  const sentAt = new Date().toISOString()
  const ops: Op[] = [
    { op: 'upsert', table: 'threads', conflict: ['org_id', 'external_id'], ignore_duplicates: true, row: { org_id: ctx.orgId, external_id: thread, title: chatTitle(teamId), source: 'chat' } },
    {
      op: 'insert',
      table: 'messages',
      row: { org_id: ctx.orgId, thread_external_id: thread, external_id: id, author_external_id: ctx.person.id, text, sent_at: sentAt, reply_to_external_id: replyToId, source_timezone: ctx.person.timezone },
    },
    auditOp(ctx.orgId, ctx.userId, ctx.person.id, 'chat.post', 'message', id, null, { thread, length: text.length }),
  ]
  await applyOps(ops)
  await syncOrg(ctx.orgId, ctx.userId, 'write')
  return json(201, { ok: true, message: 'Posted. Commitments were re-checked.', id, sentAt })
}
