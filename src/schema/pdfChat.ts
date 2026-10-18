import Papa from 'papaparse'
import type { ValidationResult } from '../engine/types'
import { issue } from './validate'
import { simpleChatCsvToDataset } from './simpleCsv'

/**
 * Chat text from a PDF, one message per line, in either of these styles:
 *   2026-10-20 10:00 | Website launch | Asha Rao | Asia/Kolkata | Can you send the copy by Friday?
 *   20/10/2026, 10:00 - Asha Rao: Can you send the copy by Friday?      (WhatsApp export)
 * Lines that match neither are joined to the message above them (wrapped text).
 */
const PIPE = /^(\d{4}-\d{2}-\d{2}[ T]\d{1,2}:\d{2})\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*(?:([A-Za-z_]+\/[A-Za-z_/+-]+|UTC)\s*\|\s*)?(.+)$/
const WHATSAPP = /^\[?(\d{1,2})\/(\d{1,2})\/(\d{2,4}),?\s+(\d{1,2}):(\d{2})(?::\d{2})?\s*([ap]\.?m\.?)?\]?\s*[-–]?\s*([^:]{1,60}):\s*(.+)$/i

const pad = (n: number) => String(n).padStart(2, '0')

export function chatLinesToRows(lines: string[], threadName: string): { time: string; thread: string; from: string; timezone: string; message: string }[] {
  const rows: { time: string; thread: string; from: string; timezone: string; message: string }[] = []
  for (const raw of lines) {
    const line = raw.trim()
    if (!line) continue
    const p = line.match(PIPE)
    if (p) {
      rows.push({ time: p[1].replace('T', ' '), thread: p[2], from: p[3], timezone: p[4] ?? '', message: p[5] })
      continue
    }
    const w = line.match(WHATSAPP)
    if (w) {
      let hour = Number(w[4])
      const ampm = w[6]?.toLowerCase().replace(/\./g, '')
      if (ampm === 'pm' && hour < 12) hour += 12
      if (ampm === 'am' && hour === 12) hour = 0
      const year = w[3].length === 2 ? 2000 + Number(w[3]) : Number(w[3])
      rows.push({ time: `${year}-${pad(Number(w[2]))}-${pad(Number(w[1]))} ${pad(hour)}:${w[5]}`, thread: threadName, from: w[7].trim(), timezone: '', message: w[8] })
      continue
    }
    if (rows.length) rows[rows.length - 1].message += ` ${line}`
  }
  return rows
}

/** Turns extracted PDF text lines into a validated dataset, or explains why the PDF could not be read. */
export function pdfLinesToDataset(lines: string[], fileName: string, defaultTimezone: string): ValidationResult {
  const thread = fileName.replace(/\.pdf$/i, '').replace(/[-_]+/g, ' ').trim() || 'Chat'
  const rows = chatLinesToRows(lines, thread)
  if (rows.length === 0) {
    return {
      ok: false,
      issues: [
        issue(
          'invalid_value',
          'error',
          ['pdf'],
          lines.join('').trim()
            ? 'No chat messages were found. Each line needs a time, a name and a message (see "Make your own file").'
            : 'This PDF has no readable text. It may be a scanned image; export the chat as text or CSV instead.',
        ),
      ],
    }
  }
  const csv = Papa.unparse(rows, { columns: ['time', 'thread', 'from', 'timezone', 'message'], newline: '\n' })
  return simpleChatCsvToDataset(csv, defaultTimezone)
}
