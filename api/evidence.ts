import type { VercelRequest, VercelResponse } from '@vercel/node'
import { handleEvidence } from './_lib/handlers'
import { send } from './_lib/send'

export default function handler(req: VercelRequest, res: VercelResponse) {
  send('/api/evidence', (r) => handleEvidence(r), req, res)
}
