import { describe, expect, it } from 'vitest'
import demo from '../src/mocks/demoDataset.json'
import sample from './fixtures/sample-valid.json'
import { validateDataset } from '../src/schema/validate'
import {
  approveDraft,
  checkBeforeApproval,
  detectSignals,
  evaluate,
  makeConfig,
  recipientWarnings,
  runEngine,
  stepFor,
  validateFlow,
  DEFAULT_FLOW,
  rulesExtractor,
  composeSubject,
  expectedRecipient,
  draftText,
  editDraft,
  rejectDraft,
  canDecide,
} from '../src/engine'
import type { Dataset, EngineResult, Extractor, HumanDecision, Message } from '../src/engine'

const demoData = validateDataset(demo).data!
const NOW = demoData.referenceTime!

function run(dataset: Dataset = demoData, opts: { now?: string; decisions?: HumanDecision[]; previous?: EngineResult } = {}) {
  return runEngine(
    { dataset, decisions: opts.decisions, previousDrafts: opts.previous?.drafts },
    makeConfig(opts.now ?? NOW),
  )
}
const byId = (r: EngineResult, id: string) => r.commitments.find((c) => c.id === id)!
const draftFor = (r: EngineResult, id: string) => r.drafts.find((d) => d.commitmentId === id)
const withMessages = (extra: Message[]): Dataset => validateDataset({ ...demo, messages: [...demo.messages, ...extra] }).data!

describe('signals', () => {
  it.each([
    ['Deck sent to the client.', 'done'],
    ['Never mind, drop it', 'cancel'],
    ["Let's put this on hold until next quarter", 'defer'],
    ['Can we push the docs to Oct 21?', 'reschedule'],
    ['Handing this over to Lena', 'delegate'],
    ['Sure, will do.', 'accept'],
    ['Ben, can you send the deck?', 'request'],
    ["I'll share the mockups Friday", 'commit'],
  ])('%s → %s', (text, kind) => {
    expect(detectSignals(text).map((s) => s.kind)).toContain(kind)
  })

  it.each(['Not sent yet', 'It will be done by Friday', 'Almost finished', 'Is it done?', 'Should be shipped tomorrow'])('does not read "%s" as done', (text) => {
    expect(detectSignals(text).map((s) => s.kind)).not.toContain('done')
  })
})

