import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { engineConfigInputSchema } from '../../src/schema/input'
import { validateDataset, validateDatasetJson } from '../../src/schema/validate'
import { commitmentsToCsv, draftsToCsv, messagesFromCsv, suppressionsToCsv } from '../../src/schema/io'
import { evaluate, makeConfig, runEngine } from '../../src/engine'
import type { Dataset, ValidationIssue } from '../../src/engine'
import demoDataset from '../../src/mocks/demoDataset.json'

export const MAX_BODY_BYTES = 2 * 1024 * 1024
export const VERSION = '0.1.0'

export interface ApiResponse {
  status: number
  /** Objects are sent as JSON; strings are sent as they are (CSV) */
  body: unknown
  headers?: Record<string, string>
}

export interface ApiRequest {
  method?: string
  url?: string
  headers: Record<string, string | string[] | undefined>
  body: unknown
  query?: Record<string, string | string[] | undefined>
}

export const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

/** Adds CORS headers to every response, and answers preflight requests with 204. */
export function withCors(req: ApiRequest, handler: (req: ApiRequest) => ApiResponse): ApiResponse {
  if (req.method === 'OPTIONS') return { status: 204, body: '', headers: { ...CORS_HEADERS } }
  const out = handler(req)
  return { ...out, headers: { ...CORS_HEADERS, ...out.headers } }
}

function error(status: number, code: string, message: string, issues?: ValidationIssue[]): ApiResponse {
  return { status, body: { error: { code, message, ...(issues ? { issues } : {}) } } }
}

function header(req: ApiRequest, name: string): string {
  const v = req.headers[name]
  return (Array.isArray(v) ? v[0] : v) ?? ''
}

function queryParam(req: ApiRequest, name: string): string | undefined {
  const fromQuery = req.query?.[name]
  if (fromQuery !== undefined) return Array.isArray(fromQuery) ? fromQuery[0] : fromQuery
  if (!req.url) return undefined
  return new URL(req.url, 'http://localhost').searchParams.get(name) ?? undefined
}

export function handleHealth(req: ApiRequest): ApiResponse {
  if (req.method !== 'GET') return { ...error(405, 'method_not_allowed', 'Use GET'), headers: { Allow: 'GET, OPTIONS' } }
  return { status: 200, body: { ok: true, service: 'followthru', version: VERSION, sending: 'shadow mode, nothing is sent' } }
}

/**
 * POST { dataset, config? } or { csv, people, threads?, config? } → engine result and scorecard.
 * "fixture" is accepted as another name for "dataset". config.now defaults to the
 * dataset reference time. Message text is never logged.
 */
export function handleProcess(req: ApiRequest): ApiResponse {
  if (req.method !== 'POST') return { ...error(405, 'method_not_allowed', 'Use POST'), headers: { Allow: 'POST, OPTIONS' } }
  if (!header(req, 'content-type').toLowerCase().startsWith('application/json')) {
    return error(415, 'unsupported_media_type', 'Send application/json')
  }
  const length = Number(header(req, 'content-length') || 0)
  if (length > MAX_BODY_BYTES) return error(413, 'payload_too_large', 'Body must be 2 MB or less')

  let body = req.body
  if (typeof body === 'string') {
    if (body.length > MAX_BODY_BYTES) return error(413, 'payload_too_large', 'Body must be 2 MB or less')
    try {
      body = JSON.parse(body)
    } catch {
      return error(422, 'invalid_json', 'Body is not valid JSON')
    }
  }
  if (typeof body !== 'object' || body === null) return error(422, 'missing_dataset', 'Body must be { "dataset": { … } } or { "csv": "…", "people": [ … ] }')
  const b = body as { dataset?: unknown; fixture?: unknown; csv?: unknown; people?: unknown; threads?: unknown; config?: unknown }

  let input: unknown
  if (b.dataset !== undefined || b.fixture !== undefined) input = b.dataset ?? b.fixture
  else if (typeof b.csv === 'string') {
    const csv = messagesFromCsv(b.csv)
    if (csv.issues.length > 0) return error(422, 'invalid_csv', 'CSV failed validation', csv.issues)
    input = { people: b.people, threads: b.threads, messages: csv.messages }
  } else {
    return error(422, 'missing_dataset', 'Body must be { "dataset": { … } } or { "csv": "…", "people": [ … ] }')
  }

  const validation = validateDataset(input)
  if (!validation.ok || !validation.data) return error(422, 'invalid_dataset', 'Dataset failed validation', validation.issues)

  const parsedConfig = engineConfigInputSchema.safeParse(b.config ?? {})
  if (!parsedConfig.success) return error(422, 'invalid_config', 'config must be { now?, flags?, staleAfterHours? }')
  const now = parsedConfig.data.now ?? validation.data.referenceTime
  if (!now || Number.isNaN(Date.parse(now))) {
    return error(422, 'missing_now', 'Give config.now as an ISO timestamp, or include referenceTime in the dataset')
  }

  const engineConfig = makeConfig(new Date(now).toISOString(), {
    flags: { staleSuppression: true, recipientReview: true, ai: false, ...parsedConfig.data.flags },
    staleAfterHours: parsedConfig.data.staleAfterHours,
  })
  const result = runEngine({ dataset: validation.data }, engineConfig)
  const scorecard = evaluate(result.commitments, result.drafts, validation.data.labels, result.runAt)
  return { status: 200, body: { result: { ...result, issues: validation.issues }, scorecard } }
}

