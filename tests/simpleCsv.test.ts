import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { makeConfig, runEngine } from '../src/engine'
import type { Dataset } from '../src/engine/types'
import { isSimpleChatCsv, simpleChatCsvToDataset } from '../src/schema/simpleCsv'
import { validateDataset } from '../src/schema/validate'
import demo from '../src/mocks/demoDataset.json'

const file = (name: string) => readFileSync(`public/samples/${name}`, 'utf8')

function summary(data: Dataset, now: string) {
  const r = runEngine({ dataset: data }, makeConfig(now))
  return r.commitments.map((c) => `${c.title}|${c.status}|${data.people.find((p) => p.id === c.ownerId)?.name ?? '-'}`).sort()
}

describe('easy chat CSV', () => {
  it('is recognised and told apart from the id-based messages CSV', () => {
    expect(isSimpleChatCsv(file('template.csv'))).toBe(true)
    expect(isSimpleChatCsv('id,threadId,authorId,sentAt,text\n')).toBe(false)
  })

  it('turns the demo team chat into the same commitments as the JSON dataset', () => {
    const json = validateDataset(demo).data!
    const csv = simpleChatCsvToDataset(file('demo-team-chat-SYNTHETIC.csv'), 'UTC')
    expect(csv.ok).toBe(true)
    expect(csv.data!.people).toHaveLength(json.people.length)
    expect(csv.data!.messages).toHaveLength(json.messages.length)
    // Same owners, statuses and titles at the same evaluation time
    expect(summary(csv.data!, json.referenceTime!)).toEqual(summary(json, json.referenceTime!))
  })

  it('reads the second sample and the template without errors', () => {
    for (const name of ['product-team-chat-SYNTHETIC.csv', 'template.csv']) {
      const r = simpleChatCsvToDataset(file(name), 'Asia/Kolkata')
      expect(r.ok, name).toBe(true)
      expect(runEngine({ dataset: r.data! }, makeConfig(r.data!.messages.at(-1)!.sentAt)).commitments.length, name).toBeGreaterThan(0)
    }
  })

  it('reads times without an offset in the sender\'s timezone', () => {
    const r = simpleChatCsvToDataset('time,from,timezone,message\n2026-10-20 09:00,Asha,Asia/Kolkata,Hello\n2026-10-20 09:00,Ben,America/Los_Angeles,Hi\n', 'UTC')
    expect(r.data!.messages.map((m) => m.sentAt)).toEqual(['2026-10-20T03:30:00.000Z', '2026-10-20T16:00:00.000Z'])
  })

  it('explains missing columns and bad times by row', () => {
    expect(simpleChatCsvToDataset('when,who\n1,2\n', 'UTC').issues.some((i) => /Add a "from" column/.test(i.message))).toBe(true)
    const bad = simpleChatCsvToDataset('time,from,message\nnext tuesday,Asha,Hi\n', 'UTC')
    expect(bad.ok).toBe(false)
    expect(bad.issues[0].message).toMatch(/Row 2/)
  })
})