describe('history replay on the demo conversations', () => {
  const r = run()

  it('finds every commitment with owner, deadline and status from the whole history', () => {
    const table = r.commitments.map((c) => [c.id, c.ownerId, c.status, c.deadline.dueAt, c.deadline.certainty])
    expect(table).toEqual([
      ['c_m_15', 'p_ben', 'open', '2026-10-22T06:59:00.000Z', 'firm'],
      ['c_m_18', 'p_amir', 'open', '2026-10-16T18:29:00.000Z', 'firm'],
      ['c_m_13', 'p_rahul', 'deferred', '2026-10-14T18:29:00.000Z', 'firm'],
      ['c_m_01', 'p_rahul', 'open', '2026-10-15T11:30:00.000Z', 'firm'],
      ['c_m_03', 'p_ben', 'done', '2026-10-16T12:30:00.000Z', 'firm'],
      ['c_m_05', 'p_dev', 'open', '2026-10-16T18:29:00.000Z', 'tentative'],
      ['c_m_06', 'p_lena', 'open', '2026-10-19T22:59:00.000Z', 'firm'],
      ['c_m_09', 'p_dev', 'cancelled', '2026-10-15T18:29:00.000Z', 'firm'],
      ['c_m_21', 'p_lena', 'open', '2026-10-15T08:30:00.000Z', 'firm'],
      ['c_m_22', 'p_dev', 'done', '2026-10-16T18:29:00.000Z', 'firm'],
    ])
  })

  it('links a completion posted in another thread back to the original', () => {
    const deck = byId(r, 'c_m_03')
    expect(deck.events.at(-1)).toMatchObject({ type: 'completed', evidence: { messageId: 'm_10', threadId: 't_status', rule: 'DONE+LINK_SIMILARITY' } })
    expect(deck.threadIds).toEqual(['t_launch', 't_status'])
  })

  it('moves ownership only when the delegate accepts, and takes their new date in their timezone', () => {
    const c = byId(r, 'c_m_06')
    expect(c.events.map((e) => e.type)).toEqual(['created', 'review_flagged', 'delegated', 'deadline_changed'])
    expect(c.deadline).toMatchObject({ interpretedTz: 'Europe/London', phrase: 'Monday' })
    expect(c.needsReview).toBe(false)
  })

  it('keeps an unaccepted delegation in review and the old owner in place', () => {
    const data = validateDataset({ ...demo, messages: demo.messages.filter((m) => m.id !== 'm_08') }).data!
    const c = byId(run(data), 'c_m_06')
    expect(c.ownerId).toBe('p_amir')
    expect(c.reviewReasons).toEqual(['unaccepted_delegation'])
    expect(draftFor(run(data), 'c_m_06')).toBeUndefined()
  })

  it('marks "maybe Friday" tentative and asks for a firm date instead of chasing', () => {
    const c = byId(r, 'c_m_05')
    expect(c.deadline.phrase).toBe('maybe Friday')
    expect(c.reviewReasons).toEqual(['tentative_deadline'])
    expect(draftFor(r, 'c_m_05')).toMatchObject({ kind: 'clarify', state: 'pending_review' })
  })

  it('sends a completion claim from someone outside the commitment to review, never closing it silently', () => {
    const c = byId(r, 'c_m_01')
    expect(c.status).toBe('open')
    expect(c.reviewReasons).toEqual(['unauthorised_status_claim'])
    expect(draftFor(r, 'c_m_01')).toBeUndefined()
  })

  it('keeps silence as silence: no reply means pending, not done', () => {
    const c = byId(r, 'c_m_21')
    expect(c).toMatchObject({ status: 'open', responseState: 'pending' })
    expect(byId(r, 'c_m_18').responseState).toBe('responded')
  })

  it('reads the deadline in the speaker timezone', () => {
    // "by Friday 6pm" said by Priya (IST) stays 18:00 IST although Ben (Pacific) owns it
    expect(byId(r, 'c_m_03').deadline.dueAt).toBe('2026-10-16T12:30:00.000Z')
    // "push … to Oct 21" said by Ben is end of day Pacific
    expect(byId(r, 'c_m_15').deadline).toMatchObject({ dueAt: '2026-10-22T06:59:00.000Z', interpretedTz: 'America/Los_Angeles' })
  })

  it('is deterministic', () => {
    expect(run()).toEqual(run())
  })
})

describe('draft queue', () => {
  const r = run()

  it('drafts only for open overdue or tentative-passed work, one per commitment', () => {
    expect(r.drafts.map((d) => [d.commitmentId, d.kind, d.step])).toEqual([
      ['c_m_05', 'clarify', 0],
      ['c_m_18', 'reminder', 1],
      ['c_m_21', 'reminder', 2],
    ])
  })

  it('creates zero drafts for completed, cancelled and deferred work', () => {
    for (const id of ['c_m_03', 'c_m_09', 'c_m_13', 'c_m_22']) expect(draftFor(r, id)).toBeUndefined()
  })

  it('re-running with the previous drafts changes nothing', () => {
    expect(run(demoData, { previous: r }).drafts).toEqual(r.drafts)
  })

  it('a later deadline update changes the same draft with a new version, never a duplicate', () => {
    const moved = withMessages([
      { id: 'm_30', threadId: 't_launch', authorId: 'p_priya', sentAt: '2026-10-19T10:00:00+05:30', text: 'Lena, can we move the launch press kit to Oct 23 instead?', replyToId: 'm_21' },
    ])
    const r2 = run(moved, { previous: r })
    const before = draftFor(r, 'c_m_21')!
    const after = r2.drafts.filter((d) => d.commitmentId === 'c_m_21')
    expect(after).toHaveLength(1)
    expect(after[0]).toMatchObject({ id: before.id, version: 2, state: 'suppressed', suppression: { reason: 'not_overdue' } })
    expect(after[0].history.map((h) => h.cause)).toEqual(['created', 'deadline_changed'])
    // When the new date also passes, the same draft comes back as version 3
    const r3 = run(moved, { previous: r2, now: '2026-10-25T09:00:00.000Z' })
    expect(r3.drafts.filter((d) => d.commitmentId === 'c_m_21')).toEqual([expect.objectContaining({ id: before.id, version: 3, state: 'pending_review' })])
  })

  it('suppresses an existing reminder as soon as the work is reported done (stale message)', () => {
    const doneLater = withMessages([
      { id: 'm_31', threadId: 't_status', authorId: 'p_lena', sentAt: '2026-10-19T07:00:00+01:00', text: 'Launch press kit sent to marketing.' },
    ])
    const after = draftFor(run(doneLater, { previous: r }), 'c_m_21')!
    expect(after).toMatchObject({ state: 'suppressed', suppression: { reason: 'completed', evidence: { messageId: 'm_31' } } })
  })

  it('moves to the next flow step as time passes, as a new version of the same draft', () => {
    const later = run(demoData, { previous: r, now: '2026-10-20T11:00:00+05:30' })
    expect(draftFor(later, 'c_m_18')).toMatchObject({ version: 2, step: 2 })
  })

  it('marks unapproved drafts stale after the stale window', () => {
    const later = run(demoData, { previous: r, now: '2026-10-20T12:00:00+05:30' })
    expect(draftFor(later, 'c_m_21')).toMatchObject({ state: 'stale', suppression: { reason: 'stale' } })
  })
})

