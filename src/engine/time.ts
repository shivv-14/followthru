import type { IsoUtc, TimeZoneId } from './types'

export interface WallTime {
  year: number
  month: number // 1-12
  day: number
  hour: number
  minute: number
  second?: number
}

const formatters = new Map<string, Intl.DateTimeFormat>()

function formatterFor(tz: TimeZoneId): Intl.DateTimeFormat {
  let f = formatters.get(tz)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
      weekday: 'short',
    })
    formatters.set(tz, f)
  }
  return f
}

export function isValidTimeZone(tz: string): boolean {
  if (!tz) return false
  try {
    formatterFor(tz)
    return true
  } catch {
    return false
  }
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** Wall-clock parts of a UTC instant in the given timezone. weekday: 0 = Sunday. */
export function toWallTime(ms: number, tz: TimeZoneId): Required<WallTime> & { weekday: number } {
  const parts = formatterFor(tz).formatToParts(new Date(ms))
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? ''
  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    hour: Number(get('hour')),
    minute: Number(get('minute')),
    second: Number(get('second')),
    weekday: WEEKDAYS.indexOf(get('weekday')),
  }
}

/** Offset of tz from UTC at the given instant, in milliseconds (IST = +19800000). */
export function offsetMs(ms: number, tz: TimeZoneId): number {
  const w = toWallTime(ms, tz)
  const asUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second)
  return asUtc - Math.floor(ms / 1000) * 1000
}

function sameWall(ms: number, tz: TimeZoneId, w: WallTime): boolean {
  const x = toWallTime(ms, tz)
  return x.year === w.year && x.month === w.month && x.day === w.day && x.hour === w.hour && x.minute === w.minute
}

/**
 * Converts a wall-clock time in tz to a UTC instant.
 * DST rule, chosen so reminders are never early:
 * - time inside a spring-forward gap moves forward (02:30 becomes 03:30 local)
 * - ambiguous fall-back time takes the later instant
 */
export function wallTimeToUtcMs(w: WallTime, tz: TimeZoneId): number {
  const guess = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second ?? 0)
  const DAY = 86_400_000
  const before = offsetMs(guess - DAY, tz)
  const after = offsetMs(guess + DAY, tz)
  const candidates = [...new Set([guess - before, guess - after])].filter((ms) => sameWall(ms, tz, w))
  if (candidates.length > 0) return Math.max(...candidates)
  // Gap: apply the offset in force before the transition, which lands after the gap.
  return guess - before
}

export function wallTimeToUtc(w: WallTime, tz: TimeZoneId): IsoUtc {
  return new Date(wallTimeToUtcMs(w, tz)).toISOString()
}

/** Adds whole calendar days to a date in wall-clock terms. */
export function addDays(w: WallTime, days: number): WallTime {
  const d = new Date(Date.UTC(w.year, w.month - 1, w.day + days))
  return { ...w, year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() }
}

/** Parses an ISO timestamp that carries Z or an explicit offset. Returns null otherwise. */
export function parseIsoWithOffset(value: string): IsoUtc | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/.test(value)) return null
  const ms = Date.parse(value)
  return Number.isNaN(ms) ? null : new Date(ms).toISOString()
}
