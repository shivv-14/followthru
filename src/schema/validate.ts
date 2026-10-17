import type * as z from 'zod'
import type { Dataset, IssueCode, Message, Thread, ValidationIssue, ValidationResult } from '../engine/types'
import { isValidTimeZone, parseIsoWithOffset } from '../engine/time'
import { datasetInputSchema, type DatasetInput } from './input'

type Path = (string | number)[]

const MESSAGES: Record<IssueCode, string> = {
  invalid_json: 'File is not valid JSON',
  missing_field: 'Required field is missing',
  invalid_type: 'Field has the wrong type',
  invalid_value: 'Field value is not allowed',
  invalid_timestamp: 'Timestamp must be ISO 8601 with Z or an explicit offset',
  unknown_timezone: 'Timezone is not a valid IANA name',
  duplicate_id: 'Id is used more than once',
  unknown_author: 'Author is not in people',
  unknown_thread: 'Thread is not in threads',
  unknown_reply_target: 'Reply points to a message that does not exist',
  unknown_mention: 'Mentioned person is not in people',
  empty_text: 'Message text is empty',
  label_unknown_message: 'Label points to a message that does not exist',
  label_unknown_owner: 'Label owner is not in people',
  csv_parse_error: 'CSV row could not be parsed',
  csv_missing_column: 'CSV is missing a required column',
}

export function issue(code: IssueCode, severity: ValidationIssue['severity'], path: Path, detail?: string): ValidationIssue {
  return { code, severity, path, message: detail ? `${MESSAGES[code]}: ${detail}` : MESSAGES[code] }
}

function structuralCode(i: z.core.$ZodIssue): IssueCode {
  if (i.message === 'missing_field') return 'missing_field'
  if (i.code === 'invalid_type') return 'invalid_type'
  return 'invalid_value'
}

function findDuplicates(items: { id: string }[], key: string, issues: ValidationIssue[]) {
  const seen = new Set<string>()
  items.forEach((item, i) => {
    if (seen.has(item.id)) issues.push(issue('duplicate_id', 'error', [key, i, 'id'], item.id))
    seen.add(item.id)
  })
}

function checkSemantics(input: DatasetInput): { issues: ValidationIssue[]; data: Dataset } {
  const issues: ValidationIssue[] = []
  const threadsIn = input.threads ?? []
  const labelsIn = input.labels ?? []

  findDuplicates(input.people, 'people', issues)
  findDuplicates(threadsIn, 'threads', issues)
  findDuplicates(input.messages, 'messages', issues)

  input.people.forEach((p, i) => {
    if (!isValidTimeZone(p.timezone)) issues.push(issue('unknown_timezone', 'error', ['people', i, 'timezone'], p.timezone))
  })

  let referenceTime: string | undefined
  if (input.referenceTime !== undefined) {
    referenceTime = parseIsoWithOffset(input.referenceTime) ?? undefined
    if (!referenceTime) issues.push(issue('invalid_timestamp', 'error', ['referenceTime'], input.referenceTime))
  }

  const personIds = new Set(input.people.map((p) => p.id))
  const threadIds = new Set(threadsIn.map((t) => t.id))
  const messageIds = new Set(input.messages.map((m) => m.id))

  const messages: Message[] = []
  input.messages.forEach((m, i) => {
    const sentAt = parseIsoWithOffset(m.sentAt)
    if (!sentAt) issues.push(issue('invalid_timestamp', 'error', ['messages', i, 'sentAt'], m.sentAt))
    if (!personIds.has(m.authorId)) issues.push(issue('unknown_author', 'warning', ['messages', i, 'authorId'], m.authorId))
    if (threadsIn.length > 0 && !threadIds.has(m.threadId)) issues.push(issue('unknown_thread', 'warning', ['messages', i, 'threadId'], m.threadId))
    if (m.replyToId && !messageIds.has(m.replyToId)) issues.push(issue('unknown_reply_target', 'warning', ['messages', i, 'replyToId'], m.replyToId))
    m.mentionIds?.forEach((pid, j) => {
      if (!personIds.has(pid)) issues.push(issue('unknown_mention', 'warning', ['messages', i, 'mentionIds', j], pid))
    })
    if (m.text.trim() === '') issues.push(issue('empty_text', 'warning', ['messages', i, 'text']))
    if (sentAt) messages.push({ ...m, sentAt })
  })

  labelsIn.forEach((l, i) => {
    if (!messageIds.has(l.sourceMessageId)) issues.push(issue('label_unknown_message', 'error', ['labels', i, 'sourceMessageId'], l.sourceMessageId))
    if (!personIds.has(l.ownerId)) issues.push(issue('label_unknown_owner', 'error', ['labels', i, 'ownerId'], l.ownerId))
    if (l.dueAt !== null && !parseIsoWithOffset(l.dueAt)) issues.push(issue('invalid_timestamp', 'error', ['labels', i, 'dueAt'], l.dueAt))
  })

  // Stable order: time, then id. Equal timestamps never reorder between runs.
  messages.sort((a, b) => (a.sentAt === b.sentAt ? (a.id < b.id ? -1 : a.id > b.id ? 1 : 0) : a.sentAt < b.sentAt ? -1 : 1))

  return {
    issues,
    data: {
      referenceTime,
      people: input.people,
      threads: deriveThreads(threadsIn, messages),
      messages,
      labels: labelsIn.map((l) => ({ ...l, dueAt: l.dueAt === null ? null : (parseIsoWithOffset(l.dueAt) ?? l.dueAt) })),
    },
  }
}

/** Keeps declared threads and adds any thread only seen on messages. Participants include every author. */
function deriveThreads(declared: Thread[], messages: Message[]): Thread[] {
  const byId = new Map<string, Thread>(declared.map((t) => [t.id, { ...t, participantIds: [...(t.participantIds ?? [])] }]))
  for (const m of messages) {
    const t = byId.get(m.threadId) ?? { id: m.threadId, participantIds: [] }
    if (!t.participantIds!.includes(m.authorId)) t.participantIds!.push(m.authorId)
    byId.set(m.threadId, t)
  }
  return [...byId.values()]
}

/** Validates unknown input. Never throws. */
export function validateDataset(input: unknown): ValidationResult {
  const parsed = datasetInputSchema.safeParse(input, {
    error: (i) => (i.input === undefined ? 'missing_field' : undefined),
  })
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) =>
      issue(structuralCode(i), 'error', i.path.map((p) => (typeof p === 'symbol' ? String(p) : p))),
    )
    return { ok: false, issues }
  }
  const { issues, data } = checkSemantics(parsed.data)
  const ok = !issues.some((i) => i.severity === 'error')
  return ok ? { ok, data, issues } : { ok, issues }
}

/** Parses JSON text and validates it. Never throws. */
export function validateDatasetJson(text: string): ValidationResult {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return { ok: false, issues: [issue('invalid_json', 'error', [])] }
  }
  return validateDataset(value)
}