describe('approval checks', () => {
  const r = run()
  const config = makeConfig(NOW)

  it('blocks approval until the recipient is confirmed', () => {
    const d = draftFor(r, 'c_m_18')!
    const c = byId(r, 'c_m_18')
    expect(checkBeforeApproval(d, c, config).blockers.map((b) => b.code)).toEqual(['recipient_unconfirmed'])
    const ok = checkBeforeApproval({ ...d, recipientConfirmed: true }, c, config)
    expect(ok.ok).toBe(true)
    expect(approveDraft({ ...d, recipientConfirmed: true }, 'p_priya', NOW)).toMatchObject({ state: 'approved', approvedBy: 'p_priya' })
  })

  it('re-checks freshness: work completed after drafting suppresses instead of approving', () => {
    const d = { ...draftFor(r, 'c_m_18')!, recipientConfirmed: true }
    const c = { ...byId(r, 'c_m_18'), status: 'done' as const }
    expect(checkBeforeApproval(d, c, config)).toMatchObject({ ok: false, suppressWith: 'completed' })
  })

  it('blocks a draft whose deadline or owner changed after it was written', () => {
    const d = { ...draftFor(r, 'c_m_18')!, recipientConfirmed: true }
    const moved = { ...byId(r, 'c_m_18'), deadline: { ...byId(r, 'c_m_18').deadline, dueAt: '2026-10-30T00:00:00.000Z' } }
    expect(checkBeforeApproval(d, moved, config).suppressWith).toBe('stale')
    expect(checkBeforeApproval(d, { ...byId(r, 'c_m_18'), ownerId: 'p_lena' }, config).suppressWith).toBe('stale')
  })

  it('warns about recipients outside working hours or after delegation', () => {
    const d = draftFor(r, 'c_m_21')!
    // 11:00 IST Monday is 06:30 in London
    expect(recipientWarnings(d, byId(r, 'c_m_21'), demoData, NOW)).toEqual([
      'Recipient has not posted in the related threads',
      expect.stringContaining('Outside working hours for Lena (06:30 local)'),
    ])
  })
})

