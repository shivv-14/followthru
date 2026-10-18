import { detectSignals, has } from '../engine/signals'
import { titleFrom } from '../engine/signals'
import { parseActionRecord } from '../engine/actionRecord'
import type { ActionItem, EmailAnalysis } from './schema'

// Deterministic fallback reader, used when no AI provider is configured or as a cross-check.
// It is labelled "rules" wherever its result is shown. It never invents a person or a date:
// names and deadline wording are copied from the text, and the server resolves them.

export interface EmailForReading {
  subject: string
  /** Newest reply only (see latestReply) */
  body: string
  fromName: string | null
  automated: boolean
}

const MINUTES = /\b(minutes of (the )?meeting|meeting minutes|meeting notes|\bmom\b|action items?|next steps)\b/i
const BULLET = /^\s*(?:[-*•]|\d{1,2}[.)])\s+(.+)$/
const SECTION = /^\s*#*\s*([a-z][a-z /&-]{2,40}?)\s*:?\s*$/i
const DEADLINE_WORDS = /\b(?:by|before|due(?: on| by)?|deadline:?|until|no later than)\s+(.+?)\s*[.;]?$/i
const URGENT = /\b(urgent|asap|immediately|critical|blocker|top priority|today)\b/i
const THANKS = /^\s*(thanks?( you)?|thank you( so much)?|noted|got it|ok(ay)?|great|cheers|fyi|sounds good)\b[\s\S]{0,120}$/i

function priorityOf(text: string): { priority: ActionItem['priority']; reason: string | null } {
  const m = URGENT.exec(text)
  if (!m) return { priority: 'normal', reason: null }
  const word = m[1].toLowerCase()
  return { priority: word === 'critical' || word === 'blocker' ? 'critical' : 'high', reason: `The email says "${m[1]}"` }
}

/** "Asha: send the deck by Friday", "Asha to send…", "Send the deck (Owner: Asha, due Fri)". */
function itemFromLine(line: string): ActionItem | null {
  const rec = parseActionRecord(line)
  if (rec?.title) {
    const p = priorityOf(line)
    return { title: rec.title, description: null, assignee_email: null, assignee_name: rec.ownerName ?? null, deadline_text: rec.deadlineText ?? null, priority: p.priority, priority_reason: p.reason, blockers: [] }
  }
  let owner: string | null = null
  let rest = line.trim()
  const email = /([\w.+-]+@[\w-]+\.[\w.-]+)/.exec(rest)
  let m = /^@?([A-Z][\w'-]+(?:\s+[A-Z][\w'-]+)?)\s*(?::|-|–|—)\s+(.+)$/.exec(rest)
  if (m) [owner, rest] = [m[1], m[2]]
  else if ((m = /^@?([A-Z][\w'-]+(?:\s+[A-Z][\w'-]+)?)\s+(?:to|will|shall|should)\s+(.+)$/.exec(rest))) [owner, rest] = [m[1], m[2]]
  else if ((m = /^(.+?)\s*[(\[–—-]\s*(?:owner|assignee|assigned to)\s*:?\s*([A-Z][\w'-]+(?:\s+[A-Z][\w'-]+)?)[)\]]?(.*)$/i.exec(rest))) [owner, rest] = [m[2], `${m[1]} ${m[3]}`]
  const dl = DEADLINE_WORDS.exec(rest)
  const deadlineText = dl ? dl[1].replace(/[)\]]+$/, '').trim() : null
  const task = (dl ? rest.slice(0, dl.index) : rest).replace(/[\s,;:–—-]+$/, '').trim()
  if (task.length < 3) return null
  const p = priorityOf(line)
  return {
    title: task.charAt(0).toUpperCase() + task.slice(1, 200),
    description: null,
    assignee_email: email ? email[1].toLowerCase() : null,
    assignee_name: owner,
    deadline_text: deadlineText,
    priority: p.priority,
    priority_reason: p.reason,
    blockers: [],
  }
}

function readMinutes(e: EmailForReading): EmailAnalysis {
  const items: ActionItem[] = []
  const decisions: string[] = []
  const discussion: string[] = []
  const questions: string[] = []
  let section = ''
  for (const raw of e.body.split('\n')) {
    const head = SECTION.exec(raw)
    if (head && !BULLET.test(raw)) {
      section = head[1].toLowerCase()
      continue
    }
    const b = BULLET.exec(raw)
    const line = (b ? b[1] : raw).trim()
    if (!line) continue
    if (/decision/.test(section)) decisions.push(line)
    else if (/question|open/.test(section)) questions.push(line)
    else if (/action|next step|task|to-?do|follow/.test(section) || (b && parseActionRecord(line))) {
      const item = itemFromLine(line)
      if (item) items.push(item)
    } else if (b && /discussion|agenda|update|notes|point/.test(section)) discussion.push(line)
  }
  const complete = items.filter((i) => i.assignee_name || i.assignee_email).length
  return {
    classification: 'meeting_minutes',
    action_required: items.length > 0,
    summary: `${e.subject || 'Meeting minutes'}: ${items.length} action items, ${decisions.length} decisions`,
    items,
    update: null,
    minutes: { title: e.subject || 'Meeting minutes', decisions, discussion, open_questions: questions },
    confidence: items.length === 0 ? 0.5 : complete === items.length ? 0.8 : 0.6,
    requires_human_review: false,
    reasoning_summary: `Rules: read ${items.length} bulleted action items under an action-items heading; owner taken from the leading name, deadline from "by/due" wording.`,
    evidence_quotes: items.slice(0, 10).map((i) => i.title),
  }
}

