import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { validateDataset, validateDatasetJson } from '../src/schema/validate'

const read = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')
const valid = () => JSON.parse(read('sample-valid.json'))
const codes = (r: ReturnType<typeof validateDataset>) => r.issues.map((i) => `${i.code}@${i.path.join('.')}`).sort()

describe('validateDataset with a valid sample', () => {
  it('accepts it with zero issues', () => {
    const r = validateDataset(valid())
    expect(r.issues).toEqual([])
    expect(r.ok).toBe(true)
  })

  it('normalises timestamps to UTC and sorts messages by time then id', () => {
    const r = validateDataset(valid())
    expect(r.data!.referenceTime).toBe('2026-10-17T06:30:00.000Z')
    expect(r.data!.messages.map((m) => [m.id, m.sentAt])).toEqual([
      ['m_1', '2026-10-14T05:00:00.000Z'],
      ['m_2', '2026-10-14T05:05:00.000Z'],
      ['m_3', '2026-10-14T05:30:00.000Z'],
      ['m_4', '2026-10-16T16:00:00.000Z'],
    ])
  })

  it('breaks timestamp ties by id so order is stable', () => {
    const input = valid()
    input.messages[3].sentAt = '2026-10-14T10:30:00+05:30'
    input.messages[3].id = 'm_0'
    const r = validateDataset(input)
    expect(r.data!.messages.slice(0, 2).map((m) => m.id)).toEqual(['m_0', 'm_1'])
  })

  it('adds threads only seen on messages and fills participants from authors', () => {
    const input = valid()
    delete input.threads
    const r = validateDataset(input)
    const launch = r.data!.threads.find((t) => t.id === 't_launch')!
    expect(launch.participantIds).toEqual(['p_asha', 'p_ben', 'p_chen'])
    expect(r.data!.threads.map((t) => t.id)).toEqual(['t_launch', 't_status'])
  })

  it('treats missing labels as an empty list', () => {
    const input = valid()
    delete input.labels
    expect(validateDataset(input).data!.labels).toEqual([])
  })
})

describe('validateDataset with broken input', () => {
  it('returns stable codes and paths for every problem in the broken sample', () => {
    const r = validateDataset(JSON.parse(read('sample-invalid.json')))
    expect(r.ok).toBe(false)
    expect(r.data).toBeUndefined()
    expect(codes(r)).toEqual(
      [
        'duplicate_id@people.1.id',
        'unknown_timezone@people.1.timezone',
        'invalid_timestamp@referenceTime',
        'duplicate_id@messages.1.id',
        'invalid_timestamp@messages.0.sentAt',
        'unknown_author@messages.1.authorId',
        'unknown_thread@messages.1.threadId',
        'unknown_reply_target@messages.1.replyToId',
        'unknown_mention@messages.1.mentionIds.0',
        'empty_text@messages.1.text',
        'label_unknown_message@labels.0.sourceMessageId',
        'label_unknown_owner@labels.0.ownerId',
        'invalid_timestamp@labels.0.dueAt',
      ].sort(),
    )
  })

  it('reports reference warnings as warnings, not errors', () => {
    const input = valid()
    input.messages[0].authorId = 'p_ghost'
    const r = validateDataset(input)
    expect(r.ok).toBe(true)
    expect(r.issues).toEqual([expect.objectContaining({ code: 'unknown_author', severity: 'warning' })])
  })

  it('reports missing required fields with their path', () => {
    const input = valid()
    delete input.messages[1].sentAt
    delete input.people[0].timezone
    expect(codes(validateDataset(input))).toEqual(['missing_field@messages.1.sentAt', 'missing_field@people.0.timezone'])
  })

  it('reports wrong types and bad enum values', () => {
    const input = valid()
    input.messages[0].text = 42
    input.labels[0].status = 'finished'
    expect(codes(validateDataset(input))).toEqual(['invalid_type@messages.0.text', 'invalid_value@labels.0.status'])
  })

  it('rejects empty ids', () => {
    const input = valid()
    input.messages[0].id = '   '
    expect(codes(validateDataset(input))).toEqual(['invalid_value@messages.0.id'])
  })

  it.each([null, 42, 'text', [], {}])('does not crash on top-level value %j', (value) => {
    const r = validateDataset(value)
    expect(r.ok).toBe(false)
    expect(r.issues.length).toBeGreaterThan(0)
  })

  it('reports invalid JSON text instead of throwing', () => {
    const r = validateDatasetJson('{ "people": [')
    expect(r).toEqual({ ok: false, issues: [expect.objectContaining({ code: 'invalid_json', severity: 'error' })] })
  })

  it('ignores unknown extra fields', () => {
    const input = valid()
    input.messages[0].channel = 'slack'
    expect(validateDataset(input).ok).toBe(true)
  })
})
