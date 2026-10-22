import type { ApiRequest } from '../../handlers'
import { ALL_TEAMS, MAX_CHAT_TEXT, MAX_SEARCH, applyReaction, canUseChat, chatTeamOf, chatThreadId, chatTitle, isReaction, likePattern, mentionedIds, reactionsOf } from '../../../../src/lib/chat'
import { admin, applyOps, uuid, type Op } from '../admin'
import { requireUser, type Ctx } from '../context'
import { HttpError, bad, bodyOf, forbidden, json, notFound, rateLimit, str } from '../http'
import { auditOp, notificationOps } from '../notify'
import { syncOrg } from '../sync'

const TEAM_ID = /^[\w .-]{1,80}$/

function teamOf(ctx: Ctx, b: Record<string, unknown>): string {
  const teamId = str(b, 'teamId', { max: 80 })
  if (!TEAM_ID.test(teamId)) throw bad('Unknown team')
  if (!canUseChat(ctx.role, ctx.person.teamId, ctx.ledTeams, teamId)) throw forbidden('You can only use the chat of your own team')
  return teamId
}

/** Team chats this account may open: the workspace chat plus the allowed teams. */
async function allowedChats(ctx: Ctx): Promise<string[]> {
  const { data: people } = await admin().from('external_people').select('team_key').eq('org_id', ctx.orgId)
  const teams = [...new Set((people ?? []).map((p) => p.team_key as string | null).filter((t): t is string => !!t))].sort()
  return [ALL_TEAMS, ...teams].filter((t) => canUseChat(ctx.role, ctx.person.teamId, ctx.ledTeams, t))
}

/** Chats this account can open: the workspace chat plus teams. */
export async function listChats(req: ApiRequest) {
  const ctx = await requireUser(req)
  const allowed = await allowedChats(ctx)
  return json(200, { teams: allowed.map((id) => ({ id, title: chatTitle(id) })) })
}

async function authorNames(orgId: string, rows: { author_external_id: unknown }[]): Promise<Map<string, string>> {
  const authors = [...new Set(rows.map((r) => r.author_external_id as string))]
  const { data: people } = authors.length ? await admin().from('external_people').select('external_id, name').eq('org_id', orgId).in('external_id', authors) : { data: [] }
  return new Map((people ?? []).map((p) => [p.external_id as string, p.name as string]))
}

const lineOf = (r: Record<string, unknown>, names: Map<string, string>) => ({
  id: r.external_id as string,
  authorId: r.author_external_id as string,
  authorName: names.get(r.author_external_id as string) ?? (r.author_external_id as string),
  text: r.text as string,
  sentAt: new Date(r.sent_at as string).toISOString(),
  replyToId: (r.reply_to_external_id as string | null) ?? undefined,
  reactions: reactionsOf(r.raw),
})

/** Messages of one team chat, oldest first, with author names. */
export async function chatMessages(req: ApiRequest) {
  const ctx = await requireUser(req)
  const teamId = teamOf(ctx, bodyOf(req))
  const { data: rows, error } = await admin()
    .from('messages')
    .select('external_id, author_external_id, text, sent_at, reply_to_external_id, raw')
    .eq('org_id', ctx.orgId)
    .eq('thread_external_id', chatThreadId(teamId))
    .order('sent_at', { ascending: false })
    .limit(300)
  if (error) throw error
  const names = await authorNames(ctx.orgId, rows ?? [])
  return json(200, { teamId, messages: (rows ?? []).reverse().map((r) => lineOf(r, names)) })
}

/** Searches the text of every chat this account may open (or one of them), newest first. */
export async function searchChats(req: ApiRequest) {
  const ctx = await requireUser(req)
  rateLimit(`chat-search:${ctx.userId}`, 60, 60_000)
  const b = bodyOf(req)
  const query = str(b, 'query', { max: 200 })
  if (query.length < 2) throw bad('Type at least two characters to search')
  const only = typeof b.teamId === 'string' && b.teamId ? teamOf(ctx, b) : null
  const teams = only ? [only] : await allowedChats(ctx)
  const { data: rows, error } = await admin()
    .from('messages')
    .select('external_id, thread_external_id, author_external_id, text, sent_at, reply_to_external_id, raw')
    .eq('org_id', ctx.orgId)
    .in('thread_external_id', teams.map(chatThreadId))
    .ilike('text', likePattern(query))
    .order('sent_at', { ascending: false })
    .limit(MAX_SEARCH)
  if (error) throw error
  const names = await authorNames(ctx.orgId, rows ?? [])
  const results = (rows ?? []).map((r) => {
    const teamId = chatTeamOf(r.thread_external_id as string) ?? ALL_TEAMS
    return { ...lineOf(r, names), teamId, chatTitle: chatTitle(teamId) }
  })
  return json(200, { query, results })
}

