import 'fake-indexeddb/auto'
import { describe, expect, it, vi } from 'vitest'
import demo from '../src/mocks/demoDataset.json'
import { AI_MIN_CONFIDENCE, applyAiSignals, makeConfig, runEngine } from '../src/engine'
import { deadlineState } from '../src/engine/deadline'
import type { AiSignal, Message } from '../src/engine/types'
import { validateDataset } from '../src/schema/validate'
import { GEMINI_MODEL, fetchAiSignals } from '../src/ai/gemini'
import { db } from '../src/store/db'
import * as repo from '../src/store/repo'
import { createActions } from '../src/store/actions'

const dataset = validateDataset(demo).data!
const NOW = dataset.referenceTime!
const people = new Map(dataset.people.map((p) => [p.id, p]))
const rules = runEngine({ dataset }, makeConfig(NOW))
const overdue = rules.commitments.find((c) => c.status === 'open' && deadlineState(c.deadline, NOW) === 'overdue' && c.source !== 'manual')!
const done = rules.commitments.find((c) => c.status === 'done' && c.events.some((e) => e.type === 'completed' && e.evidence))!
const doneCloser = [...done.events].reverse().find((e) => e.type === 'completed')!.evidence!.messageId
const aiOn = makeConfig(NOW, { flags: { staleSuppression: true, recipientReview: true, ai: true } })

describe('AI disagreement review', () => {
  it('flags open work the AI thinks is finished, without closing it or chasing it', () => {
    const signals: AiSignal[] = [{ messageId: overdue.sourceMessageId, kind: 'completion', confidence: 0.9 }]
    const r = runEngine({ dataset, aiSignals: signals }, aiOn)
    const c = r.commitments.find((x) => x.id === overdue.id)!
    expect(c.status).toBe('open')
    expect(c.reviewReasons).toContain('ai_disagreement')
    expect(c.events.some((e) => e.type === 'review_flagged' && e.evidence?.rule === 'ai_disagreement')).toBe(true)
    const draft = r.drafts.find((d) => d.commitmentId === c.id)
    expect(draft?.state === 'pending_review' && draft.kind === 'reminder').toBe(false)
  })

  it('ignores readings below the confidence floor', () => {
    const signals: AiSignal[] = [{ messageId: overdue.sourceMessageId, kind: 'completion', confidence: AI_MIN_CONFIDENCE - 0.01 }]
    expect(applyAiSignals(rules.commitments, signals, dataset)).toBe(rules.commitments)
  })

  it('flags closed work only when the AI reads the closing message differently', () => {
    const disagree = applyAiSignals(rules.commitments, [{ messageId: doneCloser, kind: 'other', confidence: 0.95 }], dataset)
    const agree = applyAiSignals(rules.commitments, [{ messageId: doneCloser, kind: 'completion', confidence: 0.95 }], dataset)
    expect(disagree.find((c) => c.id === done.id)!.reviewReasons).toContain('ai_disagreement')
    expect(disagree.find((c) => c.id === done.id)!.status).toBe('done')
    expect(agree.find((c) => c.id === done.id)!.reviewReasons).not.toContain('ai_disagreement')
  })

  it('labels the run honestly', () => {
    const signals: AiSignal[] = [{ messageId: overdue.sourceMessageId, kind: 'completion', confidence: 0.9 }]
    const off = runEngine({ dataset, aiSignals: signals }, makeConfig(NOW))
    expect(off.mode).toBe('Rules')
    expect(off.commitments.find((c) => c.id === overdue.id)!.reviewReasons).not.toContain('ai_disagreement')
    expect(runEngine({ dataset }, aiOn).mode).toBe('Rules (fallback)')
    expect(runEngine({ dataset, aiSignals: [] }, aiOn).mode).toBe('AI assisted')
  })

  it('is deterministic for the same signals', () => {
    const signals: AiSignal[] = [{ messageId: overdue.sourceMessageId, kind: 'cancellation', confidence: 0.8 }]
    expect(runEngine({ dataset, aiSignals: signals }, aiOn)).toEqual(runEngine({ dataset, aiSignals: signals }, aiOn))
  })
})

