import type { CommitmentStatus, Deadline, DeadlineState, IsoUtc, TimeZoneId } from './types'
import { addDays, toWallTime, wallTimeToUtcMs, zoneFromAbbreviation, ZONE_ABBREVIATIONS, type WallTime } from './time'

// Default times, read in the speaker's timezone. Date-only deadlines get the
// end of the day so nobody is chased before the day is over.
export const DATE_ONLY_TIME = { hour: 23, minute: 59 }
export const END_OF_DAY_TIME = { hour: 18, minute: 0 }
const MORNING_TIME = { hour: 12, minute: 0 }
const AFTERNOON_TIME = { hour: 17, minute: 0 }

const HEDGE_RE =
  /\b(maybe|perhaps|possibly|probably|hopefully|might|tentative(?:ly)?|not sure|no promises|if possible|if all goes well|or so|should be able to|(?:will |i'?ll )?try (?:to|and)|aim(?:ing)? (?:for|to)|i think|around|roughly|approx(?:imately)?|ish|(?:\d{1,2}(?::\d{2})?(?:am|pm)?|(?:mon|tues|wednes|thurs|fri|satur|sun)day)-?ish)\b/i

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
const MONTH_RE = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)'
const WEEKDAY_NAMES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']
const WEEKDAY_RE = '(sun(?:day)?|mon(?:day)?|tue(?:s(?:day)?)?|wed(?:nesday)?|thu(?:r(?:s(?:day)?)?)?|fri(?:day)?|sat(?:urday)?)'

interface Match {
  start: number
  end: number
}

interface DatePart extends Match {
  date: WallTime
  /** Time implied by the date words themselves (EOD, tonight) */
  impliedTime?: { hour: number; minute: number }
}

interface TimePart extends Match {
  hour: number
  minute: number
  /** Explicit zone written after the time ("5pm IST") */
  zone?: TimeZoneId
}

const ZONE_RE = new RegExp(`^\\s*(${Object.keys(ZONE_ABBREVIATIONS).join('|')})\\b`, 'i')
const NUMBER_WORDS: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 }
const COUNT_RE = '(\\d+|an?|one|two|three|four|five|six|seven|eight|nine|ten)'

function toNumber(word: string): number {
  return NUMBER_WORDS[word.toLowerCase()] ?? Number(word)
}

export interface DeadlineContext {
  /** When the phrase was said */
  saidAt: IsoUtc
  /** Speaker's timezone */
  tz: TimeZoneId
}

export function isHedged(text: string): boolean {
  return HEDGE_RE.test(text)
}

function closestYear(month: number, day: number, today: WallTime): number {
  const candidates = [today.year - 1, today.year, today.year + 1]
  const base = Date.UTC(today.year, today.month - 1, today.day)
  return candidates.reduce((best, y) =>
    Math.abs(Date.UTC(y, month - 1, day) - base) < Math.abs(Date.UTC(best, month - 1, day) - base) ? y : best,
  )
}

function isRealDate(y: number, m: number, d: number): boolean {
  const dt = new Date(Date.UTC(y, m - 1, d))
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d
}

