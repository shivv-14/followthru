import { describe, expect, it, vi } from 'vitest'
import demo from '../src/mocks/demoDataset.json'
import sample from './fixtures/sample-valid.json'
import { handleHealth, handleProcess, MAX_BODY_BYTES } from '../api/_lib/handlers'
import processRoute from '../api/process'

const json = { 'content-type': 'application/json' }

describe('GET /api/health', () => {
  it('reports shadow mode', () => {
    expect(handleHealth({ method: 'GET', headers: {}, body: undefined })).toMatchObject({ status: 200, body: { ok: true, sending: expect.stringContaining('shadow') } })
  })
  it('rejects other methods with 405', () => {
    expect(handleHealth({ method: 'POST', headers: {}, body: undefined })).toMatchObject({ status: 405, headers: { Allow: 'GET' } })
  })
})

describe('POST /api/process', () => {
  it('runs the engine and returns results with a scorecard', () => {
    const out = handleProcess({ method: 'POST', headers: json, body: { dataset: demo } })
    expect(out.status).toBe(200)
    const body = out.body as { result: { commitments: unknown[]; drafts: unknown[]; mode: string }; scorecard: { checks: { name: string }[] } }
    expect(body.result.commitments).toHaveLength(10)
    expect(body.result.drafts).toHaveLength(3)
    expect(body.result.mode).toBe('Rules')
    expect(body.scorecard.checks.map((c) => c.name)).toEqual(['owner_deadline_status', 'zero_wrong_reminders', 'one_action_one_draft'])
  })

  it('accepts a JSON string body and an explicit evaluation time', () => {
    const out = handleProcess({ method: 'POST', headers: json, body: JSON.stringify({ dataset: sample, config: { now: '2026-10-14T06:00:00Z' } }) })
    expect(out.status).toBe(200)
    expect((out.body as { result: { runAt: string } }).result.runAt).toBe('2026-10-14T06:00:00.000Z')
  })

  it('labels the AI flag as rules fallback', () => {
    const out = handleProcess({ method: 'POST', headers: json, body: { dataset: demo, config: { flags: { ai: true } } } })
    expect((out.body as { result: { mode: string } }).result.mode).toBe('Rules (fallback)')
  })

  it.each([
    [{ method: 'GET', headers: json, body: {} }, 405, 'method_not_allowed'],
    [{ method: 'POST', headers: { 'content-type': 'text/plain' }, body: 'x' }, 415, 'unsupported_media_type'],
    [{ method: 'POST', headers: { ...json, 'content-length': String(MAX_BODY_BYTES + 1) }, body: {} }, 413, 'payload_too_large'],
    [{ method: 'POST', headers: json, body: '{oops' }, 422, 'invalid_json'],
    [{ method: 'POST', headers: json, body: { people: [] } }, 422, 'missing_dataset'],
    [{ method: 'POST', headers: json, body: { dataset: { people: [], messages: [{ id: 'm1' }] } } }, 422, 'invalid_dataset'],
    [{ method: 'POST', headers: json, body: { dataset: { people: [], messages: [] } } }, 422, 'missing_now'],
  ])('returns a consistent error shape (%#)', (req, status, code) => {
    const out = handleProcess(req)
    expect(out.status).toBe(status)
    expect(out.body).toMatchObject({ error: { code, message: expect.any(String) } })
  })

  it('never logs message text', () => {
    const log = vi.spyOn(console, 'info').mockImplementation(() => {})
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn(), setHeader: vi.fn() }
    processRoute({ method: 'POST', headers: json, body: { dataset: demo } } as never, res as never)
    const logged = log.mock.calls.flat().join(' ')
    expect(logged).not.toContain('pricing deck')
    expect(logged).toContain('"status":200')
    log.mockRestore()
  })
})
