import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import demo from '../src/mocks/demoDataset.json'
import { evaluate, makeConfig, runEngine } from '../src/engine'
import { validateDataset } from '../src/schema/validate'
import { db } from '../src/store/db'
import * as repo from '../src/store/repo'
import { createActions } from '../src/store/actions'
import type { EngineState } from '../src/store/EngineProvider'

const validation = validateDataset(demo)
const data = validation.data!
const NOW = data.referenceTime!

async function state(profileId: string | null): Promise<EngineState> {
  const [dataset, decisions, tasks, drafts, flows, settings] = await Promise.all([
    db.datasets.get('current'),
    db.decisions.toArray(),
    db.tasks.toArray(),
    db.drafts.toArray(),
    db.flows.toArray(),
    repo.getSettings(),
  ])
  const config = makeConfig(NOW, { flows })
  const result = runEngine({ dataset: dataset!.data, decisions, manualTasks: tasks, previousDrafts: drafts }, config)
  await repo.syncDrafts(result.drafts)
  const people = new Map(data.people.map((p) => [p.id, p]))
  return {
    ready: true,
    dataset: dataset!,
    settings,
    now: NOW,
    config,
    result,
    scorecard: evaluate(result.commitments, result.drafts, [], NOW),
    user: profileId ? people.get(profileId)! : null,
    people,
    flows,
    decisions,
    tasks,
    commitment: (id) => result.commitments.find((c) => c.id === id),
    draftFor: (id) => result.drafts.find((d) => d.commitmentId === id),
  }
}

beforeEach(async () => {
  await db.delete()
  await db.open()
  await repo.loadDataset('setup', 'Demo', 'demo', validation)
})

describe('repositories', () => {
  it('loads a dataset with default flows and an audit entry', async () => {
    expect((await db.datasets.get('current'))?.data.messages).toHaveLength(23)
    expect((await db.flows.toArray()).map((f) => f.id)).toEqual(['flow_default', 'flow_workweek'])
    expect((await db.audit.toArray()).map((a) => a.action)).toEqual(['data.load'])
  })

  it('refuses a dataset with validation errors', async () => {
    await expect(repo.loadDataset('setup', 'Bad', 'import', { ok: false, issues: [] })).rejects.toThrow('validation errors')
  })

  it('stores drafts once and skips writes when nothing changed', async () => {
    await state('p_priya')
    expect(await db.drafts.count()).toBe(3)
    const again = runEngine({ dataset: data, previousDrafts: await db.drafts.toArray() }, makeConfig(NOW))
    expect(await repo.syncDrafts(again.drafts)).toBe(false)
  })

  it('hashes uploaded evidence files', async () => {
    const file = new File(['hello'], 'proof.txt', { type: 'text/plain' })
    const rec = await repo.addEvidenceFile('p_priya', file, 'c_m_21')
    expect(rec.sha256).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824')
    expect((await db.audit.where('entityId').equals(rec.id).first())?.action).toBe('evidence.upload')
  })

  it('reset clears data but keeps the audit history, including the reset itself', async () => {
    await repo.resetAllData('p_priya')
    expect(await db.datasets.count()).toBe(0)
    expect((await db.audit.toArray()).map((a) => a.action).sort()).toEqual(['data.load', 'data.reset'])
  })
})

