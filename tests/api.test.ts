import { describe, expect, it, vi } from 'vitest'
import demo from '../src/mocks/demoDataset.json'
import sample from './fixtures/sample-valid.json'
import { handleEvidence, handleHealth, handleProcess, MAX_BODY_BYTES, withCors } from '../api/_lib/handlers'
import { messagesToCsv } from '../src/schema/io'
import { validateDataset } from '../src/schema/validate'
import { process as processRoute } from '../api/_lib/entries'

const json = { 'content-type': 'application/json' }

describe('GET /api/health', () => {
  it('reports shadow mode', () => {
    expect(handleHealth({ method: 'GET', headers: {}, body: undefined })).toMatchObject({ status: 200, body: { ok: true, sending: expect.stringContaining('shadow') } })
  })
  it('rejects other methods with 405', () => {
    expect(handleHealth({ method: 'POST', headers: {}, body: undefined })).toMatchObject({ status: 405, headers: { Allow: 'GET, OPTIONS' } })
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

describe('CSV input to /api/process', () => {
  const data = validateDataset(demo).data!
  it('builds the dataset from a messages CSV and people', () => {
    const out = handleProcess({ method: 'POST', headers: json, body: { csv: messagesToCsv(data.messages), people: data.people, threads: data.threads, config: { now: data.referenceTime } } })
    expect(out.status).toBe(200)
    expect((out.body as { result: { commitments: unknown[] } }).result.commitments).toHaveLength(10)
  })
  it('rejects a CSV with missing columns', () => {
    const out = handleProcess({ method: 'POST', headers: json, body: { csv: 'id,text' + String.fromCharCode(10) + 'm1,hi', people: data.people } })
    expect(out).toMatchObject({ status: 422, body: { error: { code: 'invalid_csv' } } })
  })
  it('accepts "fixture" as another name for "dataset"', () => {
    expect(handleProcess({ method: 'POST', headers: json, body: { fixture: demo } }).status).toBe(200)
  })
})

describe('GET /api/evidence', () => {
  const get = (url: string) => handleEvidence({ method: 'GET', url, headers: {}, body: undefined })
  it('returns the scorecard as JSON, labelled synthetic without the fixture', () => {
    const out = get('/api/evidence?format=json&kind=scorecard')
    expect(out.status).toBe(200)
    expect(out.headers?.['X-FollowThru-Dataset']).toBe('synthetic-demo')
    expect(out.body).toMatchObject({ dataset: 'synthetic demo (not challenge data)', kind: 'scorecard' })
    expect(out.headers?.['Content-Disposition']).toMatch(/attachment; filename="followthru-scorecard-.+\.json"/)
  })
  it.each(['commitments', 'drafts', 'suppressions'])('returns %s as CSV', (kind) => {
    const out = get(`/api/evidence?format=csv&kind=${kind}`)
    expect(out.status).toBe(200)
    expect(out.headers?.['Content-Type']).toContain('text/csv')
    expect(typeof out.body).toBe('string')
  })
  it.each([
    ['/api/evidence?format=xml', 'bad_format'],
    ['/api/evidence?kind=everything', 'bad_kind'],
    ['/api/evidence?format=csv&kind=scorecard', 'bad_format'],
  ])('rejects %s with 400', (url, code) => {
    expect(get(url)).toMatchObject({ status: 400, body: { error: { code } } })
  })
  it('rejects POST with 405', () => {
    expect(handleEvidence({ method: 'POST', headers: {}, body: {} }).status).toBe(405)
  })
})

describe('CORS', () => {
  it('answers preflight with 204 and adds headers to every response', () => {
    expect(withCors({ method: 'OPTIONS', headers: {}, body: undefined }, handleHealth)).toMatchObject({ status: 204, headers: { 'Access-Control-Allow-Origin': '*' } })
    expect(withCors({ method: 'GET', headers: {}, body: undefined }, handleHealth).headers).toMatchObject({ 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' })
  })
})
