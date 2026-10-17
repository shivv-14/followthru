import type { VercelRequest, VercelResponse } from '@vercel/node'
import { handleProcess } from './_lib/handlers'

export const config = { api: { bodyParser: { sizeLimit: '2mb' } } }

export default function handler(req: VercelRequest, res: VercelResponse) {
  const started = Date.now()
  const out = handleProcess(req)
  for (const [k, v] of Object.entries(out.headers ?? {})) res.setHeader(k, v)
  // Log only status and timing, never message text
  console.info(JSON.stringify({ route: '/api/process', status: out.status, ms: Date.now() - started }))
  res.status(out.status).json(out.body)
}
