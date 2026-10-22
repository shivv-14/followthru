import type { VercelRequest, VercelResponse } from '@vercel/node'
import { withCors, type ApiRequest, type ApiResponse } from './handlers'

/** Runs a handler with CORS and writes the result. Logs only route, status and timing, never message text. */
export function send(route: string, handler: (req: ApiRequest) => ApiResponse, req: VercelRequest, res: VercelResponse) {
  const started = Date.now()
  const out = withCors(req as ApiRequest, handler)
  for (const [k, v] of Object.entries(out.headers ?? {})) res.setHeader(k, v)
  console.info(JSON.stringify({ route, status: out.status, ms: Date.now() - started }))
  if (out.status === 204) res.status(204).end()
  else if (typeof out.body === 'string') res.status(out.status).send(out.body)
  else res.status(out.status).json(out.body)
}
