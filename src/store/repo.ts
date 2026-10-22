// Every write goes through here so it is audited. UI code uses store hooks
// and actions, never Dexie directly.
import type { AuditEvent, Draft, Flow, HumanDecision, ManualTask, Message, ValidationResult } from '../engine/types'
import { DEFAULT_FLAGS, DEFAULT_STALE_HOURS } from '../engine/run'
import { DEFAULT_FLOWS } from '../engine/flows'
import { db, type AppSettings, type DataSource, type EvidenceFile, type RunRecord, type StoredDataset } from './db'
import { isSecretSetting, type BackupFile } from '../schema/backup'
import { applyReaction, type Reaction, type Reactions } from '../lib/chat'

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
  await audit({ actorId, action: 'settings.update', entity: 'settings', entityId: 'app', before: redact(pick(before, patch)), after: redact(patch) })
  return after
}

/** Secrets are recorded as set or cleared, never by value. */
function redact<T extends object>(obj: T): T {
  return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, isSecretSetting(k) ? (v ? '[set]' : '[cleared]') : v])) as T
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

/** Adds one team-chat line to the loaded data, keeping messages in time order. The engine re-reads it at once. */
export async function appendMessage(actorId: string, message: Message, threadTitle: string): Promise<void> {
  await db.transaction('rw', [db.datasets, db.audit], async () => {
    const cur = await db.datasets.get('current')
    if (!cur) throw new Error('Load data first')
    const known = cur.data.threads.find((t) => t.id === message.threadId)
    const threads = known
      ? cur.data.threads.map((t) => (t.id === message.threadId && !t.participantIds?.includes(message.authorId) ? { ...t, participantIds: [...(t.participantIds ?? []), message.authorId] } : t))
      : [...cur.data.threads, { id: message.threadId, title: threadTitle, participantIds: [message.authorId] }]
    const messages = [...cur.data.messages, message].sort((a, b) => (a.sentAt === b.sentAt ? (a.id < b.id ? -1 : 1) : a.sentAt < b.sentAt ? -1 : 1))
    await db.datasets.put({ ...cur, data: { ...cur.data, threads, messages } })
    await audit({ actorId, action: 'chat.post', entity: 'data', entityId: message.id, after: { threadId: message.threadId, length: message.text.length } })
  })
}

