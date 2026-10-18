import { escapeMarkdown } from './markdown'
import { slugify } from './rules'

// Turns a meeting-minutes email reading into a knowledge base draft. Pure: the same input always
// gives the same page, so saving it twice is detectable and never creates a second page.

export const MEETINGS_SPACE = { key: 'meetings', name: 'Meetings', description: 'Meeting minutes saved from email. Each page starts as a draft for review.' } as const

export interface MinutesItem {
  title: string
  assignee_name: string | null
  assignee_email: string | null
  deadline_text: string | null
}

export interface MinutesInput {
  emailId: string
  threadId: string
  subject: string | null
  sentAt: string
  fromName: string | null
  fromEmail: string | null
  toEmails: string[]
  summary: string
  minutes: { title: string; decisions: string[]; discussion: string[]; open_questions: string[] }
  items: MinutesItem[]
  /** The ticket created for each action item, by index, or null when none was created */
  itemTaskKeys: (string | null)[]
}

export interface MinutesPage {
  title: string
  slug: string
  bodyMd: string
  tags: string[]
  source: { kind: 'email'; emailId: string; threadId: string }
}

const section = (heading: string, lines: string[], empty: string) => [`## ${heading}`, '', ...(lines.length ? lines : [`_${empty}_`]), '']
const bullets = (list: string[]) => list.map((x) => escapeMarkdown(x)).filter(Boolean).map((x) => `- ${x}`)

export function buildMinutesPage(input: MinutesInput): MinutesPage {
  const date = input.sentAt.slice(0, 10)
  const name = (input.minutes.title || input.subject || 'Meeting minutes').replace(/\s+/g, ' ').trim().slice(0, 180) || 'Meeting minutes'
  const title = `${name} (${date})`
  const from = input.fromName && input.fromEmail ? `${input.fromName} <${input.fromEmail}>` : (input.fromEmail ?? input.fromName ?? 'unknown sender')
  const participants = [...new Set([from, ...input.toEmails.map((e) => e.toLowerCase())])]

  const actions = input.items.map((it, i) => {
    const key = input.itemTaskKeys[i] ?? null
    const who = it.assignee_name || it.assignee_email
    const parts = [escapeMarkdown(it.title), who ? `owner: ${escapeMarkdown(who)}` : 'owner: not named', it.deadline_text ? `due: ${escapeMarkdown(it.deadline_text)}` : null].filter(Boolean)
    return `- ${parts.join(' · ')}${key ? ` · [ticket ${escapeMarkdown(key)}](/commitments/${encodeURIComponent(key)})` : ' · no ticket created'}`
  })

  const body = [
    `# ${escapeMarkdown(name)}`,
    '',
    `**Date:** ${date}`,
    '',
    `**Participants:** ${participants.map((p) => escapeMarkdown(p)).join(', ')}`,
    '',
    `**Source:** email "${escapeMarkdown(input.subject ?? '(no subject)')}" (draft created automatically; review before publishing)`,
    '',
    ...section('Summary', input.summary.trim() ? [escapeMarkdown(input.summary)] : [], 'No summary'),
    ...section('Decisions', bullets(input.minutes.decisions), 'No decisions recorded'),
    ...section('Discussion', bullets(input.minutes.discussion), 'No discussion notes'),
    ...section('Open questions', bullets(input.minutes.open_questions), 'No open questions'),
    ...section('Action items', actions, 'No action items'),
  ]
    .join('\n')
    .trimEnd()

  return {
    title,
    slug: `${slugify(name, 60)}-${date}-${slugify(input.emailId, 12)}`,
    bodyMd: body.slice(0, 100_000),
    tags: ['meeting-minutes'],
    source: { kind: 'email', emailId: input.emailId, threadId: input.threadId },
  }
}