const KINDS = ['commitments', 'drafts', 'suppressions', 'scorecard'] as const
type Kind = (typeof KINDS)[number]

/** The challenge fixture when it is deployed next to the API, otherwise the labelled synthetic demo. */
export function bundledDataset(): { data: Dataset; synthetic: boolean } {
  const path = resolve(process.cwd(), 'data/fixture.json')
  if (existsSync(path)) {
    const v = validateDatasetJson(readFileSync(path, 'utf8'))
    if (v.ok && v.data) return { data: v.data, synthetic: false }
  }
  return { data: validateDataset(demoDataset).data!, synthetic: true }
}

/** GET ?format=json|csv&kind=commitments|drafts|suppressions|scorecard → a timestamped download. */
export function handleEvidence(req: ApiRequest, source = bundledDataset): ApiResponse {
  if (req.method !== 'GET') return { ...error(405, 'method_not_allowed', 'Use GET'), headers: { Allow: 'GET, OPTIONS' } }
  const format = queryParam(req, 'format') ?? 'json'
  const kind = (queryParam(req, 'kind') ?? 'scorecard') as Kind
  if (format !== 'json' && format !== 'csv') return error(400, 'bad_format', 'format must be json or csv')
  if (!KINDS.includes(kind)) return error(400, 'bad_kind', `kind must be one of ${KINDS.join(', ')}`)
  if (format === 'csv' && kind === 'scorecard') return error(400, 'bad_format', 'The scorecard is available as JSON only')

  const { data, synthetic } = source()
  const result = runEngine({ dataset: data }, makeConfig(data.referenceTime ?? data.messages.at(-1)?.sentAt ?? new Date(0).toISOString()))
  const scorecard = evaluate(result.commitments, result.drafts, data.labels, result.runAt)
  const datasetLabel = synthetic ? 'synthetic demo (not challenge data)' : 'challenge fixture'
  const stamp = result.runAt.replace(/[:.]/g, '-')
  const headers: Record<string, string> = {
    'Content-Disposition': `attachment; filename="followthru-${kind}-${stamp}.${format}"`,
    'X-FollowThru-Dataset': synthetic ? 'synthetic-demo' : 'challenge-fixture',
  }
  if (format === 'csv') {
    const csv = kind === 'commitments' ? commitmentsToCsv(result.commitments) : kind === 'drafts' ? draftsToCsv(result.drafts) : suppressionsToCsv(result.drafts)
    return { status: 200, body: csv, headers: { ...headers, 'Content-Type': 'text/csv; charset=utf-8' } }
  }
  const payload = kind === 'scorecard' ? scorecard : kind === 'commitments' ? result.commitments : kind === 'drafts' ? result.drafts : result.drafts.filter((d) => d.suppression)
  return { status: 200, body: { dataset: datasetLabel, evaluatedAt: result.runAt, mode: result.mode, kind, data: payload }, headers }
}
