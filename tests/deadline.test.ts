import { describe, expect, it } from 'vitest'
import { deadlineState, formatDeadline, formatDeadlineDual, isHedged, isOverdue, parseDeadline } from '../src/engine/deadline'
import type { Deadline } from '../src/engine/types'

const IST = 'Asia/Kolkata'
const PT = 'America/Los_Angeles'
// Wed 14 Oct 2026 10:30 IST = Tue 13 Oct 2026 22:00 PDT
const WED_MORNING_IST = '2026-10-14T05:00:00.000Z'

describe('parseDeadline in the speaker timezone', () => {
  it('reads Friday 6pm in IST', () => {
    const d = parseDeadline('I will send the deck by Friday 6pm', { saidAt: WED_MORNING_IST, tz: IST })
    expect(d).toMatchObject({ dueAt: '2026-10-16T12:30:00.000Z', certainty: 'firm', phrase: 'Friday 6pm', interpretedTz: IST })
  })

  it('reads the same words from a Pacific speaker as a different instant', () => {
    const d = parseDeadline('I will send the deck by Friday 6pm', { saidAt: WED_MORNING_IST, tz: PT })
    expect(d?.dueAt).toBe('2026-10-17T01:00:00.000Z')
  })

  it('gives date-only deadlines the end of that local day', () => {
    expect(parseDeadline('done by Oct 20', { saidAt: WED_MORNING_IST, tz: IST })?.dueAt).toBe('2026-10-20T18:29:00.000Z')
    expect(parseDeadline('done by 20th October', { saidAt: WED_MORNING_IST, tz: IST })?.dueAt).toBe('2026-10-20T18:29:00.000Z')
    expect(parseDeadline('due 2026-10-20', { saidAt: WED_MORNING_IST, tz: IST })?.dueAt).toBe('2026-10-20T18:29:00.000Z')
  })

  it('reads EOD as 18:00 local', () => {
    expect(parseDeadline('will share EOD', { saidAt: WED_MORNING_IST, tz: IST })?.dueAt).toBe('2026-10-14T12:30:00.000Z')
    expect(parseDeadline('tomorrow EOD works', { saidAt: WED_MORNING_IST, tz: IST })?.dueAt).toBe('2026-10-15T12:30:00.000Z')
  })

  it('reads tomorrow and tonight relative to the speaker day', () => {
    // 22:00 PDT on Tue: "tomorrow" is Wed in Pacific, even though it is already Wed in IST
    expect(parseDeadline('tomorrow 9am', { saidAt: WED_MORNING_IST, tz: PT })?.dueAt).toBe('2026-10-14T16:00:00.000Z')
    expect(parseDeadline('tonight', { saidAt: WED_MORNING_IST, tz: IST })?.dueAt).toBe('2026-10-14T18:29:00.000Z')
  })

  it('treats the same weekday as today unless the time has passed', () => {
    const fridayMorningIst = '2026-10-16T04:30:00.000Z' // Fri 10:00 IST
    expect(parseDeadline('by Friday', { saidAt: fridayMorningIst, tz: IST })?.dueAt).toBe('2026-10-16T18:29:00.000Z')
    expect(parseDeadline('Friday 9am', { saidAt: fridayMorningIst, tz: IST })?.dueAt).toBe('2026-10-23T03:30:00.000Z')
    expect(parseDeadline('next Friday', { saidAt: fridayMorningIst, tz: IST })?.dueAt).toBe('2026-10-23T18:29:00.000Z')
  })

  it('moves a bare time that already passed to the next day', () => {
    const sixPmIst = '2026-10-14T12:30:00.000Z'
    expect(parseDeadline('by 5pm', { saidAt: sixPmIst, tz: IST })?.dueAt).toBe('2026-10-15T11:30:00.000Z')
  })

  it('returns null when there is no deadline phrase', () => {
    expect(parseDeadline('I will finish and publish the report', { saidAt: WED_MORNING_IST, tz: IST })).toBeNull()
  })
})

