import type { VercelRequest, VercelResponse } from '@vercel/node'
import { handleEvidence, handleHealth, handleProcess } from './handlers'
import { send } from './send'
import { routeCloud } from './cloud/router'

/**
 * Every Vercel function, bundled by scripts/build-api.mjs into api/_dist/entries.mjs. Bundling
 * matters: Vercel runs functions as Node ES modules, which cannot resolve the extensionless
 * imports used across src/ and api/_lib/.
 */
export const health = (req: VercelRequest, res: VercelResponse) => send('/api/health', handleHealth, req, res)
export const process = (req: VercelRequest, res: VercelResponse) => send('/api/process', handleProcess, req, res)
export const evidence = (req: VercelRequest, res: VercelResponse) => send('/api/evidence', (r) => handleEvidence(r), req, res)

/** /api/cloud/<route>: vercel.json rewrites the path into ?route=. */
export async function cloud(req: VercelRequest, res: VercelResponse) {
  const raw = req.query.route
  const route = (Array.isArray(raw) ? raw.join('/') : raw) ?? ''
  const out = await routeCloud(route, { method: req.method, url: req.url, headers: req.headers, body: req.body, query: req.query })
  for (const [k, v] of Object.entries(out.headers ?? {})) res.setHeader(k, v)
  if (out.status === 302) res.status(302).end()
  else res.status(out.status).json(out.body)
}