function findDate(text: string, today: WallTime & { weekday: number }): DatePart | null {
  let m = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(text)
  if (m) {
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
    if (isRealDate(y, mo, d)) return { start: m.index, end: m.index + m[0].length, date: { year: y, month: mo, day: d, hour: 0, minute: 0 } }
  }

  m = new RegExp(`\\b${MONTH_RE}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`, 'i').exec(text)
  const dm = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MONTH_RE}\\b`, 'i').exec(text)
  const monthDay = m ? { month: m[1], day: m[2], match: m } : dm ? { month: dm[2], day: dm[1], match: dm } : null
  if (monthDay) {
    const month = MONTHS.indexOf(monthDay.month.slice(0, 3).toLowerCase()) + 1
    const day = Number(monthDay.day)
    const year = closestYear(month, day, today)
    if (isRealDate(year, month, day)) {
      const mm = monthDay.match
      return { start: mm.index, end: mm.index + mm[0].length, date: { year, month, day, hour: 0, minute: 0 } }
    }
  }

  // Numeric dates are day/month (India and UK); month/day only when day/month is impossible.
  m = /\b(\d{1,2})[/-](\d{1,2})(?:[/-](\d{4}|\d{2}))?\b/.exec(text)
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])]
    const [day, month] = b <= 12 ? [a, b] : [b, a]
    const year = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : closestYear(month, day, today)
    if (isRealDate(year, month, day)) return { start: m.index, end: m.index + m[0].length, date: { year, month, day, hour: 0, minute: 0 } }
  }

  // "in 2 days", "within a week": calendar days, end of that local day
  m = new RegExp(`\\b(?:in|within)\\s+${COUNT_RE}\\s+(days?|weeks?)\\b`, 'i').exec(text)
  if (m) {
    const n = toNumber(m[1]) * (m[2].toLowerCase().startsWith('week') ? 7 : 1)
    return { start: m.index, end: m.index + m[0].length, date: addDays(today, n) }
  }

  const toNextMonday = (1 - today.weekday + 7) % 7 || 7
  m = /\bend of next week\b/i.exec(text)
  if (m) return { start: m.index, end: m.index + m[0].length, date: addDays(today, toNextMonday + 4), impliedTime: END_OF_DAY_TIME }
  m = /\bnext week\b/i.exec(text)
  if (m) return { start: m.index, end: m.index + m[0].length, date: addDays(today, toNextMonday) }

  m = /\b(day after tomorrow|tomorrow|tmrw|tonight|today|end of (?:the )?day|eod|cob|close of business|end of (?:the )?week|eow)\b/i.exec(text)
  if (m) {
    const word = m[1].toLowerCase()
    const span = { start: m.index, end: m.index + m[0].length }
    if (word === 'day after tomorrow') return { ...span, date: addDays(today, 2) }
    if (word === 'tomorrow' || word === 'tmrw') return { ...span, date: addDays(today, 1) }
    if (word === 'tonight') return { ...span, date: today, impliedTime: DATE_ONLY_TIME }
    if (word === 'today') return { ...span, date: today }
    if (word.includes('week') || word === 'eow') {
      const toFriday = (5 - today.weekday + 7) % 7
      return { ...span, date: addDays(today, toFriday), impliedTime: END_OF_DAY_TIME }
    }
    return { ...span, date: today, impliedTime: END_OF_DAY_TIME }
  }

  m = new RegExp(`\\b(next\\s+|this\\s+|coming\\s+)?${WEEKDAY_RE}(?:-?ish)?\\b`, 'i').exec(text)
  if (m) {
    const target = WEEKDAY_NAMES.indexOf(m[2].slice(0, 3).toLowerCase())
    let diff = (target - today.weekday + 7) % 7
    // "next Friday" is read as the first Friday strictly after today.
    if (diff === 0 && m[1]?.trim().toLowerCase() === 'next') diff = 7
    return { start: m.index, end: m.index + m[0].length, date: addDays(today, diff) }
  }
  return null
}

/** Adds an explicit zone written right after a clock time ("5pm IST"). */
function withZone(text: string, t: TimePart): TimePart {
  const z = ZONE_RE.exec(text.slice(t.end))
  if (!z) return t
  return { ...t, end: t.end + z[0].length, zone: zoneFromAbbreviation(z[1]) }
}

function findTime(text: string): TimePart | null {
  let m = /\b(1[0-2]|0?[1-9])(?::([0-5]\d))?\s*(am|pm)\b/i.exec(text)
  if (m) {
    let hour = Number(m[1]) % 12
    if (m[3].toLowerCase() === 'pm') hour += 12
    return withZone(text, { start: m.index, end: m.index + m[0].length, hour, minute: Number(m[2] ?? 0) })
  }
  // "5ish" with no am/pm: 1 to 7 read as pm, 8 to 12 as am or noon (working hours).
  m = /\b(1[0-2]|0?[1-9])-?ish\b/i.exec(text)
  if (m) {
    const h = Number(m[1])
    return { start: m.index, end: m.index + m[0].length, hour: h <= 7 ? h + 12 : h, minute: 0 }
  }
  m = /\b([01]?\d|2[0-3]):([0-5]\d)\b/.exec(text)
  if (m) return withZone(text, { start: m.index, end: m.index + m[0].length, hour: Number(m[1]), minute: Number(m[2]) })
  m = /\b(eod|cob|end of (?:the )?day|close of business)\b/i.exec(text)
  if (m) return { start: m.index, end: m.index + m[0].length, ...END_OF_DAY_TIME }
  m = /\b(noon|midday|midnight|morning|afternoon|evening)\b/i.exec(text)
  if (m) {
    const word = m[1].toLowerCase()
    const t =
      word === 'noon' || word === 'midday' || word === 'morning'
        ? MORNING_TIME
        : word === 'afternoon'
          ? AFTERNOON_TIME
          : word === 'evening'
            ? END_OF_DAY_TIME
            : DATE_ONLY_TIME
    return { start: m.index, end: m.index + m[0].length, ...t }
  }
  return null
}

/**
 * Reads a deadline phrase in the speaker's timezone and returns a UTC instant.
 * Returns null when the text has no deadline phrase.
 * Hedged phrases ("maybe Friday") come back with certainty 'tentative'.
 */
/** A "?" right after a short date question ("Friday?", "by Friday?") makes it tentative. A full proposal sentence stays firm. */
function isShortDateQuestion(text: string, start: number, end: number): boolean {
  if (!/^\s*\?/.test(text.slice(end))) return false
  const sentenceStart = Math.max(text.lastIndexOf('.', start), text.lastIndexOf('!', start), text.lastIndexOf('?', start - 1), text.lastIndexOf('\n', start)) + 1
  return text.slice(sentenceStart, end).trim().split(/\s+/).length <= 4
}

export function parseDeadline(text: string, ctx: DeadlineContext): Deadline | null {
  const saidMs = Date.parse(ctx.saidAt)
  const today = toWallTime(saidMs, ctx.tz)

  // "in 3 hours", "within 48 hours": an exact duration from when it was said
  const hours = new RegExp(`\\b(?:in|within)\\s+${COUNT_RE}\\s+hours?\\b`, 'i').exec(text)
  if (hours) {
    return {
      dueAt: new Date(saidMs + toNumber(hours[1]) * 3_600_000).toISOString(),
      certainty: isHedged(text) ? 'tentative' : 'firm',
      phrase: hours[0],
      interpretedTz: ctx.tz,
    }
  }

  const datePart = findDate(text, today)
  const timePart = findTime(text)
  if (!datePart && !timePart) return null

  // The calendar day comes from the speaker's "today"; an explicit zone then applies to the time.
  const tz = timePart?.zone ?? ctx.tz
  let date: WallTime = datePart?.date ?? today
  const time = timePart ?? datePart?.impliedTime ?? DATE_ONLY_TIME
  let dueMs = wallTimeToUtcMs({ ...date, hour: time.hour, minute: time.minute, second: 0 }, tz)

  // A bare time or bare weekday that has already passed today means the next one.
  const relativeOnly = !datePart || /^(sun|mon|tue|wed|thu|fri|sat)/i.test(text.slice(datePart.start, datePart.end).replace(/^(this|coming)\s+/i, ''))
  if (dueMs <= saidMs && relativeOnly) {
    date = addDays(date, datePart ? 7 : 1)
    dueMs = wallTimeToUtcMs({ ...date, hour: time.hour, minute: time.minute, second: 0 }, tz)
  }

  const spans = [datePart, timePart].filter((p): p is DatePart | TimePart => p !== null)
  const start = Math.min(...spans.map((s) => s.start))
  const end = Math.max(...spans.map((s) => s.end))
  const hedged = isHedged(text) || isShortDateQuestion(text, start, end)
  const hedge = HEDGE_RE.exec(text)
  let phrase = text.slice(start, end).trim()
  if (hedge && hedge.index < start) {
    // Keep the hedge visible: "maybe Friday", even when other words sit between them
    if (start - hedge.index <= 25) phrase = text.slice(hedge.index, end).trim()
    else phrase = `${hedge[0]} ${phrase}`
  }

  return {
    dueAt: new Date(dueMs).toISOString(),
    certainty: hedged ? 'tentative' : 'firm',
    phrase,
    interpretedTz: tz,
  }
}

/** Overdue only when open, firm, and strictly past the due instant. Exactly at dueAt is not overdue. */
export function isOverdue(deadline: Deadline, status: CommitmentStatus, now: IsoUtc): boolean {
  return status === 'open' && deadline.certainty === 'firm' && deadline.dueAt !== null && Date.parse(now) > Date.parse(deadline.dueAt)
}

export function deadlineState(deadline: Deadline, now: IsoUtc): DeadlineState {
  if (deadline.dueAt === null || deadline.certainty === 'none') return 'none'
  const passed = Date.parse(now) > Date.parse(deadline.dueAt)
  if (deadline.certainty === 'tentative') return passed ? 'tentative_passed' : 'tentative_upcoming'
  return passed ? 'overdue' : 'upcoming'
}

/** For example "Fri 16 Oct 2026, 18:00 GMT+5:30" */
export function formatDeadline(dueAt: IsoUtc, tz: TimeZoneId, locale = 'en-GB'): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone: tz,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZoneName: 'short',
  }).format(new Date(dueAt))
}

/** Owner's time and viewer's time for the same instant. */
export function formatDeadlineDual(dueAt: IsoUtc, ownerTz: TimeZoneId, viewerTz: TimeZoneId) {
  return { owner: formatDeadline(dueAt, ownerTz), viewer: formatDeadline(dueAt, viewerTz), sameZone: ownerTz === viewerTz }
}
