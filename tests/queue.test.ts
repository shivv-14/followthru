import { describe, expect, it } from 'vitest'
import demo from '../src/mocks/demoDataset.json'
import { validateDataset } from '../src/schema/validate'
import { checkBeforeApproval, editDraft, isSnoozed, makeConfig, regenerateDraft, rejectDraft, runEngine, snoozeDraft, unsnoozeDraft } from '../src/engine'
import type { Dataset, Draft, EngineResult, Message } from '../src/engine'

const data = validateDataset(demo).data!
const NOW = data.referenceTime!
const HOUR = 3_600_000
const at = (hours: number) => new Date(Date.parse(NOW) + hours * HOUR).toISOString()
const people = new Map(data.people.map((p) => [p.id, p]))

function run(dataset: Dataset = data, previous?: Draft[], now = NOW): EngineResult {
  return runEngine({ dataset, previousDrafts: previous }, makeConfig(now))
}
const draftOf = (r: EngineResult, id: string) => r.drafts.find((d) => d.commitmentId === id)!
const commitmentOf = (r: EngineResult, id: string) => r.commitments.find((c) => c.id === id)!
const replace = (r: EngineResult, d: Draft) => r.drafts.map((x) => (x.id === d.id ? d : x))
const withMessages = (extra: Message[]): Dataset => validateDataset({ ...demo, messages: [...demo.messages, ...extra] }).data!

describe('snooze', () => {
  const base = run()
  const d = { ...draftOf(base, 'c_m_21'), recipientConfirmed: true }

  it('hides a pending draft until the wake-up time and blocks approval meanwhile', () => {
    const s = snoozeDraft(d, 'p_priya', NOW, at(20), '  owner on leave  ')
    expect(s).toMatchObject({ state: 'pending_review', snoozedUntil: at(20), snoozedBy: 'p_priya', snoozedAt: NOW, snoozeReason: 'owner on leave', version: d.version })
    expect(isSnoozed(s, NOW)).toBe(true)
    const check = checkBeforeApproval(s, commitmentOf(base, 'c_m_21'), makeConfig(NOW), people)
    expect(check.ok).toBe(false)
    expect(check.suppressWith).toBeUndefined()
    expect(check.blockers.map((b) => b.code)).toContain('snoozed')
  })

  it('returns to review on its own once the evaluation clock passes the wake-up time', () => {
    const s = snoozeDraft(d, 'p_priya', NOW, at(20))
    const later = run(data, replace(base, s), at(21))
    const woke = draftOf(later, 'c_m_21')
    expect(woke.state).toBe('pending_review')
    expect(isSnoozed(woke, at(21))).toBe(false)
    expect(checkBeforeApproval(woke, commitmentOf(later, 'c_m_21'), makeConfig(at(21)), people).blockers.map((b) => b.code)).not.toContain('snoozed')
  })

  it('does not count snoozed time toward the stale window', () => {
    // 30 hours would make an untouched draft stale; snoozed for 28 of them it is still fresh
    const s = snoozeDraft(d, 'p_priya', NOW, at(28))
    const later = draftOf(run(data, replace(base, s), at(30)), 'c_m_21')
    expect(later.state).toBe('pending_review')
    expect(draftOf(run(data, base.drafts, at(30)), 'c_m_21').state).toBe('stale')
  })

  it('validates the wake-up time and the draft state', () => {
    expect(() => snoozeDraft(d, 'p_priya', NOW, NOW)).toThrow('after the current evaluation time')
    expect(() => snoozeDraft(d, 'p_priya', NOW, 'Friday')).toThrow('valid wake-up time')
    expect(() => snoozeDraft(d, 'p_priya', NOW, at(31 * 24))).toThrow('at most 30 days')
    expect(() => snoozeDraft(rejectDraft(d, 'p_priya', NOW, 'no'), 'p_priya', NOW, at(5))).toThrow('Only drafts waiting for review')
    expect(() => unsnoozeDraft(d)).toThrow('not snoozed')
  })

  it('unsnooze brings the draft back now without changing its state or version', () => {
    const back = unsnoozeDraft(snoozeDraft(d, 'p_priya', NOW, at(20)))
    expect(back).toMatchObject({ state: 'pending_review', version: d.version, snoozedUntil: undefined, snoozeReason: undefined })
    expect(isSnoozed(back, NOW)).toBe(false)
  })

  it('work finished while snoozed suppresses the draft and the snooze can never revive it', () => {
    const s = snoozeDraft(d, 'p_priya', NOW, at(20))
    const done = withMessages([{ id: 'm_31', threadId: 't_status', authorId: 'p_lena', sentAt: '2026-10-19T07:00:00+01:00', text: 'Launch press kit sent to marketing.' }])
    const after = draftOf(run(done, replace(base, s), at(2)), 'c_m_21')
    expect(after).toMatchObject({ state: 'suppressed', suppression: { reason: 'completed' }, snoozedUntil: undefined })
    // Even a stale copy that still carries the snooze cannot be woken or snoozed back into review
    const tampered = { ...after, snoozedUntil: at(20) }
    expect(() => unsnoozeDraft(tampered)).toThrow('not waiting for review')
    expect(() => snoozeDraft(after, 'p_priya', at(2), at(20))).toThrow('Only drafts waiting for review')
    expect(isSnoozed(tampered, at(2))).toBe(false)
    // After the wake-up time it is still suppressed
    expect(draftOf(run(done, [after], at(30)), 'c_m_21').state).toBe('suppressed')
  })

  it('approval re-validates a snoozed draft: closed work is still suppressed instead of approved', () => {
    const s = snoozeDraft(d, 'p_priya', NOW, at(20))
    const closed = { ...commitmentOf(base, 'c_m_21'), status: 'done' as const }
    expect(checkBeforeApproval(s, closed, makeConfig(NOW), people)).toMatchObject({ ok: false, suppressWith: 'completed' })
  })

  it('keeps the snooze across a flow step that only follows elapsed time, but drops it on a real change', () => {
    const r18 = draftOf(base, 'c_m_18')
    const s = snoozeDraft(r18, 'p_priya', NOW, at(72))
    const later = draftOf(run(data, replace(base, s), '2026-10-20T11:00:00+05:30'), 'c_m_18')
    expect(later).toMatchObject({ version: 2, step: 2, snoozedUntil: at(72) })
    const moved = withMessages([{ id: 'm_30', threadId: 't_launch', authorId: 'p_priya', sentAt: '2026-10-19T10:00:00+05:30', text: 'Lena, can we move the launch press kit to Oct 23 instead?', replyToId: 'm_21' }])
    const s21 = snoozeDraft(d, 'p_priya', NOW, at(72))
    const r3 = draftOf(run(moved, replace(base, s21), '2026-10-25T09:00:00.000Z'), 'c_m_21')
    expect(r3.snoozedUntil).toBeUndefined()
  })
})

