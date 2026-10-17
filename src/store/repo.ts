// Every write goes through here so it is audited. UI code uses store hooks
// and actions, never Dexie directly.
import type { AuditEvent, Draft, Flow, HumanDecision, ManualTask, ValidationResult } from '../engine/types'
import { DEFAULT_FLAGS, DEFAULT_STALE_HOURS } from '../engine/run'
import { DEFAULT_FLOWS } from '../engine/flows'
import { db, type AppSettings, type DataSource, type EvidenceFile, type RunRecord, type StoredDataset } from './db'

export const DEFAULT_SETTINGS: AppSettings = {
  userName: '',
  profileId: null,
  clockMode: 'dataset',
  customNow: null,
  flags: DEFAULT_FLAGS,
  staleAfterHours: DEFAULT_STALE_HOURS,
}

export function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`
}

/** Wall-clock time for audit records. The engine itself never reads the clock. */
export function nowIso(): string {
  return new Date().toISOString()
}

export async function audit(entry: Omit<AuditEvent, 'id' | 'at'>): Promise<void> {
  await db.audit.add({ id: newId('a'), at: nowIso(), ...entry })
}

export async function getSettings(): Promise<AppSettings> {
  const row = await db.settings.get('app')
  return { ...DEFAULT_SETTINGS, ...row?.value, flags: { ...DEFAULT_SETTINGS.flags, ...row?.value.flags } }
}

export async function updateSettings(actorId: string, patch: Partial<AppSettings>): Promise<AppSettings> {
  const before = await getSettings()
  const after = { ...before, ...patch }
  await db.settings.put({ key: 'app', value: after })
  await audit({ actorId, action: 'settings.update', entity: 'settings', entityId: 'app', before: pick(before, patch), after: patch })
  return after
}

function pick<T extends object>(obj: T, keys: Partial<T>): Partial<T> {
  return Object.fromEntries(Object.keys(keys).map((k) => [k, obj[k as keyof T]])) as Partial<T>
}

/**
 * Loads a validated dataset. A different dataset makes old drafts, decisions
 * and tasks meaningless, so they are cleared (audit and evidence are kept).
 */
export async function loadDataset(actorId: string, name: string, source: DataSource, validation: ValidationResult): Promise<StoredDataset> {
  if (!validation.ok || !validation.data) throw new Error('Dataset has validation errors and cannot be loaded')
  const record: StoredDataset = { id: 'current', name, source, loadedAt: nowIso(), data: validation.data, issues: validation.issues }
  await db.transaction('rw', [db.datasets, db.drafts, db.decisions, db.tasks, db.flows, db.audit], async () => {
    await Promise.all([db.drafts.clear(), db.decisions.clear(), db.tasks.clear()])
    await db.datasets.put(record)
    if ((await db.flows.count()) === 0) await db.flows.bulkPut(DEFAULT_FLOWS)
    await audit({
      actorId,
      action: 'data.load',
      entity: 'data',
      entityId: 'current',
      after: { name, source, people: validation.data!.people.length, messages: validation.data!.messages.length, labels: validation.data!.labels.length, warnings: validation.issues.length },
    })
  })
  return record
}

export async function resetAllData(actorId: string): Promise<void> {
  // The audit log is kept on purpose so every change stays visible
  await db.transaction('rw', [db.datasets, db.drafts, db.decisions, db.tasks, db.flows, db.runs, db.evidenceFiles, db.settings, db.audit], async () => {
    await Promise.all([db.datasets.clear(), db.drafts.clear(), db.decisions.clear(), db.tasks.clear(), db.flows.clear(), db.runs.clear(), db.evidenceFiles.clear(), db.settings.clear()])
    await audit({ actorId, action: 'data.reset', entity: 'data', entityId: 'all' })
  })
}

export async function addDecision(d: HumanDecision): Promise<void> {
  await db.decisions.add(d)
  await audit({ actorId: d.by, action: `decision.${d.type}`, entity: 'commitment', entityId: d.commitmentId, after: { ...d } })
}

export async function addTasks(actorId: string, tasks: ManualTask[]): Promise<void> {
  await db.tasks.bulkAdd(tasks)
  for (const t of tasks) await audit({ actorId, action: 'task.create', entity: 'task', entityId: t.id, after: t })
}

/** Saves the engine's drafts when they differ from what is stored (same ids are updated in place). */
export async function syncDrafts(drafts: Draft[]): Promise<boolean> {
  const stored = await db.drafts.toArray()
  const sortById = (a: Draft, b: Draft) => (a.id < b.id ? -1 : 1)
  if (JSON.stringify([...stored].sort(sortById)) === JSON.stringify([...drafts].sort(sortById))) return false
  await db.transaction('rw', db.drafts, async () => {
    const keep = new Set(drafts.map((d) => d.id))
    await db.drafts.bulkDelete(stored.filter((d) => !keep.has(d.id)).map((d) => d.id))
    await db.drafts.bulkPut(drafts)
  })
  return true
}

export async function putDraft(actorId: string, action: string, before: Draft, after: Draft): Promise<void> {
  await db.drafts.put(after)
  await audit({
    actorId,
    action,
    entity: 'draft',
    entityId: after.id,
    before: { state: before.state, version: before.version, recipientConfirmed: before.recipientConfirmed },
    after: { state: after.state, version: after.version, recipientConfirmed: after.recipientConfirmed, suppression: after.suppression?.reason, rejectReason: after.rejectReason, edited: after.editedBody !== undefined },
  })
}

export async function saveFlow(actorId: string, flow: Flow): Promise<void> {
  const before = await db.flows.get(flow.id)
  await db.flows.put(flow)
  await audit({ actorId, action: before ? 'flow.update' : 'flow.create', entity: 'settings', entityId: flow.id, before, after: flow })
}

export async function deleteFlow(actorId: string, id: string): Promise<void> {
  const before = await db.flows.get(id)
  if (!before || before.isDefault) throw new Error('Default flows cannot be deleted')
  await db.flows.delete(id)
  await audit({ actorId, action: 'flow.delete', entity: 'settings', entityId: id, before })
}

export async function sha256Hex(data: ArrayBuffer): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', data)
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024

export async function addEvidenceFile(actorId: string, file: File, linkedTo?: string): Promise<EvidenceFile> {
  if (file.size > MAX_UPLOAD_BYTES) throw new Error('Files must be 10 MB or smaller')
  const buffer = await file.arrayBuffer()
  const record: EvidenceFile = {
    id: newId('f'),
    name: file.name,
    mime: file.type || 'application/octet-stream',
    size: file.size,
    sha256: await sha256Hex(buffer),
    uploadedAt: nowIso(),
    uploadedBy: actorId,
    linkedTo,
    blob: new Blob([buffer], { type: file.type }),
  }
  await db.evidenceFiles.add(record)
  await audit({ actorId, action: 'evidence.upload', entity: 'evidence', entityId: record.id, after: { name: record.name, size: record.size, sha256: record.sha256, linkedTo } })
  return record
}

export async function saveRun(actorId: string, run: Omit<RunRecord, 'id' | 'at'>): Promise<RunRecord> {
  const record: RunRecord = { id: newId('run'), at: nowIso(), ...run }
  await db.runs.add(record)
  await audit({ actorId, action: 'run.save', entity: 'data', entityId: record.id, after: { checks: run.checks.map((c) => `${c.name}:${c.pass ? 'pass' : 'fail'}`) } })
  return record
}