describe('human decisions and permissions', () => {
  const at = '2026-10-19T06:00:00.000Z'

  it('lets a coordinator resolve review and mark work done, which suppresses any draft', () => {
    const first = run(demoData, { decisions: [{ id: 'h1', commitmentId: 'c_m_01', type: 'resolve_review', at, by: 'p_priya' }] })
    expect(draftFor(first, 'c_m_01')).toMatchObject({ kind: 'reminder', state: 'pending_review' })
    const second = run(demoData, {
      previous: first,
      decisions: [
        { id: 'h1', commitmentId: 'c_m_01', type: 'resolve_review', at, by: 'p_priya' },
        { id: 'h2', commitmentId: 'c_m_01', type: 'mark_done', at, by: 'p_priya', note: 'Confirmed with Rahul by phone' },
      ],
    })
    expect(byId(second, 'c_m_01').status).toBe('done')
    expect(draftFor(second, 'c_m_01')).toMatchObject({ state: 'suppressed', suppression: { reason: 'completed' } })
  })

  it('ignores decisions a member is not allowed to make', () => {
    const r = run(demoData, {
      decisions: [
        { id: 'h1', commitmentId: 'c_m_21', type: 'cancel', at, by: 'p_lena' },
        { id: 'h2', commitmentId: 'c_m_21', type: 'reassign', at, by: 'p_dev', ownerId: 'p_dev' },
      ],
    })
    expect(byId(r, 'c_m_21')).toMatchObject({ status: 'open', ownerId: 'p_lena' })
  })

  it('runs the member submit and coordinator approve flow', () => {
    const decisions: HumanDecision[] = [
      { id: 'h1', commitmentId: 'c_m_21', type: 'report_blocker', at, by: 'p_lena', note: 'Waiting on final logo' },
      { id: 'h2', commitmentId: 'c_m_21', type: 'submit_work', at: '2026-10-19T07:00:00.000Z', by: 'p_lena', submissionId: 's1', note: 'Kit attached' },
    ]
    const submitted = byId(run(demoData, { decisions }), 'c_m_21')
    expect(submitted).toMatchObject({ status: 'open', progress: 'submitted', responseState: 'responded' })
    expect(submitted.blockers).toHaveLength(1)
    const approved = byId(run(demoData, { decisions: [...decisions, { id: 'h3', commitmentId: 'c_m_21', type: 'approve_submission', at: '2026-10-19T08:00:00.000Z', by: 'p_priya', submissionId: 's1' }] }), 'c_m_21')
    expect(approved.status).toBe('done')
    expect(approved.submissions?.[0]).toMatchObject({ state: 'approved', decidedBy: 'p_priya' })
  })

  it('a member cannot approve their own submission', () => {
    const decisions: HumanDecision[] = [
      { id: 'h1', commitmentId: 'c_m_21', type: 'submit_work', at, by: 'p_lena', submissionId: 's1' },
      { id: 'h2', commitmentId: 'c_m_21', type: 'approve_submission', at, by: 'p_lena', submissionId: 's1' },
    ]
    expect(byId(run(demoData, { decisions }), 'c_m_21').status).toBe('open')
  })

  it('handles manual tasks assigned by a coordinator', () => {
    const r = runEngine(
      {
        dataset: demoData,
        manualTasks: [{ id: 'task_1', title: 'Prepare demo script', ownerId: 'p_dev', requesterId: 'p_priya', teamId: 'eng', dueAt: '2026-10-18T12:00:00.000Z', createdAt: '2026-10-17T12:00:00.000Z' }],
      },
      makeConfig(NOW),
    )
    expect(byId(r, 'c_task_1')).toMatchObject({ source: 'manual', ownerId: 'p_dev', teamId: 'eng', progress: 'not_started', status: 'open' })
    expect(draftFor(r, 'c_task_1')).toMatchObject({ kind: 'reminder', recipientId: 'p_dev' })
  })
})

describe('flows', () => {
  it('picks the latest step that is due', () => {
    expect(stepFor(DEFAULT_FLOW, 0)).toBe(0)
    expect(stepFor(DEFAULT_FLOW, 30)).toBe(1)
    expect(stepFor(DEFAULT_FLOW, 100)).toBe(2)
    expect(stepFor({ ...DEFAULT_FLOW, steps: [{ afterHours: 4, tone: 'gentle' }] }, 2)).toBe(-1)
  })

  it('validates step order', () => {
    expect(validateFlow({ name: '', steps: [{ afterHours: 5, tone: 'gentle' }, { afterHours: 2, tone: 'firm' }] })).toEqual([
      'Give the flow a name',
      'Step 2: must come after step 1',
    ])
  })

  it('waits for the first step of a team flow before drafting', () => {
    const r = runEngine(
      { dataset: demoData },
      makeConfig(NOW, { flows: [DEFAULT_FLOW, { id: 'f_design', name: 'Design', isDefault: false, appliesTo: 'design', steps: [{ afterHours: 200, tone: 'gentle' }], skipWeekends: false }] }),
    )
    expect(draftFor(r, 'c_m_18')).toBeUndefined()
    expect(draftFor(r, 'c_m_21')).toBeUndefined()
  })
})

