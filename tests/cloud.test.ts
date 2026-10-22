import { describe, expect, it } from 'vitest'
import { checkFile } from '../api/_lib/cloud/fileCheck'
import { deliverAfter } from '../api/_lib/cloud/notify'
import { canonical, taskStatus } from '../api/_lib/cloud/sync'
import { temporaryPassword } from '../api/_lib/cloud/admin'
import { checkPassword, checkUsername } from '../api/_lib/cloud/defaults'
import { ROUTES } from '../api/_lib/cloud/router'
import { makeConfig, runEngine } from '../src/engine'
import { validateDataset } from '../src/schema/validate'
import demo from '../src/mocks/demoDataset.json'

const quiet = { start: '21:00', end: '09:00' }
const at = (iso: string) => Date.parse(iso)

describe('quiet hours for in-app reminders', () => {
  it('delivers at once during working hours', () => {
    // Wednesday 14:00 in Kolkata
    expect(deliverAfter(at('2026-10-21T08:30:00Z'), 'Asia/Kolkata', quiet, true)).toBe(at('2026-10-21T08:30:00Z'))
  })
  it('holds a late-evening reminder until 09:00 next morning, local time', () => {
    // Wednesday 23:00 in London (BST) -> Thursday 09:00 BST
    expect(new Date(deliverAfter(at('2026-10-21T22:00:00Z'), 'Europe/London', quiet, true)).toISOString()).toBe('2026-10-22T08:00:00.000Z')
  })
  it('holds an early-morning reminder until 09:00 the same day', () => {
    expect(new Date(deliverAfter(at('2026-10-22T01:30:00Z'), 'Asia/Kolkata', quiet, true)).toISOString()).toBe('2026-10-22T03:30:00.000Z')
  })
  it('skips the weekend when asked, to Monday 09:00', () => {
    // Saturday 12:00 in Kolkata -> Monday 09:00 IST
    expect(new Date(deliverAfter(at('2026-10-24T06:30:00Z'), 'Asia/Kolkata', quiet, true)).toISOString()).toBe('2026-10-26T03:30:00.000Z')
    expect(deliverAfter(at('2026-10-24T06:30:00Z'), 'Asia/Kolkata', quiet, false)).toBe(at('2026-10-24T06:30:00Z'))
  })
})

describe('attachment checks', () => {
  const bytes = (s: string) => new TextEncoder().encode(s)
  it('accepts real files of allowed types', () => {
    expect(checkFile('notes.txt', bytes('hello'))).toEqual({ ok: true, mime: 'text/plain' })
    expect(checkFile('data.json', bytes('{"a":1}'))).toEqual({ ok: true, mime: 'application/json' })
    expect(checkFile('scan.pdf', bytes('%PDF-1.7 ...'))).toEqual({ ok: true, mime: 'application/pdf' })
    expect(checkFile('img.png', new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]))).toEqual({ ok: true, mime: 'image/png' })
  })
  it('refuses scripts, SVG, executables and disguised files', () => {
    for (const name of ['evil.svg', 'shell.php', 'setup.exe', 'run.sh', 'noext']) expect(checkFile(name, bytes('x')).ok).toBe(false)
    expect(checkFile('photo.png', bytes('<svg onload="x()"/>')).ok).toBe(false)
    expect(checkFile('report.pdf', bytes('MZ binary')).ok).toBe(false)
    expect(checkFile('data.json', bytes('{not json')).ok).toBe(false)
    expect(checkFile('../escape.txt', bytes('x')).ok).toBe(false)
  })
  it('refuses empty and oversized files', () => {
    expect(checkFile('a.txt', new Uint8Array()).ok).toBe(false)
    expect(checkFile('a.txt', new Uint8Array(10 * 1024 * 1024 + 1)).ok).toBe(false)
  })
})

describe('engine sync helpers', () => {
  it('compares stored JSON regardless of key order', () => {
    expect(canonical({ b: 1, a: { d: [1, { y: 2, x: 1 }], c: undefined } })).toBe(canonical({ a: { d: [1, { x: 1, y: 2 }] }, b: 1 }))
    expect(canonical({ a: 1 })).not.toBe(canonical({ a: 2 }))
  })
  it('derives the stored status from the deadline and progress', () => {
    const data = validateDataset(demo).data!
    const now = data.referenceTime!
    const r = runEngine({ dataset: data }, makeConfig(now))
    const statuses = new Set(r.commitments.map((c) => taskStatus(c, now)))
    expect(statuses.has('overdue')).toBe(true)
    expect(statuses.has('done')).toBe(true)
    for (const c of r.commitments.filter((x) => x.status !== 'open')) expect(taskStatus(c, now)).toBe(c.status)
  })
})

describe('account rules', () => {
  it('makes strong temporary passwords that pass the policy', () => {
    const seen = new Set<string>()
    for (let i = 0; i < 50; i++) {
      const p = temporaryPassword()
      expect(p).toMatch(/[A-Z]/)
      expect(p).toMatch(/[a-z]/)
      expect(p).toMatch(/[0-9]/)
      expect(() => checkPassword(p)).not.toThrow()
      seen.add(p)
    }
    expect(seen.size).toBe(50)
  })
  it('validates usernames and passwords', () => {
    expect(checkUsername('Priya.S')).toBe('priya.s')
    expect(() => checkUsername('a')).toThrow()
    expect(() => checkUsername('bad name')).toThrow()
    expect(() => checkPassword('short1')).toThrow()
    expect(() => checkPassword('nodigitshere')).toThrow()
  })
  it('uses plain lowercase route names', () => {
    expect(Object.keys(ROUTES).sort()).toContain('auth/login')
    expect(Object.keys(ROUTES).every((r) => /^[a-z]+\/[a-z-]+$/.test(r))).toBe(true)
  })
})

describe('stale reminder after approval', () => {
  it('cancels a held in-app reminder when the approved draft becomes suppressed', async () => {
    const { buildSyncOps } = await import('../api/_lib/cloud/sync')
    const data = validateDataset(demo).data!
    const now = data.referenceTime!
    const r = runEngine({ dataset: data }, makeConfig(now))
    const live = r.drafts.find((d) => d.state === 'pending_review')!
    const approvedSnapshot = { ...live, state: 'approved' as const }
    const suppressed = { ...live, state: 'suppressed' as const, suppression: { reason: 'completed' as const, at: now } }
    const input = {
      orgId: 'org-1',
      now,
      tasks: [],
      drafts: [{ id: 'row-1', draft_key: live.id, task_key: live.commitmentId, row_version: 3, version: live.version, state: 'approved', snapshot: approvedSnapshot }],
      profileByPerson: new Map<string, string>(),
    } as never
    const { ops } = buildSyncOps(input, { ...r, commitments: [], drafts: [suppressed] }, null)
    const cancel = ops.find((o) => o.table === 'notifications')
    expect(cancel).toMatchObject({ op: 'update', match: { event_key: `reminder:${live.id}:v${live.version}`, read_at: null } })
    // An approved draft that stays approved never touches notifications
    const { ops: same } = buildSyncOps(input, { ...r, commitments: [], drafts: [approvedSnapshot] }, null)
    expect(same.some((o) => o.table === 'notifications')).toBe(false)
  })
})
