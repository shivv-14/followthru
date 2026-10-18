import type { Op } from './admin'
import type { SlackMessage } from './slack'

// Slack message -> FollowThru message row. Pure: the text is untrusted data and only cleaned,
// never interpreted. Ids are derived from the Slack channel and ts, so a re-import is a no-op.

/** Only plain human lines become engine input; joins, topic changes, bots and edits are skipped. */
const KEPT_SUBTYPES = new Set([undefined, 'thread_broadcast', 'file_share'])

export interface SlackAuthor {
  personId: string
  name: string
  timezone?: string | null
}

export interface ParsedSlackMessage {
  externalId: string
  threadId: string
  authorId: string
  sentAt: string
  text: string
  replyToId: string | null
  mentionIds: string[]
  timezone: string | null
}

export const slackMessageId = (channel: string, ts: string) => `slack_${channel}_${ts}`
export const slackThreadId = (channel: string, threadTs?: string) => (threadTs ? `slack-${channel}-${threadTs}` : `slack-${channel}`)
export const slackPersonId = (user: string) => `slack_${user}`

export function tsToIso(ts: string): string {
  const [sec, micro = '0'] = ts.split('.')
  return new Date(Number(sec) * 1000 + Math.floor(Number(micro.padEnd(6, '0').slice(0, 6)) / 1000)).toISOString()
}

const decode = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')

/** Replaces Slack markup: <@U1> mentions with names, <url|label> links, <#C1|name> channels, <!here> and friends. */
export function cleanSlackText(text: string, author: (user: string) => SlackAuthor | undefined, mentions: string[] = []): string {
  const out = text.replace(/<([^<>]+)>/g, (_all, inner: string) => {
    const [target, label] = inner.split('|', 2) as [string, string | undefined]
    if (target.startsWith('@')) {
      const user = target.slice(1)
      const a = author(user)
      if (a) mentions.push(a.personId)
      return `@${a?.name ?? label ?? user}`
    }
    if (target.startsWith('#')) return `#${label ?? target.slice(1)}`
    if (target.startsWith('!subteam^')) return label ?? '@group'
    if (target.startsWith('!date^')) return label ?? ''
    if (target.startsWith('!')) return `@${target.slice(1)}`
    if (target.startsWith('mailto:')) return label ?? target.slice(7)
    return label && label !== target ? `${label} (${target})` : target
  })
  return decode(out).trim()
}

/** null when the message is not a human line worth reading (bot, system subtype, empty). */
export function slackToMessage(m: SlackMessage, channel: string, author: (user: string) => SlackAuthor | undefined): ParsedSlackMessage | null {
  if (!KEPT_SUBTYPES.has(m.subtype) || m.bot_id || !m.user || !m.ts) return null
  const mentions: string[] = []
  const text = cleanSlackText(m.text ?? '', author, mentions).slice(0, 20000)
  if (!text) return null
  const a = author(m.user)
  const isReply = !!m.thread_ts && m.thread_ts !== m.ts
  return {
    externalId: slackMessageId(channel, m.ts),
    threadId: slackThreadId(channel, isReply ? m.thread_ts : undefined),
    authorId: a?.personId ?? slackPersonId(m.user),
    sentAt: tsToIso(m.ts),
    text,
    replyToId: isReply ? slackMessageId(channel, m.thread_ts as string) : null,
    mentionIds: [...new Set(mentions)],
    timezone: a?.timezone ?? null,
  }
}

/** Idempotent writes: threads and messages are upserts that ignore rows already stored. */
export function messageOps(orgId: string, channelName: string, rows: ParsedSlackMessage[]): Op[] {
  const threads = new Map<string, string>()
  for (const r of rows) threads.set(r.threadId, r.replyToId ? `#${channelName} thread (Slack)` : `#${channelName} (Slack)`)
  return [
    ...[...threads].map(([id, title]): Op => ({ op: 'upsert', table: 'threads', conflict: ['org_id', 'external_id'], ignore_duplicates: true, row: { org_id: orgId, external_id: id, title: title.slice(0, 200), source: 'slack' } })),
    ...rows.map(
      (r): Op => ({
        op: 'upsert',
        table: 'messages',
        conflict: ['org_id', 'external_id'],
        ignore_duplicates: true,
        row: { org_id: orgId, thread_external_id: r.threadId, external_id: r.externalId, author_external_id: r.authorId, text: r.text, sent_at: r.sentAt, reply_to_external_id: r.replyToId, mention_external_ids: r.mentionIds, source_timezone: r.timezone },
      }),
    ),
  ]
}