describe('evaluation', () => {
  it('scores the synthetic sample against its own labels', () => {
    const data = validateDataset(sample).data!
    const r = runEngine({ dataset: data }, makeConfig(data.referenceTime!))
    const card = evaluate(r.commitments, r.drafts, data.labels, r.runAt)
    expect(card.labelChecks.map((l) => [l.sourceMessageId, l.ownerOk, l.deadlineOk, l.statusOk])).toEqual([
      ['m_1', true, true, true],
      ['m_3', true, false, true],
    ])
    expect(card.checks.map((c) => [c.name, c.pass])).toEqual([
      ['owner_deadline_status', false],
      ['zero_wrong_reminders', true],
      ['one_action_one_draft', true],
    ])
  })

  it('says scoring is unavailable without labels instead of claiming a score', () => {
    const r = run()
    const card = evaluate(r.commitments, r.drafts, [], r.runAt)
    expect(card.checks[0]).toMatchObject({ pass: false, points: 0, detail: expect.stringContaining('No labelled commitments') })
  })

  it('fails the reminder check when a closed commitment still has an active draft', () => {
    const r = run()
    const bad = [...r.drafts, { ...r.drafts[0], id: 'd_x', commitmentId: 'c_m_03', idempotencyKey: 'c_m_03' }]
    expect(evaluate(r.commitments, bad, [], r.runAt).checks[1].pass).toBe(false)
  })
})

describe('progress, not done, blockers and reopen', () => {
  const base = run()
  const reply = (id: string, authorId: string, text: string, sentAt = '2026-10-19T05:00:00.000Z', replyToId = 'm_21'): Message => ({
    id,
    threadId: 't_launch',
    authorId,
    sentAt,
    text,
    replyToId,
  })

  it('records "still working" after the deadline without changing status', () => {
    const r = run(withMessages([reply('m_40', 'p_lena', 'Still working on it, need two more days.')]), { previous: base })
    const c = byId(r, 'c_m_21')
    expect(c).toMatchObject({ status: 'open', responseState: 'responded' })
    expect(c.events.at(-1)).toMatchObject({ type: 'not_done', evidence: { messageId: 'm_40', rule: 'NOT_DONE' } })
    expect(draftFor(r, 'c_m_21')?.state).toBe('pending_review')
  })

  it('adds a blocker from an owner message', () => {
    const c = byId(run(withMessages([reply('m_41', 'p_lena', 'Blocked by the final logo from design.')])), 'c_m_21')
    expect(c.blockers).toEqual([expect.objectContaining({ by: 'p_lena', resolved: false })])
    expect(c.events.map((e) => e.type)).toContain('blocker')
  })

  it('treats "almost done" as progress, never completion', () => {
    const c = byId(run(withMessages([reply('m_42', 'p_lena', 'Almost done with the launch press kit.')])), 'c_m_21')
    expect(c.status).toBe('open')
    expect(c.events.at(-1)?.type).toBe('progress')
  })

  it('reopens retracted work and reactivates the same draft with a new version', () => {
    const doneMsg = { id: 'm_43', threadId: 't_status', authorId: 'p_lena', sentAt: '2026-10-19T04:00:00.000Z', text: 'Launch press kit sent to marketing.' }
    const afterDone = run(withMessages([doneMsg]), { previous: base })
    expect(draftFor(afterDone, 'c_m_21')).toMatchObject({ state: 'suppressed', version: 1 })
    const reopened = run(withMessages([doneMsg, reply('m_44', 'p_priya', 'That was the wrong file, please redo the launch press kit.', '2026-10-19T05:10:00.000Z')]), {
      previous: afterDone,
    })
    expect(byId(reopened, 'c_m_21').status).toBe('open')
    expect(draftFor(reopened, 'c_m_21')).toMatchObject({ id: 'd_c_m_21', version: 2, state: 'pending_review' })
    expect(draftFor(reopened, 'c_m_21')?.history.at(-1)?.cause).toBe('reactivated')
    expect(reopened.drafts.filter((d) => d.commitmentId === 'c_m_21')).toHaveLength(1)
  })

  it('sends a reopen claim from an unrelated person to review', () => {
    const doneMsg = { id: 'm_45', threadId: 't_status', authorId: 'p_lena', sentAt: '2026-10-19T04:00:00.000Z', text: 'Launch press kit sent to marketing.' }
    const claim = { id: 'm_46', threadId: 't_eng', authorId: 'p_dev', sentAt: '2026-10-19T05:10:00.000Z', text: 'The launch press kit is still broken.' }
    const c = byId(run(withMessages([doneMsg, claim])), 'c_m_21')
    expect(c.status).toBe('done')
    expect(c.reviewReasons).toContain('conflicting_evidence')
  })

  it('uses an injected extractor', () => {
    const silent: Extractor = { name: 'rules', detect: () => [] }
    expect(runEngine({ dataset: demoData }, makeConfig(NOW), silent).commitments).toEqual([])
    expect(rulesExtractor.detect('Deck sent to the client.').map((s) => s.kind)).toContain('done')
  })
})

