import Papa from 'papaparse'
import { describe, expect, it } from 'vitest'
import type { Commitment, Draft, EngineResult, Message } from '../src/engine/types'
import { commitmentsToCsv, draftsToCsv, escapeCsvCell, messagesFromCsv, messagesToCsv, resultsToJson, unescapeCsvCell } from '../src/schema/io'

const messages: Message[] = [
  { id: 'm_1', threadId: 't_1', authorId: 'p_a', sentAt: '2026-10-14T05:00:00.000Z', text: 'Send the deck, "v2" please\nthanks', mentionIds: ['p_b', 'p_c'] },
  { id: 'm_2', threadId: 't_1', authorId: 'p_b', sentAt: '2026-10-14T05:05:00.000Z', text: '=HYPERLINK("http://evil")', replyToId: 'm_1' },
  { id: 'm_3', threadId: 't_2', authorId: 'p_c', sentAt: '2026-10-14T05:10:00.000Z', text: '-5 days, +2 people, @team' },
]

const commitment: Commitment = {
  id: 'c_m_1',
  title: '=cmd|calc',
  sourceMessageId: 'm_1',
  requesterId: 'p_a',
  ownerId: 'p_b',
  deadline: { dueAt: '2026-10-16T12:30:00.000Z', certainty: 'firm', phrase: 'Friday 6pm', interpretedTz: 'Asia/Kolkata' },
  status: 'open',
  responseState: 'pending',
  needsReview: false,
  reviewReasons: [],
  threadIds: ['t_1'],
  events: [
    { type: 'created', at: '2026-10-14T05:00:00.000Z', by: 'p_a', evidence: { messageId: 'm_1', threadId: 't_1', at: '2026-10-14T05:00:00.000Z', quote: 'send the deck', rule: 'REQUEST' } },
    { type: 'accepted', at: '2026-10-14T05:05:00.000Z', by: 'p_b', evidence: { messageId: 'm_2', threadId: 't_1', at: '2026-10-14T05:05:00.000Z', quote: 'sure', rule: 'ACCEPT' } },
  ],
}

const draft: Draft = {
  id: 'd_c_m_1',
  idempotencyKey: 'c_m_1',
  commitmentId: 'c_m_1',
  kind: 'reminder',
  recipientId: 'p_b',
  recipientConfirmed: false,
  state: 'suppressed',
  version: 2,
  body: '+1 reminder about the deck',
  createdAt: '2026-10-16T13:00:00.000Z',
  updatedAt: '2026-10-16T14:00:00.000Z',
  suppression: { reason: 'completed', at: '2026-10-16T14:00:00.000Z' },
  history: [],
}

describe('formula injection protection', () => {
  it.each(['=1+1', '+1', '-1', '@SUM(A1)', '\tcmd', '\rcmd'])('escapes %j', (v) => {
    expect(escapeCsvCell(v)).toBe(`'${v}`)
    expect(unescapeCsvCell(escapeCsvCell(v))).toBe(v)
  })

  it('leaves safe text alone', () => {
    expect(escapeCsvCell('Deck sent')).toBe('Deck sent')
    expect(unescapeCsvCell("'quoted on purpose")).toBe("'quoted on purpose")
  })

  it('never writes a raw formula cell into report exports', () => {
    const rows = Papa.parse<string[]>(commitmentsToCsv([commitment])).data
    const drafts = Papa.parse<string[]>(draftsToCsv([draft])).data
    for (const value of [...rows.slice(1).flat(), ...drafts.slice(1).flat()]) {
      expect(value).not.toMatch(/^[=+\-@\t\r]/)
    }
  })
})

describe('message CSV round trip', () => {
  it('reads back exactly what it wrote, including quotes, newlines and escaped formulas', () => {
    const csv = messagesToCsv(messages)
    expect(csv).toContain("'=HYPERLINK")
    const back = messagesFromCsv(csv)
    expect(back.issues).toEqual([])
    expect(back.messages).toEqual(messages)
  })

  it('accepts a UTF-8 byte order mark from spreadsheet exports', () => {
    expect(messagesFromCsv('﻿' + messagesToCsv(messages)).messages).toEqual(messages)
  })

  it('reports missing required columns', () => {
    const r = messagesFromCsv('id,text\nm_1,hello\n')
    expect(r.messages).toEqual([])
    expect(r.issues.map((i) => `${i.code}:${i.path[1]}`)).toEqual([
      'csv_missing_column:threadId',
      'csv_missing_column:authorId',
      'csv_missing_column:sentAt',
    ])
  })

  it('reports malformed rows instead of throwing', () => {
    const r = messagesFromCsv('id,threadId,authorId,sentAt,text\nm_1,t_1,p_a,2026-10-14T05:00:00Z,"unclosed\n')
    expect(r.issues.some((i) => i.code === 'csv_parse_error')).toBe(true)
  })
})

describe('report exports', () => {
  it('writes commitments with evidence message ids', () => {
    const [header, row] = Papa.parse<string[]>(commitmentsToCsv([commitment])).data
    const rec = Object.fromEntries(header.map((h, i) => [h, row[i]]))
    expect(rec).toMatchObject({ id: 'c_m_1', ownerId: 'p_b', status: 'open', dueAt: '2026-10-16T12:30:00.000Z', evidenceMessageIds: 'm_1;m_2', needsReview: 'false' })
  })

  it('writes drafts with version and suppression reason', () => {
    const [header, row] = Papa.parse<string[]>(draftsToCsv([draft])).data
    const rec = Object.fromEntries(header.map((h, i) => [h, row[i]]))
    expect(rec).toMatchObject({ id: 'd_c_m_1', version: '2', state: 'suppressed', suppressionReason: 'completed' })
  })

  it('round-trips results JSON', () => {
    const result: EngineResult = { runAt: '2026-10-17T06:30:00.000Z', mode: 'Rules', commitments: [commitment], drafts: [draft], issues: [] }
    expect(JSON.parse(resultsToJson(result))).toEqual(result)
  })
})
