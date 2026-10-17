import type { VercelRequest, VercelResponse } from '@vercel/node'
import { handleProcess } from './_lib/handlers'
import { send } from './_lib/send'

export const config = { api: { bodyParser: { sizeLimit: '2mb' } } }

export default function handler(req: VercelRequest, res: VercelResponse) {
  send('/api/process', handleProcess, req, res)
}
