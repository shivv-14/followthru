import { describe, expect, expectTypeOf, it } from 'vitest'
import * as engine from '../src/engine'
import * as schema from '../src/schema'
import type { Commitment, Deadline, Draft, EngineModeLabel, EngineResult, ValidationResult } from '../src/engine'

// Guards the public surface Track B builds against. A failure here means a
// contract change that must be announced in docs/track-a-status.md.
describe('published contract', () => {
  it('exposes the engine functions', () => {
    expect(Object.keys(engine).sort()).toEqual(
      [
        'DATE_ONLY_TIME',
        'END_OF_DAY_TIME',
        'addDays',
        'deadlineState',
        'formatDeadline',
        'formatDeadlineDual',
        'isHedged',
        'isOverdue',
        'isValidTimeZone',
        'offsetMs',
        'parseDeadline',
        'parseIsoWithOffset',
        'toWallTime',
        'wallTimeToUtc',
        'wallTimeToUtcMs',
      ].sort(),
    )
  })

  it('exposes validation and import export', () => {
    for (const name of ['validateDataset', 'validateDatasetJson', 'messagesFromCsv', 'messagesToCsv', 'commitmentsToCsv', 'draftsToCsv', 'resultsToJson']) {
      expect(typeof (schema as Record<string, unknown>)[name]).toBe('function')
    }
  })

  it('keeps key type shapes', () => {
    expectTypeOf<Commitment['status']>().toEqualTypeOf<'open' | 'done' | 'cancelled' | 'deferred'>()
    expectTypeOf<Deadline['certainty']>().toEqualTypeOf<'firm' | 'tentative' | 'none'>()
    expectTypeOf<Draft['state']>().toEqualTypeOf<'pending_review' | 'approved' | 'suppressed' | 'stale'>()
    expectTypeOf<EngineModeLabel>().toEqualTypeOf<'Rules' | 'Rules (fallback)' | 'AI assisted'>()
    expectTypeOf<EngineResult['drafts']>().toEqualTypeOf<Draft[]>()
    expectTypeOf<ValidationResult['ok']>().toEqualTypeOf<boolean>()
  })
})
