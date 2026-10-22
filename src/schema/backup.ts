import * as z from 'zod'
import type { ValidationIssue } from '../engine/types'
import { issue, validateDataset } from './validate'

// Full local backup: data, decisions, tasks, drafts, flows, settings, runs,
// audit and evidence file metadata (never the file contents).

const id = z.string().min(1)
const iso = z.string().min(1)
const record = z.looseObject({ id })

export const backupSchema = z.object({
  format: z.literal('followthru-backup'),
  version: z.literal(1),
  exportedAt: iso,
  dataset: z.looseObject({
    id: z.literal('current'),
    name: z.string(),
    source: z.enum(['fixture', 'import', 'demo']),
    loadedAt: iso,
    data: z.unknown(),
    issues: z.array(z.unknown()),
  }),
  decisions: z.array(z.looseObject({ id, commitmentId: id, type: id, at: iso, by: id })),
  tasks: z.array(z.looseObject({ id, title: z.string(), ownerId: id, requesterId: id, createdAt: iso })),
  drafts: z.array(z.looseObject({ id, commitmentId: id, idempotencyKey: id, state: id, version: z.number().int().positive(), history: z.array(z.unknown()) })),
  flows: z.array(z.looseObject({ id, name: z.string(), steps: z.array(z.unknown()) })),
  settings: z.looseObject({}),
  runs: z.array(record),
  audit: z.array(z.looseObject({ id, at: iso, actorId: z.string(), action: z.string() })),
  evidenceFiles: z.array(z.looseObject({ id, name: z.string(), sha256: z.string() })),
})

export type BackupFile = z.infer<typeof backupSchema>

export interface BackupValidation {
  ok: boolean
  backup?: BackupFile
  issues: ValidationIssue[]
}

/** Checks a backup file's structure and its dataset. Never throws. */
export function validateBackupJson(text: string): BackupValidation {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return { ok: false, issues: [issue('invalid_json', 'error', [])] }
  }
  const parsed = backupSchema.safeParse(value, { error: (i) => (i.input === undefined ? 'missing_field' : undefined) })
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((i) =>
        issue(i.message === 'missing_field' ? 'missing_field' : i.code === 'invalid_type' ? 'invalid_type' : 'invalid_value', 'error', i.path.map((p) => (typeof p === 'symbol' ? String(p) : p))),
      ),
    }
  }
  const data = validateDataset(parsed.data.dataset.data)
  const issues = data.issues.map((i) => ({ ...i, path: ['dataset', 'data', ...i.path] }))
  return data.ok ? { ok: true, backup: parsed.data, issues } : { ok: false, issues }
}

/** Settings keys that must never leave the device (for example an API key). */
export function isSecretSetting(key: string): boolean {
  return /key|token|secret|password/i.test(key)
}
