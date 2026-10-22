// Deterministic message signals. Each detector returns the rule name that
// fired so every decision can be explained with evidence.

export type SignalKind =
  | 'request'
  | 'commit'
  | 'accept'
  | 'done'
  | 'cancel'
  | 'defer'
  | 'reschedule'
  | 'delegate'
  | 'decline'
  | 'not_done'
  | 'blocker'
  | 'progress'
  | 'reopen'

export interface Signal {
  kind: SignalKind
  rule: string
}

const REQUEST = /\b(can|could|would|will) you\b|\bplease\b|\bneed you to\b|\bmake sure\b|\bcan (someone|anyone)\b|\bplz\b/i
const COMMIT = /\b(i'?ll|i will|i can|i'?m going to|i am going to|let me|will do|on it|i'?ll get|i'?ll have)\b/i
const ACCEPT_START = /^\W*(sure|ok(ay)?|yes|yep|yeah|will do|on it|done deal|sounds good|got it|can do|no problem|absolutely|happy to|consider it done)\b/i
const DECLINE = /\b(can'?t|cannot|won'?t be able|not able to|unable to)\b.{0,30}\b(take|do|make|handle|own)\b|\bnot me\b/i

const DONE = /\b(done|completed?|finished|sent|shipped|delivered|submitted|merged|deployed|uploaded|shared|published|wrapped up|closed out|fixed|resolved|signed off)\b/i
// Future or negated completion words are not completion: "will be done", "not sent yet", "almost finished".
const DONE_NEGATED =
  /\b(not|n'?t|never|yet to|still|almost|nearly|will|'ll|going to|gonna|should|might|may|hope to|plan to|try to|once|when|until|if|before|please|pls|kindly|must|need to|needs to|have to|has to|can you|could you|would you)\b[^.!?]{0,25}\b(done|completed?|finished|sent|shipped|delivered|submitted|merged|deployed|uploaded|shared|published|fixed|resolved)\b|\b(done|sent|finished|shipped|submitted)\b[^.!?]{0,6}\byet\b|\?\s*$/i

