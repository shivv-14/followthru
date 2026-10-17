import type { VercelRequest, VercelResponse } from '@vercel/node'
import { handleHealth } from './_lib/handlers'
import { send } from './_lib/send'

export default function handler(req: VercelRequest, res: VercelResponse) {
  send('/api/health', handleHealth, req, res)
}