describe('regenerate', () => {
  const base = run()
  const config = makeConfig(NOW)

  it('rewrites the draft from the current commitment as a new version and clears an edit', () => {
    const edited = editDraft(draftOf(base, 'c_m_18'), 'p_priya', NOW, 'My own words')
    const next = regenerateDraft(edited, commitmentOf(base, 'c_m_18'), config, people)
    expect(next).toMatchObject({ id: edited.id, version: edited.version + 1, state: 'pending_review', editedBody: undefined, body: draftOf(base, 'c_m_18').body })
    expect(next.history.at(-1)).toMatchObject({ version: next.version, cause: 'regenerated' })
    // A later run keeps the regenerated version: one draft, no duplicate, no extra version
    const again = run(data, replace(base, next))
    expect(again.drafts.filter((d) => d.commitmentId === 'c_m_18')).toEqual([next])
  })

  it('returns a rejected draft to review and clears the snooze', () => {
    const rejected = rejectDraft(draftOf(base, 'c_m_21'), 'p_priya', NOW, 'wrong tone')
    expect(regenerateDraft(rejected, commitmentOf(base, 'c_m_21'), config, people)).toMatchObject({ state: 'pending_review', rejectReason: undefined })
    const snoozed = snoozeDraft(draftOf(base, 'c_m_21'), 'p_priya', NOW, at(10))
    expect(regenerateDraft(snoozed, commitmentOf(base, 'c_m_21'), config, people).snoozedUntil).toBeUndefined()
  })

  it('never revives a suppressed or approved draft, and writes nothing when no reminder is needed', () => {
    const d = draftOf(base, 'c_m_21')
    const c = commitmentOf(base, 'c_m_21')
    expect(() => regenerateDraft({ ...d, state: 'suppressed', suppression: { reason: 'completed', at: NOW } }, c, config, people)).toThrow('suppressed draft cannot be regenerated')
    expect(() => regenerateDraft({ ...d, state: 'approved' }, c, config, people)).toThrow('already approved')
    expect(() => regenerateDraft(d, { ...c, status: 'done' }, config, people)).toThrow('No reminder is needed now (completed)')
    expect(() => regenerateDraft(d, undefined, config, people)).toThrow('no longer exists')
  })

  it('resets the recipient confirmation only when the recipient changes', () => {
    const d = { ...draftOf(base, 'c_m_21'), recipientConfirmed: true }
    expect(regenerateDraft(d, commitmentOf(base, 'c_m_21'), config, people).recipientConfirmed).toBe(true)
    expect(regenerateDraft({ ...d, recipientId: 'p_amir' }, commitmentOf(base, 'c_m_21'), config, people).recipientConfirmed).toBe(false)
  })
})
