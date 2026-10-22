/**
 * Writes the downloadable sample files in public/samples/ from the synthetic datasets, in the
 * easy chat CSV format (time, thread, from, timezone, message, role, team). All data is synthetic.
 *   npx tsx scripts/make-samples.ts
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import Papa from 'papaparse'
import { toWallTime } from '../src/engine/time'
import type { Dataset } from '../src/engine/types'
import demo from '../src/mocks/demoDataset.json'

const pad = (n: number) => String(n).padStart(2, '0')

function toSimpleCsv(data: Dataset): string {
  const people = new Map(data.people.map((p) => [p.id, p]))
  const threads = new Map(data.threads.map((t) => [t.id, t.title ?? t.id]))
  const sorted = [...data.messages].sort((a, b) => a.sentAt.localeCompare(b.sentAt))
  // Spreadsheet row of each message (the header is row 1), used by reply_to
  const rowOf = new Map(sorted.map((m, i) => [m.id, i + 2]))
  const rows = sorted.map((m) => {
    const p = people.get(m.authorId)!
    const w = toWallTime(Date.parse(m.sentAt), p.timezone)
    return {
      time: `${w.year}-${pad(w.month)}-${pad(w.day)} ${pad(w.hour)}:${pad(w.minute)}`,
      thread: threads.get(m.threadId),
      from: p.name,
      timezone: p.timezone,
      message: m.text,
      role: p.role ?? 'member',
      team: p.teamId ?? '',
      reply_to: m.replyToId ? rowOf.get(m.replyToId) : '',
    }
  })
  return Papa.unparse(rows, { columns: ['time', 'thread', 'from', 'timezone', 'message', 'role', 'team', 'reply_to'], newline: '\n' }) + '\n'
}

mkdirSync('public/samples', { recursive: true })
const product = JSON.parse(readFileSync('samples/01-valid-dataset-SYNTHETIC.json', 'utf8')) as Dataset
writeFileSync('public/samples/demo-team-chat-SYNTHETIC.csv', toSimpleCsv(demo as unknown as Dataset))
writeFileSync('public/samples/product-team-chat-SYNTHETIC.csv', toSimpleCsv(product))
writeFileSync('public/samples/demo-team-SYNTHETIC.json', JSON.stringify(demo, null, 2) + '\n')
writeFileSync(
  'public/samples/template.csv',
  'time,thread,from,timezone,message,role,team,reply_to\n' +
    '2026-10-20 10:00,Website launch,Asha Rao,Asia/Kolkata,"Vikram, can you send the homepage copy by Friday 5pm?",coordinator,web,\n' +
    '2026-10-20 10:20,Website launch,Vikram Das,Asia/Kolkata,"Sure, I will send it by Friday 5pm.",member,web,2\n',
)
console.log('wrote public/samples')

// A sample chat PDF in the "time | thread | from | timezone | message" line style (synthetic data)
async function samplePdf(data: Dataset, file: string) {
  const { chromium } = await import('@playwright/test')
  const people = new Map(data.people.map((p) => [p.id, p]))
  const threads = new Map(data.threads.map((t) => [t.id, t.title ?? t.id]))
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')
  const lines = [...data.messages]
    .sort((a, b) => a.sentAt.localeCompare(b.sentAt))
    .map((m) => {
      const p = people.get(m.authorId)!
      const w = toWallTime(Date.parse(m.sentAt), p.timezone)
      return `${w.year}-${pad(w.month)}-${pad(w.day)} ${pad(w.hour)}:${pad(w.minute)} | ${threads.get(m.threadId)} | ${p.name} | ${p.timezone} | ${m.text}`
    })
  const html = `<html><body style="font-family:Arial;font-size:10px"><h3>Team chat export (synthetic data)</h3>${lines.map((l) => `<p style="margin:0 0 6px">${esc(l)}</p>`).join('')}</body></html>`
  const browser = await chromium.launch({ channel: 'chrome' })
  const page = await browser.newPage()
  await page.setContent(html)
  await page.pdf({ path: file, format: 'A4', margin: { top: '12mm', bottom: '12mm', left: '10mm', right: '10mm' } })
  await browser.close()
}
await samplePdf(product, 'public/samples/product-team-chat-SYNTHETIC.pdf')
console.log('wrote sample PDF')