describe('draft wording, subjects and escalation', () => {
  const base = run()

  it('words a reminder differently for no reply and for "not yet"', () => {
    const pending = draftFor(base, 'c_m_21')!
    expect(pending).toMatchObject({ replyState: 'pending', subject: 'Overdue: Send the launch press kit to marketing'.replace('Overdue', 'Quick check') })
    expect(pending.body).toContain("I haven't heard back yet")
    const notYet = run(
      withMessages([{ id: 'm_50', threadId: 't_launch', authorId: 'p_lena', sentAt: '2026-10-19T05:00:00.000Z', text: 'Not yet, still working on the final version.', replyToId: 'm_21' }]),
      { previous: base },
    )
    const d = draftFor(notYet, 'c_m_21')!
    expect(d).toMatchObject({ id: pending.id, version: 2, replyState: 'not_done', subject: 'New date for: Send the launch press kit to marketing' })
    expect(d.body).toContain('realistic new date')
    expect(d.history.at(-1)?.cause).toBe('reply_changed')
  })

  it('keeps subjects under 60 characters and bodies under 70 words', () => {
    for (const d of base.drafts) {
      expect(d.subject!.length).toBeLessThan(60)
      expect(d.body.split(/\s+/).length).toBeLessThan(70)
    }
    const long = { ...byId(base, 'c_m_21'), title: 'A very long task title that keeps going well past any sensible subject length limit' }
    expect(composeSubject(long, 'reminder', 'owner', 'pending').length).toBeLessThan(60)
  })

  it('writes the deadline in the recipient timezone', () => {
    // Lena is in London: 14:00 IST on 15 Oct is 09:30 BST
    expect(draftFor(base, 'c_m_21')!.body).toContain('09:30')
  })

  it('escalates to the coordinator as a new version of the same draft, approvable after confirmation', () => {
    const flows = [{ id: 'f_esc', name: 'Escalate', isDefault: false, appliesTo: 'all', skipWeekends: false, steps: [{ afterHours: 0, tone: 'gentle' as const }, { afterHours: 24, tone: 'firm' as const, recipient: 'coordinator' as const }] }]
    const early = runEngine({ dataset: demoData }, makeConfig('2026-10-17T04:30:00.000Z', { flows }))
    expect(draftFor(early, 'c_m_18')).toMatchObject({ recipientId: 'p_amir', recipientRole: 'owner', version: 1 })
    const later = runEngine({ dataset: demoData, previousDrafts: early.drafts }, makeConfig(NOW, { flows }))
    const d = draftFor(later, 'c_m_18')!
    expect(d).toMatchObject({ id: 'd_c_m_18', version: 2, recipientId: 'p_priya', recipientRole: 'coordinator', recipientConfirmed: false })
    expect(d.history.at(-1)?.cause).toBe('recipient_changed')
    expect(d.body).toContain('owned by Amir Khan')
    expect(later.drafts.filter((x) => x.commitmentId === 'c_m_18')).toHaveLength(1)
    const people = new Map(demoData.people.map((p) => [p.id, p]))
    const config = makeConfig(NOW, { flows })
    expect(checkBeforeApproval({ ...d, recipientConfirmed: true }, byId(later, 'c_m_18'), config, people).ok).toBe(true)
    expect(checkBeforeApproval({ ...d, recipientConfirmed: true }, byId(later, 'c_m_18'), config).ok).toBe(true)
  })

  it('falls back to the coordinator when a requester step has no requester', () => {
    const c = byId(base, 'c_m_18')
    const people = new Map(demoData.people.map((p) => [p.id, p]))
    expect(c.requesterId).toBeNull()
    expect(expectedRecipient(c, 'requester', people)).toBe('p_priya')
    expect(expectedRecipient(byId(base, 'c_m_21'), 'requester', people)).toBe('p_priya')
    expect(expectedRecipient(c, undefined, people)).toBe('p_amir')
  })

  it('rejects an unknown flow recipient', () => {
    expect(validateFlow({ name: 'x', steps: [{ afterHours: 0, tone: 'gentle', recipient: 'boss' as never }] })).toEqual(['Step 1: unknown recipient'])
  })
})

