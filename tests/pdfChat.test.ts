import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { makeConfig, runEngine } from '../src/engine'
import { chatLinesToRows, pdfLinesToDataset } from '../src/schema/pdfChat'

/** Same line grouping as src/lib/pdfText.ts, using the Node build of pdf.js. */
async function linesOf(file: string): Promise<string[]> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(file)) }).promise
  const out: string[] = []
  for (let n = 1; n <= doc.numPages; n++) {
    const content = await (await doc.getPage(n)).getTextContent()
    const rows = new Map<number, { x: number; s: string }[]>()
    for (const item of content.items as { str?: string; transform: number[] }[]) {
      if (!item.str) continue
      const y = Math.round(item.transform[5])
      rows.set(y, [...(rows.get(y) ?? []), { x: item.transform[4], s: item.str }])
    }
    for (const y of [...rows.keys()].sort((a, b) => b - a)) out.push(rows.get(y)!.sort((a, b) => a.x - b.x).map((r) => r.s).join(' ').replace(/\s+/g, ' ').trim())
  }
  return out
}

describe('chat PDF import', () => {
  it('reads the sample PDF into people, threads and commitments', async () => {
    const lines = await linesOf('public/samples/product-team-chat-SYNTHETIC.pdf')
    const r = pdfLinesToDataset(lines, 'product-team-chat-SYNTHETIC.pdf', 'UTC')
    expect(r.ok, JSON.stringify(r.issues.slice(0, 3))).toBe(true)
    expect(r.data!.messages.length).toBe(JSON.parse(readFileSync('samples/01-valid-dataset-SYNTHETIC.json', 'utf8')).messages.length)
    const out = runEngine({ dataset: r.data! }, makeConfig(r.data!.messages.at(-1)!.sentAt))
    expect(out.commitments.length).toBeGreaterThan(0)
  }, 30_000)

  it('understands WhatsApp-style lines, 12-hour times and wrapped text', () => {
    const rows = chatLinesToRows(['20/10/2026, 9:05 pm - Asha Rao: Can you send the copy', 'by Friday 5pm?', '[21/10/26, 10:00:00] Vikram Das: Will do'], 'Launch')
    expect(rows).toEqual([
      { time: '2026-10-20 21:05', thread: 'Launch', from: 'Asha Rao', timezone: '', message: 'Can you send the copy by Friday 5pm?' },
      { time: '2026-10-21 10:00', thread: 'Launch', from: 'Vikram Das', timezone: '', message: 'Will do' },
    ])
  })

  it('says clearly when a PDF has no readable chat', () => {
    expect(pdfLinesToDataset([], 'scan.pdf', 'UTC').issues[0].message).toMatch(/scanned image/)
    expect(pdfLinesToDataset(['Quarterly report', 'Revenue grew'], 'report.pdf', 'UTC').issues[0].message).toMatch(/No chat messages/)
  })
})
