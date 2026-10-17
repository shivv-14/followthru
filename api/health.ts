import type { VercelRequest, VercelResponse } from '@vercel/node'
import { handleHealth } from './_lib/handlers'

export default function handler(req: VercelRequest, res: VercelResponse) {
  const out = handleHealth(req)
  for (const [k, v] of Object.entries(out.headers ?? {})) res.setHeader(k, v)
  res.status(out.status).json(out.body)
}