/** One person's emoji reaction on a chat line, kept on the message object. The engine ignores it. */
export async function reactToMessage(actorId: string, messageId: string, emoji: Reaction, on?: boolean): Promise<Reactions> {
  return db.transaction('rw', [db.datasets, db.audit], async () => {
    const cur = await db.datasets.get('current')
    if (!cur) throw new Error('Load data first')
    const target = cur.data.messages.find((m) => m.id === messageId) as (Message & { reactions?: unknown }) | undefined
    if (!target) throw new Error('Message not found')
    const reactions = applyReaction(target.reactions, emoji, actorId, on)
    const messages = cur.data.messages.map((m) => (m.id === messageId ? { ...m, reactions } : m))
    await db.datasets.put({ ...cur, data: { ...cur.data, messages } })
    const mine = (reactions[emoji] ?? []).includes(actorId)
    await audit({ actorId, action: mine ? 'chat.react' : 'chat.unreact', entity: 'data', entityId: messageId, after: { emoji } })
    return reactions
  })
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

const byId = (a: Draft, b: Draft) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
const snapshot = (drafts: Draft[]) => JSON.stringify([...drafts].sort(byId))

/**
 * Saves the engine's drafts when they differ from what is stored (same ids are updated in place).
 * `basis` is the stored drafts the engine computed from. If the stored drafts changed since
 * (for example a coordinator confirmed a recipient a moment ago), nothing is written: the next
 * engine run includes that change instead of this write undoing it.
 */
export async function syncDrafts(drafts: Draft[], basis?: Draft[]): Promise<boolean> {
  return db.transaction('rw', db.drafts, async () => {
    const stored = await db.drafts.toArray()
    const now = snapshot(stored)
    if (now === snapshot(drafts)) return false
    if (basis && now !== snapshot(basis)) return false
    const keep = new Set(drafts.map((d) => d.id))
    await db.drafts.bulkDelete(stored.filter((d) => !keep.has(d.id)).map((d) => d.id))
    await db.drafts.bulkPut(drafts)
    return true
  })
}

export async function putDraft(actorId: string, action: string, before: Draft, after: Draft): Promise<void> {
  await db.drafts.put(after)
  await audit({
    actorId,
    action,
    entity: 'draft',
    entityId: after.id,
    before: { state: before.state, version: before.version, recipientConfirmed: before.recipientConfirmed },
    after: {
      state: after.state,
      version: after.version,
      recipientConfirmed: after.recipientConfirmed,
      suppression: after.suppression?.reason,
      rejectReason: after.rejectReason,
      edited: after.editedBody !== undefined,
      ...(after.snoozedUntil || before.snoozedUntil ? { snoozedUntil: after.snoozedUntil ?? null, snoozeReason: after.snoozeReason } : {}),
    },
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

/** Full local backup as JSON. Evidence files are listed with their hashes but their contents stay on this device. */
export async function exportBackup(actorId: string): Promise<string> {
  const [dataset, decisions, tasks, drafts, flows, settings, runs, auditRows, files] = await Promise.all([
    db.datasets.get('current'),
    db.decisions.toArray(),
    db.tasks.toArray(),
    db.drafts.toArray(),
    db.flows.toArray(),
    getSettings(),
    db.runs.toArray(),
    db.audit.toArray(),
    db.evidenceFiles.toArray(),
  ])
  if (!dataset) throw new Error('Load data before exporting a backup')
  const safeSettings = Object.fromEntries(Object.entries(settings).filter(([k]) => !isSecretSetting(k)))
  const backup = {
    format: 'followthru-backup',
    version: 1,
    exportedAt: nowIso(),
    dataset,
    decisions,
    tasks,
    drafts,
    flows,
    settings: safeSettings,
    runs,
    audit: auditRows,
    evidenceFiles: files.map(({ blob: _blob, ...meta }) => meta),
  }
  await audit({ actorId, action: 'data.backup_export', entity: 'data', entityId: 'backup', after: { decisions: decisions.length, drafts: drafts.length, audit: auditRows.length } })
  return JSON.stringify(backup, null, 2)
}

/** Replaces local data with a validated backup in one transaction. Evidence file contents are kept as they are. */
export async function importBackup(actorId: string, backup: BackupFile): Promise<void> {
  await db.transaction('rw', [db.datasets, db.decisions, db.tasks, db.drafts, db.flows, db.settings, db.runs, db.audit], async () => {
    await Promise.all([db.datasets.clear(), db.decisions.clear(), db.tasks.clear(), db.drafts.clear(), db.flows.clear(), db.runs.clear(), db.audit.clear()])
    await db.datasets.put(backup.dataset as unknown as StoredDataset)
    await db.decisions.bulkPut(backup.decisions as unknown as HumanDecision[])
    await db.tasks.bulkPut(backup.tasks as unknown as ManualTask[])
    await db.drafts.bulkPut(backup.drafts as unknown as Draft[])
    await db.flows.bulkPut(backup.flows as unknown as Flow[])
    await db.runs.bulkPut(backup.runs as unknown as RunRecord[])
    await db.audit.bulkPut(backup.audit as unknown as AuditEvent[])
    const current = await getSettings()
    await db.settings.put({ key: 'app', value: { ...current, ...(backup.settings as Partial<AppSettings>), profileId: current.profileId } })
    await audit({ actorId, action: 'data.restore', entity: 'data', entityId: 'backup', after: { exportedAt: backup.exportedAt, decisions: backup.decisions.length, drafts: backup.drafts.length } })
  })
}

/** Removes an uploaded file. The audit log keeps its name, size, hash and the reason. */
export async function deleteEvidenceFile(actorId: string, fileId: string, reason: string): Promise<void> {
  const file = await db.evidenceFiles.get(fileId)
  if (!file) throw new Error('File not found')
  await db.evidenceFiles.delete(fileId)
  await audit({ actorId, action: 'evidence.delete', entity: 'evidence', entityId: fileId, before: { name: file.name, size: file.size, sha256: file.sha256 }, after: { reason } })
}