describe('actions', () => {
  it('approval needs a confirmed recipient, then approves in shadow mode', async () => {
    const actions = createActions(await state('p_priya'))
    const blocked = await actions.approve('d_c_m_18')
    expect(blocked).toEqual({ ok: false, message: 'Confirm the recipient before approving' })
    await actions.confirmRecipient('d_c_m_18', true)
    const done = await createActions(await state('p_priya')).approve('d_c_m_18')
    expect(done.ok).toBe(true)
    expect(await db.drafts.get('d_c_m_18')).toMatchObject({ state: 'approved', approvedBy: 'p_priya' })
    // Approval survives the next engine run
    expect((await state('p_priya')).draftFor('c_m_18')?.state).toBe('approved')
  })

  it('suppresses with a visible reason when the work was closed before approval', async () => {
    const before = await state('p_priya')
    await createActions(before).confirmRecipient('d_c_m_21', true)
    await createActions(before).decide('c_m_21', 'mark_done', { note: 'Kit already delivered' })
    // Approve with the state the coordinator saw before the decision landed
    const stale = { ...before, commitment: (id: string) => (id === 'c_m_21' ? { ...before.commitment(id)!, status: 'done' as const } : before.commitment(id)) }
    const res = await createActions(stale).approve('d_c_m_21')
    expect(res).toMatchObject({ ok: false, message: expect.stringContaining('Suppressed instead of approved') })
    expect(await db.drafts.get('d_c_m_21')).toMatchObject({ state: 'suppressed', suppression: { reason: 'completed' } })
  })

  it('members cannot approve, assign tasks or cancel', async () => {
    const member = createActions(await state('p_lena'))
    expect((await member.approve('d_c_m_21')).ok).toBe(false)
    expect((await member.createTasks({ title: 'x', ownerIds: ['p_dev'], dueAt: null })).ok).toBe(false)
    expect((await member.decide('c_m_21', 'cancel')).ok).toBe(false)
    expect((await member.decide('c_m_21', 'report_blocker', { note: 'Waiting on logo' })).ok).toBe(true)
    expect((await member.decide('c_m_18', 'report_blocker', { note: 'not mine' })).ok).toBe(false)
  })

  it('assigns a task to a whole team as one task per member', async () => {
    const res = await createActions(await state('p_priya')).createTasks({ title: 'Update the launch FAQ', ownerIds: ['p_amir', 'p_lena'], teamId: 'design', dueAt: '2026-10-21T12:00:00.000Z' })
    expect(res.message).toBe('2 tasks assigned')
    const s = await state('p_priya')
    expect(s.result.commitments.filter((c) => c.source === 'manual').map((c) => c.ownerId).sort()).toEqual(['p_amir', 'p_lena'])
  })

  it('rejects a task deadline in the past', async () => {
    const res = await createActions(await state('p_priya')).createTasks({ title: 'Late', ownerIds: ['p_dev'], dueAt: '2026-10-01T00:00:00.000Z' })
    expect(res.ok).toBe(false)
  })

  it('keeps default flows locked', async () => {
    const actions = createActions(await state('p_priya'))
    const def = (await db.flows.get('flow_default'))!
    expect((await actions.saveFlow(def)).ok).toBe(false)
    expect((await actions.deleteFlow('flow_default')).ok).toBe(false)
    expect((await actions.saveFlow({ ...def, id: 'f_custom', name: 'Fast', isDefault: false, steps: [{ afterHours: 1, tone: 'firm' }] })).ok).toBe(true)
  })
})

describe('reject and edit actions', () => {
  it('lets a coordinator reject with a reason and edit text, both audited', async () => {
    const actions = createActions(await state('p_priya'))
    expect((await actions.reject('d_c_m_21', '  ')).ok).toBe(false)
    expect((await actions.reject('d_c_m_21', 'Wrong recipient tone')).ok).toBe(true)
    expect(await db.drafts.get('d_c_m_21')).toMatchObject({ state: 'rejected', rejectReason: 'Wrong recipient tone' })
    expect((await actions.edit('d_c_m_18', 'Hi Amir, any news?')).ok).toBe(true)
    expect((await db.drafts.get('d_c_m_18'))?.editedBody).toBe('Hi Amir, any news?')
    const actionsLogged = (await db.audit.toArray()).map((a) => a.action)
    expect(actionsLogged).toEqual(expect.arrayContaining(['draft.reject', 'draft.edit']))
  })

  it('does not let a member reject or edit', async () => {
    const member = createActions(await state('p_lena'))
    expect((await member.reject('d_c_m_21', 'no')).ok).toBe(false)
    expect((await member.edit('d_c_m_21', 'text')).ok).toBe(false)
  })
})

describe('extension request actions', () => {
  it('needs a future date and a reason, and is open to the owner only', async () => {
    const lena = createActions(await state('p_lena'))
    expect((await lena.decide('c_m_21', 'request_extension', { dueAt: '2026-10-01T00:00:00.000Z', note: 'x' })).ok).toBe(false)
    expect((await lena.decide('c_m_21', 'request_extension', { dueAt: '2026-10-22T12:00:00.000Z', note: ' ' })).ok).toBe(false)
    expect((await lena.decide('c_m_21', 'request_extension', { dueAt: '2026-10-22T12:00:00.000Z', note: 'Waiting on logo' })).ok).toBe(true)
    expect((await createActions(await state('p_dev')).decide('c_m_21', 'request_extension', { dueAt: '2026-10-22T12:00:00.000Z', note: 'x' })).ok).toBe(false)
    expect((await lena.decide('c_m_21', 'decline_extension')).ok).toBe(false)
  })
})
