import { describe, expect, it } from 'vitest'
import { makeConfig, runEngine } from '../src/engine'
import { deadlineState } from '../src/engine/deadline'
import { validateDataset } from '../src/schema/validate'
import { explainCommitment } from '../src/components/domain/explain'
import { replayAt, replayPoints } from '../src/components/domain/timeTravel'
import demo from '../src/mocks/demoDataset.json'

const dataset = validateDataset(demo).data!
const now = dataset.referenceTime!
const result = runEngine({ dataset }, makeConfig(now))
const people = new Map(dataset.people.map((p) => [p.id, p]))
const draftFor = (id: string) => result.drafts.find((d) => d.commitmentId === id)

describe('explainCommitment', () => {
  it('gives at least one sentence for every commitment', () => {
    for (const c of result.commitments) expect(explainCommitment(c, draftFor(c.id), people, now, 'UTC').length).toBeGreaterThan(0)
  })

  it('says closed work is never chased', () => {
    const closed = result.commitments.filter((c) => c.status !== 'open')
    expect(closed.length).toBeGreaterThan(0)
    for (const c of closed) expect(explainCommitment(c, draftFor(c.id), people, now, 'UTC').join(' ')).toMatch(/no reminder will ever be drafted/)
  })

  it('says overdue open work is overdue and that silence keeps it open', () => {
    const overdue = result.commitments.filter((c) => c.status === 'open' && deadlineState(c.deadline, now) === 'overdue')
    expect(overdue.length).toBeGreaterThan(0)
    for (const c of overdue) {
      const text = explainCommitment(c, draftFor(c.id), people, now, 'UTC').join(' ')
      expect(text).toMatch(/overdue/)
      if (c.responseState === 'pending') expect(text).toMatch(/Silence never closes work/)
    }
  })

  it('is deterministic for the same input', () => {
    const c = result.commitments[0]
    expect(explainCommitment(c, draftFor(c.id), people, now, 'UTC')).toEqual(explainCommitment(c, draftFor(c.id), people, now, 'UTC'))
  })
})

describe('time travel replay', () => {
  it('lists event moments in order and ends at now', () => {
    for (const c of result.commitments) {
      const pts = replayPoints(c, now)
      expect(pts[pts.length - 1].at <= now).toBe(true)
      for (let i = 1; i < pts.length; i++) expect(pts[i - 1].at < pts[i].at).toBe(true)
    }
  })

  it('does not know a commitment before its source message', () => {
    const c = result.commitments.find((x) => x.source !== 'manual')!
    const msg = dataset.messages.find((m) => m.id === c.sourceMessageId)!
    const before = new Date(Date.parse(msg.sentAt) - 60_000).toISOString()
    expect(replayAt(c.id, before, { dataset }).commitment).toBeUndefined()
    expect(replayAt(c.id, msg.sentAt, { dataset }).commitment?.id).toBe(c.id)
  })

  it('shows closed work as open before it was closed', () => {
    const done = result.commitments.find((c) => c.status === 'done' && c.source !== 'manual')!
    const created = done.events.find((e) => e.type === 'created')!
    expect(replayAt(done.id, created.at, { dataset }).commitment?.status).toBe('open')
    expect(replayAt(done.id, now, { dataset }).commitment?.status).toBe('done')
  })

  it('matches the live run at the current clock', () => {
    for (const c of result.commitments) {
      const frame = replayAt(c.id, now, { dataset })
      expect(frame.commitment?.status).toBe(c.status)
      expect(frame.commitment?.ownerId).toBe(c.ownerId)
    }
  })
})
