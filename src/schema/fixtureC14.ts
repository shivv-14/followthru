import { parseActionRecord } from '../engine/actionRecord'
import type { ValidationIssue } from '../engine/types'
import type { DatasetInput } from './input'

// Adapter for the C14 starter fixture (Starter_Data/C14/fixture.json):
//   { case_id, records: { messages: [{ message_id, thread_id, timestamp, text }], expected_actions: [...] } }
// It maps the file onto the canonical format without changing any value.
// The fixture names no sender, so its lines are read as entries in one
// coordinator's action log; that assumption is reported as a warning.

export const FIXTURE_LOG_ID = 'action_log'

interface FixtureMessage {
  message_id: string
  thread_id: string
  timestamp: string
  text: string
  author?: string
  sender?: string
}

interface FixtureAction {
  action: string
  owner: string
  deadline: string | null
  status: string
  reminder_eligible?: boolean
}

interface C14Fixture {
  case_id?: string
  records: { messages: FixtureMessage[]; expected_actions?: FixtureAction[] }
}

/** True for the starter-fixture shape: records.messages with message_id and thread_id. */
export function isC14Fixture(input: unknown): input is C14Fixture {
  if (!input || typeof input !== 'object') return false
  const records = (input as { records?: unknown }).records
  if (!records || typeof records !== 'object') return false
  const messages = (records as { messages?: unknown }).messages
  return Array.isArray(messages) && messages.length > 0 && messages.every((m) => m && typeof m === 'object' && 'message_id' in m && 'thread_id' in m)
}

// Offsets seen in the starter data and their usual zones. Unknown offsets fall back to UTC with a warning.
const OFFSET_ZONES: Record<string, string> = {
  '+05:30': 'Asia/Kolkata',
  '+00:00': 'UTC',
  Z: 'UTC',
  '+01:00': 'Europe/London',
  '+04:00': 'Asia/Dubai',
  '+08:00': 'Asia/Singapore',
  '+09:00': 'Asia/Tokyo',
  '-04:00': 'America/New_York',
  '-05:00': 'America/New_York',
  '-07:00': 'America/Los_Angeles',
  '-08:00': 'America/Los_Angeles',
}

function offsetOf(timestamp: string): string {
  const m = /(Z|[+-]\d{2}:\d{2})$/.exec(timestamp.trim())
  return m ? m[1] : 'Z'
}

const slug = (name: string) => name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')

const STATUS: Record<string, 'open' | 'done' | 'cancelled' | 'deferred'> = {
  open: 'open',
  completed: 'done',
  complete: 'done',
  done: 'done',
  cancelled: 'cancelled',
  canceled: 'cancelled',
  deferred: 'deferred',
}

export interface AdaptedFixture {
  input: DatasetInput
  issues: ValidationIssue[]
}

export function adaptC14Fixture(f: C14Fixture): AdaptedFixture {
  const issues: ValidationIssue[] = []
  const messages = f.records.messages
  const offset = offsetOf(messages[0]?.timestamp ?? '')
  const timezone = OFFSET_ZONES[offset] ?? 'UTC'
  if (!OFFSET_ZONES[offset]) {
    issues.push({ code: 'unknown_timezone', severity: 'warning', path: ['records', 'messages', 0, 'timestamp'], message: `No named timezone for offset ${offset}; people are read in UTC` })
  }

  // People: whoever the action lines name as owner, plus any explicit sender
  const people = new Map<string, { id: string; name: string; timezone: string; role?: 'coordinator' | 'member' }>()
  const addPerson = (name: string, role?: 'coordinator' | 'member') => {
    const id = slug(name)
    if (id && !people.has(id)) people.set(id, { id, name: name.trim(), timezone, ...(role ? { role } : {}) })
    return id
  }
  const senderless = messages.some((m) => !(m.author ?? m.sender))
  if (senderless) {
    people.set(FIXTURE_LOG_ID, { id: FIXTURE_LOG_ID, name: 'Coordinator (fixture log)', timezone, role: 'coordinator' })
    issues.push({
      code: 'unknown_author',
      severity: 'warning',
      path: ['records', 'messages'],
      message: 'The fixture names no sender. Its lines are read as entries in the coordinator\'s action log ("Coordinator (fixture log)"), so they may set owner, deadline and status',
    })
  }
  for (const m of messages) {
    const owner = parseActionRecord(m.text)?.ownerName
    if (owner) addPerson(owner, 'member')
  }
  const authorOf = (m: FixtureMessage) => {
    const named = m.author ?? m.sender
    return named ? addPerson(named) : FIXTURE_LOG_ID
  }

  const canonicalMessages = messages.map((m) => ({ id: m.message_id, threadId: m.thread_id, authorId: authorOf(m), sentAt: m.timestamp, text: m.text }))

  // Labels: each expected action points at the first line that opened it
  const firstLine = new Map<string, FixtureMessage>()
  for (const m of messages) {
    const key = parseActionRecord(m.text)?.key
    if (key && !firstLine.has(key)) firstLine.set(key, m)
  }
  const labels = (f.records.expected_actions ?? []).flatMap((a, i) => {
    const key = a.action.toUpperCase()
    const source = firstLine.get(key)
    const status = STATUS[a.status.toLowerCase()]
    if (!source || !status) {
      issues.push({ code: 'label_unknown_message', severity: 'warning', path: ['records', 'expected_actions', i], message: `Expected action ${a.action} has no matching "Action ${a.action}" line or an unknown status "${a.status}"; it is not scored` })
      return []
    }
    const tz = OFFSET_ZONES[offsetOf(source.timestamp)] ?? timezone
    return [
      {
        sourceMessageId: source.message_id,
        ownerId: addPerson(a.owner, 'member'),
        // A date-only label is a calendar day; the instant shown is the end of that day in the team's timezone
        dueAt: a.deadline ? `${a.deadline}T23:59:00${offsetOf(source.timestamp) === 'Z' ? 'Z' : offsetOf(source.timestamp)}` : null,
        status,
        ...(a.deadline && /^\d{4}-\d{2}-\d{2}$/.test(a.deadline) ? { dueDate: a.deadline, timezone: tz } : {}),
        ...(a.reminder_eligible === undefined ? {} : { reminderEligible: a.reminder_eligible }),
        actionKey: key,
        note: `Fixture expected action ${a.action}`,
      },
    ]
  })

  return {
    input: { people: [...people.values()], messages: canonicalMessages, labels },
    issues,
  }
}
