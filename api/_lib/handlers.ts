import { engineConfigInputSchema } from '../../src/schema/input'
import { validateDataset } from '../../src/schema/validate'
import { evaluate, makeConfig, runEngine } from '../../src/engine'
import type { ValidationIssue } from '../../src/engine'

export const MAX_BODY_BYTES = 2 * 1024 * 1024
export const VERSION = '0.1.0'

export interface ApiResponse {
  status: number
  body: unknown
  headers?: Record<string, string>
}

export interface ApiRequest {
  method?: string
  headers: Record<string, string | string[] | undefined>
  body: unknown
}

function error(status: number, code: string, message: string, issues?: ValidationIssue[]): ApiResponse {
  return { status, body: { error: { code, message, ...(issues ? { issues } : {}) } } }
}

function header(req: ApiRequest, name: string): string {
  const v = req.headers[name]
  return (Array.isArray(v) ? v[0] : v) ?? ''
}

export function handleHealth(req: ApiRequest): ApiResponse {
  if (req.method !== 'GET') return { ...error(405, 'method_not_allowed', 'Use GET'), headers: { Allow: 'GET' } }
  return { status: 200, body: { ok: true, service: 'followthru', version: VERSION, sending: 'shadow mode, nothing is sent' } }
}

/**
 * POST { dataset, config? } → engine result and scorecard.
 * config.now defaults to the dataset reference time. Message text is never logged.
 */
export function handleProcess(req: ApiRequest): ApiResponse {
  if (req.method !== 'POST') return { ...error(405, 'method_not_allowed', 'Use POST'), headers: { Allow: 'POST' } }
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
  if (typeof body !== 'object' || body === null || !('dataset' in body)) {
    return error(422, 'missing_dataset', 'Body must be { "dataset": { … }, "config"?: { … } }')
  }
  const { dataset, config } = body as { dataset: unknown; config?: unknown }

  const validation = validateDataset(dataset)
  if (!validation.ok || !validation.data) return error(422, 'invalid_dataset', 'Dataset failed validation', validation.issues)

  const parsedConfig = engineConfigInputSchema.safeParse(config ?? {})
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