function geminiReply(payload: unknown, init: { status?: number } = {}) {
  const body = { candidates: [{ content: { parts: [{ text: typeof payload === 'string' ? payload : JSON.stringify(payload) }] } }] }
  return new Response(JSON.stringify(body), { status: init.status ?? 200, headers: { 'Content-Type': 'application/json' } })
}

describe('Gemini pre-pass client', () => {
  const msgs = dataset.messages.slice(0, 3)

  it('sends the key in a header, asks for JSON and keeps only known message ids', async () => {
    const fetchImpl = vi.fn(async () =>
      geminiReply({
        signals: [
          { messageId: msgs[0].id, kind: 'commitment', confidence: 1.4 },
          { messageId: 'made_up', kind: 'completion', confidence: 0.9 },
        ],
      }),
    )
    const r = await fetchAiSignals(msgs, people, { apiKey: ' secret-key ', fetchImpl })
    expect(r).toEqual({ ok: true, model: GEMINI_MODEL, signals: [{ messageId: msgs[0].id, kind: 'commitment', confidence: 1 }] })
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`)
    expect(url).not.toContain('secret')
    expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe('secret-key')
    expect(JSON.parse(init.body as string).generationConfig.responseMimeType).toBe('application/json')
  })

  it('batches long conversations', async () => {
    const many: Message[] = Array.from({ length: 85 }, (_, i) => ({ ...msgs[0], id: `m_x${i}` }))
    const fetchImpl = vi.fn(async () => geminiReply({ signals: [] }))
    await fetchAiSignals(many, people, { apiKey: 'k', fetchImpl })
    expect(fetchImpl).toHaveBeenCalledTimes(3)
  })

  it('falls back with a reason instead of throwing', async () => {
    const cases: [() => Promise<Response>, RegExp][] = [
      [async () => new Response('{}', { status: 403 }), /refused.*403.*key/],
      [async () => new Response('{}', { status: 503 }), /HTTP 503/],
      [async () => geminiReply('not json'), /not valid JSON/],
      [async () => geminiReply({ signals: [{ messageId: msgs[0].id, kind: 'maybe', confidence: 1 }] }), /expected format/],
      [async () => new Response(JSON.stringify({ promptFeedback: { blockReason: 'SAFETY' } })), /blocked.*SAFETY/],
      [async () => Promise.reject(new TypeError('Failed to fetch')), /Network error/],
    ]
    for (const [impl, reason] of cases) {
      const r = await fetchAiSignals(msgs, people, { apiKey: 'k', fetchImpl: vi.fn(impl) })
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.reason).toMatch(reason)
    }
  })

  it('does not call out without a key', async () => {
    const fetchImpl = vi.fn()
    expect(await fetchAiSignals(msgs, people, { apiKey: '  ', fetchImpl })).toEqual({ ok: false, reason: 'No API key saved' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})

describe('AI key stays local', () => {
  it('is never written to the audit log or a backup, and only a coordinator can set it', async () => {
    await db.delete()
    await db.open()
    await repo.loadDataset('setup', 'Synthetic demo', 'demo', validateDataset(demo))
    const coordinator = dataset.people.find((p) => p.role === 'coordinator')!
    const member = dataset.people.find((p) => p.role !== 'coordinator')!
    const asMember = createActions({ user: member } as never)
    expect((await asMember.updateSettings({ aiApiKey: 'nope' })).ok).toBe(false)

    await repo.updateSettings(coordinator.id, { aiApiKey: 'AIza-very-secret' })
    expect((await repo.getSettings()).aiApiKey).toBe('AIza-very-secret')
    const audit = await db.audit.toArray()
    expect(JSON.stringify(audit)).not.toContain('AIza-very-secret')
    expect(audit.at(-1)!.after).toEqual({ aiApiKey: '[set]' })

    const backup = await repo.exportBackup(coordinator.id)
    expect(backup).not.toContain('AIza-very-secret')
    expect(JSON.parse(backup).settings).not.toHaveProperty('aiApiKey')
  })
})