const CANCEL = /\b(cancel(l?ed|ling)?|no longer needed|not needed any ?more|don'?t need (it|this|that) any ?more|drop (it|this|that)|scrap(ped)?( it| this| that)?|never ?mind|call(ed)? (it )?off|kill (it|this))\b/i
const DEFER =
  /\b(defer(red|ring)?|put (it |this |that )?on hold|on hold|park (it|this|that)|parking (it|this)|revisit (it |this )?later|push (it |this )?to next (quarter|month|sprint|cycle)|next quarter|not this (week|sprint|quarter)|after (the )?launch|backlog(ged)? (it|this)|later this year|postpone(d)? (it |this )?(indefinitely|for now))\b/i
const RESCHEDULE =
  /\b(move|moving|moved|push|pushing|pushed|shift|shifting|extend|extending|extended|reschedul(e|ed|ing)|postpone|postponed|bump|delay(ed)?)\b[^.!?]{0,40}\b(to|until|till|by)\b|\bnew (deadline|date|due date)\b|\binstead\b|\bdeadline is now\b/i
// Owner updates that never change status on their own
const NOT_DONE = /\b(not yet|still working|running late|need more time|not done|not finished)\b/i
const BLOCKER = /\b(blocked (?:by|on)|waiting on|waiting for|can'?t until|stuck on)\b/i
const PROGRESS = /\b(making progress|half ?way|almost there|almost done|first draft ready|nearly done)\b/i
// A completion taken back after the fact
const REOPEN = /\b(not done after all|still broken|reopen(?:ing|ed)?|that was the wrong file|please redo|actually (?:it'?s )?not done)\b/i

const DELEGATE =
  /\b(hand(ing|ed)? (it |this |that )?(over )?to|reassign(ing|ed)?( it| this| that)? to|pass(ing|ed)? (it |this |that )?(over )?to|delegat(e|ing|ed)( it| this| that)? to|(will|can) you take (this|it|that) over|take over\b|is taking (this|it) over|will (take|own|handle) (this|it|that)( over)?|owner is now)\b/i

export function detectSignals(text: string): Signal[] {
  const t = text.trim()
  const out: Signal[] = []
  if (REOPEN.test(t)) out.push({ kind: 'reopen', rule: 'REOPEN' })
  if (NOT_DONE.test(t) && !REOPEN.test(t)) out.push({ kind: 'not_done', rule: 'NOT_DONE' })
  if (BLOCKER.test(t)) out.push({ kind: 'blocker', rule: 'BLOCKER' })
  if (PROGRESS.test(t)) out.push({ kind: 'progress', rule: 'PROGRESS' })
  if (CANCEL.test(t)) out.push({ kind: 'cancel', rule: 'CANCEL' })
  if (DEFER.test(t)) out.push({ kind: 'defer', rule: 'DEFER' })
  if (DELEGATE.test(t)) out.push({ kind: 'delegate', rule: 'DELEGATE' })
  if (RESCHEDULE.test(t)) out.push({ kind: 'reschedule', rule: 'RESCHEDULE' })
  if (DONE.test(t) && !DONE_NEGATED.test(t)) out.push({ kind: 'done', rule: 'DONE' })
  if (DECLINE.test(t)) out.push({ kind: 'decline', rule: 'DECLINE' })
  if (ACCEPT_START.test(t)) out.push({ kind: 'accept', rule: 'ACCEPT' })
  if (REQUEST.test(t)) out.push({ kind: 'request', rule: 'REQUEST' })
  if (COMMIT.test(t)) out.push({ kind: 'commit', rule: 'COMMIT' })
  return out
}

export function has(signals: Signal[], kind: SignalKind): Signal | undefined {
  return signals.find((s) => s.kind === kind)
}

const STOP = new Set(
  'a an the to of for and or but on in at by with from into about this that these those it its is are was were be been being i you we they he she me my your our their can could would will shall should please just also so up out over then than if when as do does did done get got have has had let lets ill im ive youll well sure ok okay yes no not now today tomorrow friday monday tuesday wednesday thursday saturday sunday eod week next maybe hi hey thanks thank'.split(
    ' ',
  ),
)

/** Lowercase content words used for linking messages to commitments. */
export function keywords(text: string): string[] {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP.has(w))
  return [...new Set(words.map(stem))]
}

const IRREGULAR: Record<string, string> = {
  sent: 'send',
  made: 'make',
  wrote: 'write',
  written: 'write',
  gave: 'give',
  given: 'give',
  built: 'build',
  paid: 'pay',
  sold: 'sell',
  told: 'tell',
  bought: 'buy',
  took: 'take',
  taken: 'take',
  met: 'meet',
  drew: 'draw',
  drawn: 'draw',
  began: 'begin',
  begun: 'begin',
}

/** Rough stem so "sent" matches "send" and "shared" matches "share". */
function stem(word: string): string {
  const w = IRREGULAR[word] ?? word
  const base = w.length > 4 ? w.replace(/(ing|ed|es|s)$/, '') : w
  return (base.length > 3 ? base.replace(/e$/, '') : base) || w
}

/** Share of the commitment's keywords that appear in the message (0 to 1). */
export function overlap(commitmentWords: string[], messageWords: string[]): number {
  if (commitmentWords.length === 0) return 0
  const set = new Set(messageWords)
  return commitmentWords.filter((w) => set.has(w)).length / commitmentWords.length
}

/** Short task title from the message that opened the commitment. */
export function titleFrom(text: string, namesToStrip: string[]): string {
  let t = text.replace(/\s+/g, ' ').trim()
  for (const n of namesToStrip) t = t.replace(new RegExp(`^@?${escapeRe(n)}\\b[,:]?\\s*`, 'i'), '')
  t = t.replace(/@\w+\s*/g, '')
  t = t.replace(
    /^(hey|hi|hello|ok(ay)?|sure|yes|yep|so|also|and)\b[,!]?\s*/i,
    '',
  )
  t = t.replace(/^(can|could|would|will) you( please)?\s+|^please\s+|^i'?ll\s+|^i will\s+|^i can\s+|^i'?m going to\s+|^i am going to\s+|^let me\s+|^need you to\s+|^make sure( to)?\s+/i, '')
  t = t.replace(/^(please|also|maybe|probably|hopefully)\s+/i, '')
  t =
    t.split(
      /\s+(by|before|until|on|at|around|maybe|probably|hopefully|tomorrow|today|tonight|next|this|eod|monday|tuesday|wednesday|thursday|friday|saturday|sunday|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\b|[?.!;]/i,
    )[0] ?? t
  t = t.trim().replace(/[,:-]+$/, '')
  const words = t.split(' ').slice(0, 9).join(' ')
  return words ? words[0].toUpperCase() + words.slice(1) : text.slice(0, 60)
}

export function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Short quote for evidence. Never the full message. */
export function quote(text: string, max = 80): string {
  const t = text.replace(/\s+/g, ' ').trim()
  return t.length <= max ? t : `${t.slice(0, max - 1)}…`
}