describe('product change flags', () => {
  const cutoff = '2026-10-16T14:00:00.000Z'
  const early = validateDataset({ ...demo, messages: demo.messages.filter((m) => Date.parse(m.sentAt) <= Date.parse(cutoff)) }).data!

  function simulate(flagsOn: boolean) {
    const flags = { staleSuppression: flagsOn, recipientReview: flagsOn, ai: false }
    const first = runEngine({ dataset: early }, makeConfig(cutoff, { flags }))
    const second = runEngine({ dataset: demoData, previousDrafts: first.drafts }, makeConfig(NOW, { flags }))
    return { first, second, config: makeConfig(NOW, { flags }) }
  }

  it('without stale suppression a draft written before the completion stays pending (the baseline problem)', () => {
    const { first, second, config } = simulate(false)
    expect(draftFor(first, 'c_m_03')).toMatchObject({ state: 'pending_review' })
    expect(byId(second, 'c_m_03').status).toBe('done')
    expect(draftFor(second, 'c_m_03')).toMatchObject({ state: 'pending_review', version: 1 })
    // ...and approval does not catch it
    expect(checkBeforeApproval(draftFor(second, 'c_m_03')!, byId(second, 'c_m_03'), config).ok).toBe(true)
    expect(evaluate(second.commitments, second.drafts, [], NOW).checks[1].pass).toBe(false)
  })

  it('with stale suppression the same draft is suppressed with the completion evidence', () => {
    const { second, config } = simulate(true)
    expect(draftFor(second, 'c_m_03')).toMatchObject({ state: 'suppressed', suppression: { reason: 'completed', evidence: { messageId: 'm_10' } } })
    const confirmed = { ...draftFor(second, 'c_m_03')!, state: 'pending_review' as const, recipientConfirmed: true }
    expect(checkBeforeApproval(confirmed, byId(second, 'c_m_03'), config).suppressWith).toBe('completed')
    expect(evaluate(second.commitments, second.drafts, [], NOW).checks[1].pass).toBe(true)
  })

  it('without recipient review approval does not need a confirmed recipient', () => {
    const flags = { staleSuppression: true, recipientReview: false, ai: false }
    const r = runEngine({ dataset: demoData }, makeConfig(NOW, { flags }))
    expect(checkBeforeApproval(draftFor(r, 'c_m_18')!, byId(r, 'c_m_18'), makeConfig(NOW, { flags })).ok).toBe(true)
  })
})

describe('reject and edit', () => {
  const base = run()
  const at = '2026-10-19T06:00:00.000Z'

  it('keeps a rejected draft rejected across re-runs until a new version is written', () => {
    const rejected = rejectDraft(draftFor(base, 'c_m_21')!, 'p_priya', at, 'Wrong tone')
    const again = run(demoData, { previous: { ...base, drafts: base.drafts.map((d) => (d.id === rejected.id ? rejected : d)) } })
    expect(draftFor(again, 'c_m_21')).toMatchObject({ state: 'rejected', rejectReason: 'Wrong tone', version: 1 })
    const moved = withMessages([{ id: 'm_60', threadId: 't_launch', authorId: 'p_priya', sentAt: '2026-10-19T05:10:00.000Z', text: 'Lena, can we move the launch press kit to Oct 23 instead?', replyToId: 'm_21' }])
    const later = run(moved, { previous: again, now: '2026-10-25T09:00:00.000Z' })
    expect(draftFor(later, 'c_m_21')).toMatchObject({ state: 'pending_review', rejectReason: undefined })
  })

  it('preserves an edit until a new version replaces it, and notes that in history', () => {
    const edited = editDraft(draftFor(base, 'c_m_18')!, 'p_priya', at, '  Hi Amir, any news on the mockups?  ')
    expect(draftText(edited)).toBe('Hi Amir, any news on the mockups?')
    const kept = run(demoData, { previous: { ...base, drafts: base.drafts.map((d) => (d.id === edited.id ? edited : d)) } })
    expect(draftFor(kept, 'c_m_18')?.editedBody).toBe('Hi Amir, any news on the mockups?')
    const next = run(demoData, { previous: kept, now: '2026-10-20T11:00:00+05:30' })
    const d = draftFor(next, 'c_m_18')!
    expect(d.editedBody).toBeUndefined()
    expect(d.history.at(-1)?.cause).toBe('edit replaced by new version (step_changed)')
  })

  it('validates reasons and text length', () => {
    const d = draftFor(base, 'c_m_18')!
    expect(() => rejectDraft(d, 'p_priya', at, '  ')).toThrow('reason')
    expect(() => editDraft(d, 'p_priya', at, '')).toThrow('1 to 600')
    expect(() => editDraft(d, 'p_priya', at, 'x'.repeat(601))).toThrow('1 to 600')
  })

  it('never counts a rejected draft as an active reminder', () => {
    const rejected = rejectDraft(draftFor(base, 'c_m_21')!, 'p_priya', at, 'no')
    const closed = { ...byId(base, 'c_m_21'), status: 'done' as const }
    const commitments = base.commitments.map((c) => (c.id === closed.id ? closed : c))
    expect(evaluate(commitments, [rejected], [], NOW).checks[1].pass).toBe(true)
  })
})

