import type { VercelRequest, VercelResponse } from '@vercel/node'
import { routeCloud } from './_lib/cloud/router'

export const config = { api: { bodyParser: { sizeLimit: '4mb' } } }

/** Vercel entry for /api/cloud/<route> (vercel.json rewrites the path into ?route=). */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const raw = req.query.route
  const route = (Array.isArray(raw) ? raw.join('/') : raw) ?? ''
  const out = await routeCloud(route, { method: req.method, url: req.url, headers: req.headers, body: req.body, query: req.query })
  for (const [k, v] of Object.entries(out.headers ?? {})) res.setHeader(k, v)
  res.status(out.status).json(out.body)
}