describe('tentative deadlines', () => {
  it('marks "maybe Friday" as tentative and keeps the hedge in the phrase', () => {
    const d = parseDeadline('maybe Friday?', { saidAt: WED_MORNING_IST, tz: IST })
    expect(d).toMatchObject({ certainty: 'tentative', phrase: 'maybe Friday', dueAt: '2026-10-16T18:29:00.000Z' })
  })

  it.each(['hopefully by Friday', 'I will try to get it done Friday', 'probably Oct 20', 'Fridayish', 'around 5ish', 'should be able to send tomorrow'])(
    'flags %s as hedged',
    (text) => {
      expect(isHedged(text)).toBe(true)
      expect(parseDeadline(text, { saidAt: WED_MORNING_IST, tz: IST })?.certainty).toBe('tentative')
    },
  )

  it.each(['I will publish it by Friday', 'Finish the English draft by Oct 20', 'Sending it Friday 6pm'])('keeps %s firm', (text) => {
    expect(isHedged(text)).toBe(false)
    expect(parseDeadline(text, { saidAt: WED_MORNING_IST, tz: IST })?.certainty).toBe('firm')
  })
})

describe('daylight saving edge cases (America/Los_Angeles)', () => {
  it('moves a time in the spring-forward gap forward, never earlier', () => {
    // 8 Mar 2026 02:30 does not exist; 03:30 PDT = 10:30Z
    const d = parseDeadline('Mar 8 2:30am', { saidAt: '2026-03-05T18:00:00.000Z', tz: PT })
    expect(d?.dueAt).toBe('2026-03-08T10:30:00.000Z')
  })

  it('picks the later instant for an ambiguous fall-back time', () => {
    // 1 Nov 2026 01:30 happens twice; 01:30 PST = 09:30Z
    const d = parseDeadline('Nov 1 1:30am', { saidAt: '2026-10-28T18:00:00.000Z', tz: PT })
    expect(d?.dueAt).toBe('2026-11-01T09:30:00.000Z')
  })

  it('uses the new offset for a deadline after the change', () => {
    // Said Fri 30 Oct (PDT); Monday 2 Nov 9am is PST = 17:00Z
    const d = parseDeadline('Monday 9am', { saidAt: '2026-10-30T17:00:00.000Z', tz: PT })
    expect(d?.dueAt).toBe('2026-11-02T17:00:00.000Z')
  })

  it('IST has no DST, so the same local time keeps the same UTC hour', () => {
    expect(parseDeadline('Mar 8 9am', { saidAt: '2026-03-05T05:00:00.000Z', tz: IST })?.dueAt).toBe('2026-03-08T03:30:00.000Z')
    expect(parseDeadline('Nov 2 9am', { saidAt: '2026-10-28T05:00:00.000Z', tz: IST })?.dueAt).toBe('2026-11-02T03:30:00.000Z')
  })
})

describe('isOverdue and deadlineState', () => {
  const firm: Deadline = { dueAt: '2026-10-16T12:30:00.000Z', certainty: 'firm', phrase: 'Friday 6pm', interpretedTz: IST }
  const tentative: Deadline = { ...firm, certainty: 'tentative', phrase: 'maybe Friday 6pm' }

  it('is not overdue exactly at the due instant', () => {
    expect(isOverdue(firm, 'open', '2026-10-16T12:30:00.000Z')).toBe(false)
    expect(isOverdue(firm, 'open', '2026-10-16T12:30:00.001Z')).toBe(true)
  })

  it('is never overdue for done, cancelled or deferred work', () => {
    for (const status of ['done', 'cancelled', 'deferred'] as const) {
      expect(isOverdue(firm, status, '2026-10-20T00:00:00.000Z')).toBe(false)
    }
  })

  it('never treats a tentative deadline as overdue', () => {
    expect(isOverdue(tentative, 'open', '2026-10-20T00:00:00.000Z')).toBe(false)
    expect(deadlineState(tentative, '2026-10-20T00:00:00.000Z')).toBe('tentative_passed')
    expect(deadlineState(tentative, '2026-10-15T00:00:00.000Z')).toBe('tentative_upcoming')
  })

  it('reports state for firm and missing deadlines', () => {
    expect(deadlineState(firm, '2026-10-15T00:00:00.000Z')).toBe('upcoming')
    expect(deadlineState(firm, '2026-10-17T00:00:00.000Z')).toBe('overdue')
    expect(deadlineState({ dueAt: null, certainty: 'none', phrase: '', interpretedTz: IST }, '2026-10-17T00:00:00.000Z')).toBe('none')
  })
})

describe('formatting', () => {
  it('shows the owner local time', () => {
    const s = formatDeadline('2026-10-16T12:30:00.000Z', IST)
    expect(s).toContain('16 Oct 2026')
    expect(s).toContain('18:00')
  })

  it('shows owner and viewer time side by side', () => {
    const r = formatDeadlineDual('2026-10-16T12:30:00.000Z', IST, PT)
    expect(r.owner).toContain('18:00')
    expect(r.viewer).toContain('05:30')
    expect(r.sameZone).toBe(false)
  })
})