describe('extension requests', () => {
  const base = run()
  const ask: HumanDecision = { id: 'x1', commitmentId: 'c_m_21', type: 'request_extension', at: '2026-10-19T05:00:00.000Z', by: 'p_lena', dueAt: '2026-10-22T12:00:00.000Z', note: 'Waiting on the logo' }

  it('records a request without changing the deadline or stopping reminders', () => {
    const r = run(demoData, { decisions: [ask], previous: base })
    const c = byId(r, 'c_m_21')
    expect(c.extensionRequest).toMatchObject({ state: 'pending', dueAt: '2026-10-22T12:00:00.000Z', by: 'p_lena' })
    expect(c.deadline.dueAt).toBe(byId(base, 'c_m_21').deadline.dueAt)
    expect(c.events.at(-1)?.type).toBe('extension_requested')
    expect(draftFor(r, 'c_m_21')?.state).not.toBe('suppressed')
  })

  it('approving changes the deadline and updates the same draft', () => {
    const approve: HumanDecision = { id: 'x2', commitmentId: 'c_m_21', type: 'change_deadline', at: '2026-10-19T05:10:00.000Z', by: 'p_priya', dueAt: '2026-10-22T12:00:00.000Z' }
    const r = run(demoData, { decisions: [ask, approve], previous: base })
    const c = byId(r, 'c_m_21')
    expect(c).toMatchObject({ deadline: { dueAt: '2026-10-22T12:00:00.000Z' }, extensionRequest: { state: 'approved' } })
    expect(draftFor(r, 'c_m_21')).toMatchObject({ id: 'd_c_m_21', version: 2, state: 'suppressed', suppression: { reason: 'not_overdue' } })
  })

  it('only a coordinator can decline, and only the owner can ask', () => {
    const memberDecline: HumanDecision = { id: 'x3', commitmentId: 'c_m_21', type: 'decline_extension', at: '2026-10-19T05:10:00.000Z', by: 'p_lena' }
    expect(byId(run(demoData, { decisions: [ask, memberDecline] }), 'c_m_21').extensionRequest?.state).toBe('pending')
    const coordDecline = { ...memberDecline, by: 'p_priya' }
    expect(byId(run(demoData, { decisions: [ask, coordDecline] }), 'c_m_21').extensionRequest?.state).toBe('declined')
    const notOwner = { ...ask, by: 'p_dev' }
    expect(byId(run(demoData, { decisions: [notOwner] }), 'c_m_21').extensionRequest).toBeUndefined()
  })

  it('permissions match the roles', () => {
    expect(canDecide('member', 'request_extension', true)).toBe(true)
    expect(canDecide('member', 'request_extension', false)).toBe(false)
    expect(canDecide('member', 'decline_extension', true)).toBe(false)
    expect(canDecide('coordinator', 'decline_extension', false)).toBe(true)
  })
})

describe('decision order', () => {
  it('replays decisions made at the same evaluation time in the order they were recorded', () => {
    const at = '2026-10-19T05:30:00.000Z'
    const ask: HumanDecision = { id: 'h_z', commitmentId: 'c_m_21', type: 'request_extension', at, recordedAt: '2026-10-18T10:00:00.000Z', by: 'p_lena', dueAt: '2026-10-23T06:30:00.000Z', note: 'logo' }
    const approve: HumanDecision = { id: 'h_a', commitmentId: 'c_m_21', type: 'change_deadline', at, recordedAt: '2026-10-18T10:05:00.000Z', by: 'p_priya', dueAt: '2026-10-23T06:30:00.000Z' }
    const c = byId(run(demoData, { decisions: [approve, ask] }), 'c_m_21')
    expect(c.extensionRequest?.state).toBe('approved')
    expect(c.events.slice(-2).map((e) => e.type)).toEqual(['extension_requested', 'deadline_changed'])
  })
})
