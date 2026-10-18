import Papa from 'papaparse'
import type { Dataset, Person, ValidationIssue, ValidationResult } from '../engine/types'
import { isValidTimeZone, parseIsoWithOffset, wallTimeToUtc } from '../engine/time'
import { unescapeCsvCell } from './io'
import { issue, validateDataset } from './validate'

/**
 * The easy chat format: one row per message, made in any spreadsheet.
 *   time, thread, from, timezone, message   (+ optional role, team, reply_to)
 * People and threads are created from their names, so no ids are needed. A time without an
 * offset ("2026-10-21 09:00") is read in the sender's timezone. reply_to is the spreadsheet row
 * number of the message being answered (the header is row 1), which helps hand-overs like "Will do".
 */
export const SIMPLE_CSV_COLUMNS = ['time', 'thread', 'from', 'timezone', 'message', 'role', 'team', 'reply_to'] as const

const ALIASES: Record<(typeof SIMPLE_CSV_COLUMNS)[number], string[]> = {
  time: ['time', 'sent_at', 'sentat', 'date', 'datetime', 'timestamp', 'when'],
  thread: ['thread', 'channel', 'chat', 'group', 'conversation'],
  from: ['from', 'author', 'name', 'sender', 'person'],
  timezone: ['timezone', 'tz', 'time zone'],
  message: ['message', 'text', 'body', 'content'],
  role: ['role'],
  team: ['team'],
  reply_to: ['reply_to', 'reply to', 'replyto', 'in reply to'],
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40) || 'x'

/** True when a CSV header looks like the easy format rather than the id-based messages CSV. */
export function isSimpleChatCsv(text: string): boolean {
  const header = text.replace(/^﻿/, '').split(/\r?\n/, 1)[0].toLowerCase()
  return !/\bauthorid\b/.test(header) && ALIASES.message.some((a) => header.includes(a)) && ALIASES.from.some((a) => header.includes(a))
}

function parseTime(raw: string, tz: string): string | null {
  const v = raw.trim().replace(' ', 'T')
  const withOffset = parseIsoWithOffset(v)
  if (withOffset) return withOffset
  const m = v.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{1,2}):(\d{2})(?::(\d{2}))?$/)
  if (!m) return null
  return wallTimeToUtc({ year: +m[1], month: +m[2], day: +m[3], hour: +m[4], minute: +m[5], second: m[6] ? +m[6] : 0 }, tz)
}

/** Reads the easy chat CSV into a validated dataset. `defaultTimezone` is used when a row has none. */
export function simpleChatCsvToDataset(text: string, defaultTimezone: string): ValidationResult {
  const parsed = Papa.parse<Record<string, string>>(text.replace(/^﻿/, ''), { header: true, skipEmptyLines: 'greedy', transformHeader: (h) => h.trim().toLowerCase() })
  const issues: ValidationIssue[] = parsed.errors.map((e) => issue('csv_parse_error', 'error', ['csv', e.row ?? 0], e.message))
  const fields = parsed.meta.fields ?? []
  const col = (k: keyof typeof ALIASES) => ALIASES[k].find((a) => fields.includes(a))
  const cols = { time: col('time'), thread: col('thread'), from: col('from'), timezone: col('timezone'), message: col('message'), role: col('role'), team: col('team'), reply_to: col('reply_to') }
  for (const need of ['time', 'from', 'message'] as const) {
    if (!cols[need]) issues.push(issue('missing_field', 'error', ['csv', need], `Add a "${need}" column. The easy format is: time, thread, from, timezone, message`))
  }
  if (issues.some((i) => i.severity === 'error')) return { ok: false, issues }

  const fallbackTz = isValidTimeZone(defaultTimezone) ? defaultTimezone : 'UTC'
  const people = new Map<string, Person>()
  const threads = new Map<string, string>()
  const messages: Dataset['messages'] = []
  const idByRow = new Map<number, string>()
  const replies: { id: string; row: number; line: number }[] = []
  parsed.data.forEach((row, i) => {
    const line = i + 2
    const get = (k: keyof typeof cols) => (cols[k] ? unescapeCsvCell((row[cols[k]!] ?? '').trim()) : '')
    const name = get('from')
    const text = get('message')
    if (!name || !text) {
      issues.push(issue('empty_text', 'warning', ['csv', line], `Row ${line} has no sender or no message and was skipped`))
      return
    }
    const id = `p_${slug(name)}`
    let person = people.get(id)
    if (!person) {
      const tz = get('timezone')
      if (tz && !isValidTimeZone(tz)) issues.push(issue('unknown_timezone', 'warning', ['csv', line], `Unknown timezone "${tz}" for ${name}; used ${fallbackTz}`))
      const role = get('role').toLowerCase()
      const team = slug(get('team'))
      person = { id, name, timezone: tz && isValidTimeZone(tz) ? tz : fallbackTz, role: role === 'coordinator' ? 'coordinator' : 'member', ...(get('team') ? { teamId: team } : {}) }
      people.set(id, person)
    }
    const threadName = get('thread') || 'General'
    const threadId = `t_${slug(threadName)}`
    threads.set(threadId, threadName)
    const sentAt = parseTime(get('time'), person.timezone)
    if (!sentAt) {
      issues.push(issue('invalid_timestamp', 'error', ['csv', line], `Row ${line}: write the time like 2026-10-21 09:00 (year-month-day hour:minute)`))
      return
    }
    const messageId = `m_${String(messages.length + 1).padStart(3, '0')}`
    messages.push({ id: messageId, threadId, authorId: id, sentAt, text })
    idByRow.set(line, messageId)
    const replyRow = Number(get('reply_to'))
    if (get('reply_to') && Number.isInteger(replyRow)) replies.push({ id: messageId, row: replyRow, line })
  })
  for (const r of replies) {
    const target = idByRow.get(r.row)
    if (target) messages.find((m) => m.id === r.id)!.replyToId = target
    else issues.push(issue('unknown_reply_target', 'warning', ['csv', r.line], `Row ${r.line} replies to row ${r.row}, which has no message`))
  }
  if (issues.some((i) => i.severity === 'error')) return { ok: false, issues }

  const result = validateDataset({
    people: [...people.values()],
    threads: [...threads].map(([id, title]) => ({ id, title })),
    messages: messages.sort((a, b) => a.sentAt.localeCompare(b.sentAt)),
    labels: [],
  })
  return { ...result, issues: [...issues, ...result.issues] }
}