function base(e: EmailForReading, over: Partial<EmailAnalysis>): EmailAnalysis {
  return {
    classification: 'informational',
    action_required: false,
    summary: e.subject || e.body.slice(0, 120),
    items: [],
    update: null,
    minutes: null,
    confidence: 0.7,
    requires_human_review: false,
    reasoning_summary: '',
    evidence_quotes: [],
    ...over,
  }
}

/** Reads one email with deterministic rules. */
export function rulesAnalyze(e: EmailForReading): EmailAnalysis {
  const text = e.body.trim()
  const quote = text.replace(/\s+/g, ' ').slice(0, 300)
  if (e.automated) return base(e, { classification: 'automated', confidence: 0.95, reasoning_summary: 'Rules: bulk or automated sender headers.' })
  if (MINUTES.test(`${e.subject}\n${text}`) && text.split('\n').some((l) => BULLET.test(l))) return readMinutes(e)
  if (!text || (THANKS.test(text) && text.length < 160)) {
    return base(e, { classification: 'informational', confidence: 0.85, reasoning_summary: 'Rules: short acknowledgement with no request.' })
  }

  const signals = detectSignals(text)
  const hint = `${e.subject} ${text}`.slice(0, 200)
  const update = (kind: NonNullable<EmailAnalysis['update']>['kind'], over: Partial<NonNullable<EmailAnalysis['update']>> = {}) => ({
    kind,
    target_hint: hint,
    new_deadline_text: null,
    blocker: null,
    evidence_quote: quote,
    ...over,
  })

  const extension = /\b(move|push|extend|shift|postpone)\b[^.?!]{0,40}\b(deadline|due date|date)\b|\bmore time\b|\bextension\b/i.test(text)
  if (extension || has(signals, 'reschedule')) {
    const dl = /\b(?:to|until|till|by)\s+((?:mon|tue|wed|thu|fri|sat|sun)\w*|\d{1,2}(?:st|nd|rd|th)?\s+\w+|\w+\s+\d{1,2}(?:st|nd|rd|th)?|\d{4}-\d{2}-\d{2}|tomorrow|next week)\b/i.exec(text)
    return base(e, {
      classification: 'extension_request',
      action_required: true,
      update: update('extension_request', { new_deadline_text: dl ? dl[1] : null, blocker: has(signals, 'blocker') ? quote : null }),
      confidence: dl ? 0.75 : 0.55,
      reasoning_summary: 'Rules: the sender asks to move the deadline; the official deadline only changes after approval.',
      evidence_quotes: [quote],
    })
  }
  if (has(signals, 'blocker') || /\b(can(?:no|')t|unable to) (?:finish|complete|proceed|continue|start)\b[^.]*\buntil\b/i.test(text)) {
    return base(e, { classification: 'blocker', action_required: true, update: update('blocker', { blocker: quote }), confidence: 0.75, reasoning_summary: 'Rules: the sender says the work is waiting on something.', evidence_quotes: [quote] })
  }
  if (has(signals, 'cancel')) {
    return base(e, { classification: 'cancelled', action_required: true, update: update('cancelled'), confidence: 0.7, reasoning_summary: 'Rules: the sender says the work is no longer needed.', evidence_quotes: [quote] })
  }
  if (has(signals, 'done')) {
    return base(e, { classification: 'completed', action_required: true, update: update('completed'), confidence: 0.75, reasoning_summary: 'Rules: the sender reports the work as finished.', evidence_quotes: [quote] })
  }
  if (has(signals, 'request') || has(signals, 'commit')) {
    const firstSentence = text.split(/(?<=[.!?])\s+/).find((s) => /\b(please|can you|could you|need you|will you|i'?ll|i will|make sure)\b/i.test(s)) ?? text
    const item = itemFromLine(firstSentence.replace(/^(hi|hello|hey|dear)\b[^,\n]*[,\n]\s*/i, ''))
    const leading = /^@?([A-Z][\w'-]+)\s*,/.exec(text.replace(/^(hi|hello|hey|dear)\s+/i, ''))
    const title = titleFrom(firstSentence.replace(/^(hi|hello|hey|dear)\b[^,\n]*[,\n]\s*/i, ''), [])
    const p = priorityOf(text)
    const dl = DEADLINE_WORDS.exec(firstSentence.replace(/[.!]+$/, ''))
    return base(e, {
      classification: 'new_task',
      action_required: true,
      items: [
        {
          title: title.length >= 3 ? title : (item?.title ?? e.subject),
          description: text.slice(0, 2000),
          assignee_email: item?.assignee_email ?? null,
          assignee_name: leading?.[1] ?? null,
          deadline_text: dl ? dl[1] : null,
          priority: p.priority,
          priority_reason: p.reason,
          blockers: [],
        },
      ],
      confidence: 0.7,
      reasoning_summary: 'Rules: a direct request or promise; owner from the greeting or the single recipient, deadline from "by …" wording.',
      evidence_quotes: [quote],
    })
  }
  return base(e, { classification: 'informational', confidence: 0.6, reasoning_summary: 'Rules: no request, promise or status change found.' })
}
