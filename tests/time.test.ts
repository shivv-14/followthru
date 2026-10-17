import { describe, expect, it } from 'vitest'
import { addDays, isValidTimeZone, offsetMs, parseIsoWithOffset, toWallTime, wallTimeToUtc } from '../src/engine/time'

describe('timezone helpers', () => {
  it('validates IANA names', () => {
    expect(isValidTimeZone('Asia/Kolkata')).toBe(true)
    expect(isValidTimeZone('America/Los_Angeles')).toBe(true)
    expect(isValidTimeZone('Mars/Olympus')).toBe(false)
    expect(isValidTimeZone('')).toBe(false)
  })

  it('computes offsets including half-hour zones and DST', () => {
    expect(offsetMs(Date.parse('2026-10-16T00:00:00Z'), 'Asia/Kolkata')).toBe(5.5 * 3_600_000)
    expect(offsetMs(Date.parse('2026-07-01T00:00:00Z'), 'America/Los_Angeles')).toBe(-7 * 3_600_000)
    expect(offsetMs(Date.parse('2026-12-01T00:00:00Z'), 'America/Los_Angeles')).toBe(-8 * 3_600_000)
  })

  it('round-trips wall time and UTC', () => {
    const utc = wallTimeToUtc({ year: 2026, month: 10, day: 16, hour: 18, minute: 0 }, 'Asia/Kolkata')
    expect(utc).toBe('2026-10-16T12:30:00.000Z')
    expect(toWallTime(Date.parse(utc), 'Asia/Kolkata')).toMatchObject({ day: 16, hour: 18, minute: 0, weekday: 5 })
  })

  it('adds calendar days across month ends', () => {
    expect(addDays({ year: 2026, month: 10, day: 30, hour: 0, minute: 0 }, 3)).toMatchObject({ year: 2026, month: 11, day: 2 })
  })

  it('only accepts timestamps with Z or an explicit offset', () => {
    expect(parseIsoWithOffset('2026-10-16T18:00:00+05:30')).toBe('2026-10-16T12:30:00.000Z')
    expect(parseIsoWithOffset('2026-10-16T12:30:00Z')).toBe('2026-10-16T12:30:00.000Z')
    expect(parseIsoWithOffset('2026-10-16T18:00:00')).toBeNull()
    expect(parseIsoWithOffset('16/10/2026 6pm')).toBeNull()
  })
})