/** Adds or removes the caller's emoji reaction on one chat line. Reactions live in messages.raw and are never engine input. */
export async function reactChat(req: ApiRequest) {
  const ctx = await requireUser(req)
  rateLimit(`chat-react:${ctx.userId}`, 120, 60_000)
  const b = bodyOf(req)
  const teamId = teamOf(ctx, b)
  const messageId = str(b, 'messageId', { max: 120 })
  const emoji = b.emoji
  if (!isReaction(emoji)) throw bad('Choose one of the offered reactions')
  const on = typeof b.on === 'boolean' ? b.on : undefined
  // Optimistic merge: the update applies only if raw is unchanged since it was read, so concurrent reactions are never lost
  for (let attempt = 0; ; attempt++) {
    const { data: row } = await admin().from('messages').select('id, raw').eq('org_id', ctx.orgId).eq('thread_external_id', chatThreadId(teamId)).eq('external_id', messageId).maybeSingle()
    if (!row) throw notFound('Message not found')
    const raw = row.raw && typeof row.raw === 'object' && !Array.isArray(row.raw) ? (row.raw as Record<string, unknown>) : {}
    const reactions = applyReaction(raw.reactions, emoji, ctx.person.id, on)
    const mine = (reactions[emoji] ?? []).includes(ctx.person.id)
    try {
      await applyOps([
        { op: 'update', table: 'messages', match: { id: row.id, raw: row.raw ?? null }, set: { raw: { ...raw, reactions } }, require_rows: true },
        auditOp(ctx.orgId, ctx.userId, ctx.person.id, mine ? 'chat.react' : 'chat.unreact', 'message', messageId, null, { emoji }),
      ])
      return json(200, { ok: true, message: mine ? 'Reaction added' : 'Reaction removed', reactions })
    } catch (e) {
      if (e instanceof HttpError && e.status === 409 && attempt < 2) continue
      throw e
    }
  }
}

/** In-app notices for people @mentioned in a chat line, only when they may open that chat. */
async function mentionOps(ctx: Ctx, teamId: string, messageId: string, text: string): Promise<{ ops: Op[]; mentions: string[] }> {
  if (!text.includes('@')) return { ops: [], mentions: [] }
  const { data: people } = await admin().from('external_people').select('external_id, name, team_key').eq('org_id', ctx.orgId)
  const list = (people ?? []).map((p) => ({ id: p.external_id as string, name: p.name as string, teamId: (p.team_key as string | null) ?? undefined }))
  const mentions = mentionedIds(text, list).filter((id) => id !== ctx.person.id)
  if (mentions.length === 0) return { ops: [], mentions }
  const { data: profiles } = await admin().from('profiles').select('id, person_id, role').eq('org_id', ctx.orgId).eq('is_active', true).in('person_id', mentions)
  const ids = (profiles ?? []).map((p) => p.id as string)
  const { data: led } = ids.length ? await admin().from('teams').select('team_key, lead_profile_id').eq('org_id', ctx.orgId).in('lead_profile_id', ids) : { data: [] }
  const ops: Op[] = []
  for (const p of profiles ?? []) {
    const person = list.find((x) => x.id === p.person_id)
    const ledTeams = (led ?? []).filter((t) => t.lead_profile_id === p.id).map((t) => t.team_key as string)
    if (!canUseChat(p.role as string, person?.teamId, ledTeams, teamId)) continue
    ops.push(
      ...notificationOps({
        orgId: ctx.orgId,
        recipients: [p.id as string],
        type: 'mention',
        title: `${ctx.person.name} mentioned you in ${chatTitle(teamId)}`,
        body: text.slice(0, 300),
        link: `/chat/${encodeURIComponent(teamId)}`,
        eventKey: `chat-mention:${messageId}:${p.person_id as string}`,
        skip: ctx.userId,
      }),
    )
  }
  return { ops, mentions }
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
  const mention = await mentionOps(ctx, teamId, id, text)
  const ops: Op[] = [
    { op: 'upsert', table: 'threads', conflict: ['org_id', 'external_id'], ignore_duplicates: true, row: { org_id: ctx.orgId, external_id: thread, title: chatTitle(teamId), source: 'chat' } },
    {
      op: 'insert',
      table: 'messages',
      row: { org_id: ctx.orgId, thread_external_id: thread, external_id: id, author_external_id: ctx.person.id, text, sent_at: sentAt, reply_to_external_id: replyToId, source_timezone: ctx.person.timezone, ...(mention.mentions.length ? { raw: { mentions: mention.mentions } } : {}) },
    },
    auditOp(ctx.orgId, ctx.userId, ctx.person.id, 'chat.post', 'message', id, null, { thread, length: text.length, mentions: mention.mentions.length }),
    ...mention.ops,
  ]
  await applyOps(ops)
  await syncOrg(ctx.orgId, ctx.userId, 'write')
  return json(201, { ok: true, message: 'Posted. Commitments were re-checked.', id, sentAt })
}
