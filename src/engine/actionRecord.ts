import type { CommitmentStatus } from './types'

// Structured action-log lines, as written by trackers and minute-takers:
//   "Action A1: Validate duplicate prevention. Owner: Dev. Deadline: 2026-10-20. Status: open."
//   "Action A1 deadline correction: 2026-10-21. Owner Dev. Still open."
// The key ties later lines to the same action. Fields are read from the text
// only; nothing here knows any answer.

export interface ActionRecord {
  /** Upper-case action key, for example "A1" */
  key: string
  title?: string
  ownerName?: string
  deadlineText?: string
  status?: CommitmentStatus
  /** A status word was present but not understood */
  unknownStatus?: string
}

const HEAD = /^\s*action(?:\s+item)?\s+#?([a-z]{0,4}-?\d{1,6})\b\s*:?\s*/i
const OWNER = /^(?:owner|owned by|assignee|assigned to)(?:\s+is)?\s*:?\s*(.+)$/i
const DEADLINE =
  /^(?:new\s+)?(?:deadline|due(?:\s+date)?)(?:\s+(?:correction|corrected|change|changed|update|updated|revised|revision|moved))?(?:\s+(?:is|to|now))*\s*:?\s*(.+)$/i
const STATUS = /^status(?:\s+is)?\s*:?\s*(.+)$/i
const BARE_STATUS = /^(?:still\s+|now\s+)?(open|in progress|pending|blocked|completed?|done|finished|cancell?ed|dropped|deferred|on hold|postponed)$/i

const STATUS_WORDS: Record<string, CommitmentStatus> = {
  open: 'open',
  'in progress': 'open',
  pending: 'open',
  blocked: 'open',
  complete: 'done',
  completed: 'done',
  done: 'done',
  finished: 'done',
  cancelled: 'cancelled',
  canceled: 'cancelled',
  dropped: 'cancelled',
  deferred: 'deferred',
  'on hold': 'deferred',
  postponed: 'deferred',
}

function readStatus(word: string): CommitmentStatus | undefined {
  const w = word
    .toLowerCase()
    .replace(/^(still|now)\s+/, '')
    .trim()
  return STATUS_WORDS[w]
}

/** Returns the parsed record, or null when the text is not an action-log line. */
export function parseActionRecord(text: string): ActionRecord | null {
  const head = HEAD.exec(text)
  if (!head) return null
  const rec: ActionRecord = { key: head[1].toUpperCase().replace('-', '') }
  const segments = text
    .slice(head[0].length)
    .split(/\.\s+|\.$|;\s*|\n+/)
    .map((s) => s.trim())
    .filter(Boolean)
  let fields = 0
  segments.forEach((seg, i) => {
    let m: RegExpExecArray | null
    if ((m = OWNER.exec(seg))) {
      rec.ownerName = m[1].trim()
      fields++
    } else if ((m = DEADLINE.exec(seg))) {
      rec.deadlineText = m[1].trim()
      fields++
    } else if ((m = STATUS.exec(seg))) {
      const s = readStatus(m[1])
      if (s) rec.status = s
      else rec.unknownStatus = m[1].trim()
      fields++
    } else if ((m = BARE_STATUS.exec(seg))) {
      rec.status = readStatus(m[1])
      fields++
    } else if (i === 0) rec.title = seg
  })
  // "Action 3 is the hard part" is prose, not a record: at least one field must be present
  return fields > 0 ? rec : null
}
