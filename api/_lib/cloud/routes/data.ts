import { validateFlow } from '../../../../src/engine'
import type { Flow } from '../../../../src/engine/types'
import { validateDataset } from '../../../../src/schema/validate'
import type { ApiRequest } from '../../handlers'
import { admin, applyOps, sha256, uuid, type Op } from '../admin'
import { requireRole, requireUser } from '../context'
import { checkFile } from '../fileCheck'
import { HttpError, bad, bodyOf, conflict, forbidden, json, notFound, rateLimit, str } from '../http'
import { DEFAULT_ORG_SETTINGS, loadSettings, type OrgSettings } from '../orgData'
import { auditOp } from '../notify'
import { syncOrg, type SyncTrigger } from '../sync'
import { readableTask } from './work'

const BUCKET = 'task-attachments'

/** Coordinators import conversation data. Same file twice is refused; people, threads and messages are upserted without duplicates. */
export async function importData(req: ApiRequest) {
  const ctx = await requireUser(req)
  requireRole(ctx, 'coordinator')
  rateLimit(`import:${ctx.orgId}`, 20, 60 * 60_000)
  const b = bodyOf(req)
  const name = str(b, 'name', { max: 200 })
  const source = str(b, 'source')
  const format = str(b, 'format')
  if (!['demo', 'import', 'fixture'].includes(source)) throw bad('Unknown data source')
  if (!['json', 'csv'].includes(format)) throw bad('Use a JSON or CSV file')
  const validation = validateDataset(b.dataset)
  if (!validation.ok || !validation.data) {
    throw new HttpError(422, 'invalid_dataset', 'The data has errors. Nothing was imported.', { issues: validation.issues.slice(0, 50) })
  }
  const data = validation.data
  const hash = sha256(JSON.stringify(data))
  const { data: dup } = await admin().from('imports').select('id, created_at').eq('org_id', ctx.orgId).eq('sha256', hash).maybeSingle()
  if (dup) throw conflict(`This exact data was already imported on ${dup.created_at}. Nothing was changed.`)

  const settings = await loadSettings(ctx.orgId)
  const importId = uuid()
  const ops: Op[] = [
    {
      op: 'insert',
      table: 'imports',
      row: {
        id: importId,
        org_id: ctx.orgId,
        file_name: name,
        format,
        source,
        sha256: hash,
        status: 'imported',
        issues: validation.issues,
        people_count: data.people.length,
        thread_count: data.threads.length,
        message_count: data.messages.length,
        reference_time: data.referenceTime ?? null,
        labels: data.labels,
        imported_by: ctx.userId,
      },
    },
    ...data.people.map((p): Op => ({
      op: 'upsert',
      table: 'external_people',
      conflict: ['org_id', 'external_id'],
      row: { org_id: ctx.orgId, external_id: p.id, name: p.name, timezone: p.timezone, role: p.role ?? 'member', team_key: p.teamId ?? settings.defaultTeamKey ?? null, email: p.email ?? null, import_id: importId },
    })),
    // Teams named in the data become real teams (existing ones are left as they are)
    ...[...new Set(data.people.map((p) => p.teamId).filter((k): k is string => !!k && /^[a-z0-9][a-z0-9_-]{0,39}$/.test(k)))].map((k): Op => ({
      op: 'upsert',
      table: 'teams',
      conflict: ['org_id', 'team_key'],
      ignore_duplicates: true,
      row: { org_id: ctx.orgId, team_key: k, name: k.charAt(0).toUpperCase() + k.slice(1), created_by: ctx.userId },
    })),
    ...data.threads.map((t): Op => ({ op: 'upsert', table: 'threads', conflict: ['org_id', 'external_id'], ignore_duplicates: true, row: { org_id: ctx.orgId, external_id: t.id, title: t.title ?? null, import_id: importId } })),
    ...data.messages.map((m): Op => ({
      op: 'upsert',
      table: 'messages',
      conflict: ['org_id', 'external_id'],
      ignore_duplicates: true,
      row: { org_id: ctx.orgId, thread_external_id: m.threadId, external_id: m.id, author_external_id: m.authorId, text: m.text, sent_at: m.sentAt, reply_to_external_id: m.replyToId ?? null, mention_external_ids: m.mentionIds ?? [], import_id: importId },
    })),
    auditOp(ctx.orgId, ctx.userId, ctx.person.id, 'data.import', 'data', importId, null, { name, source, people: data.people.length, threads: data.threads.length, messages: data.messages.length, sha256: hash }),
  ]
  // Threads referenced by messages but missing from the thread list still need a row
  const threadIds = new Set(data.threads.map((t) => t.id))
  for (const id of new Set(data.messages.map((m) => m.threadId))) {
    if (!threadIds.has(id)) ops.splice(1, 0, { op: 'upsert', table: 'threads', conflict: ['org_id', 'external_id'], ignore_duplicates: true, row: { org_id: ctx.orgId, external_id: id, import_id: importId } })
  }
  await applyOps(ops)
  const outcome = await syncOrg(ctx.orgId, ctx.userId, 'import')
  return json(201, { ok: true, message: `Imported ${name}: ${data.people.length} people, ${data.messages.length} messages, ${outcome.result.commitments.length} commitments found`, warnings: validation.issues })
}

/** Clears conversation data, tasks, decisions and drafts for a fresh demo. Accounts, teams, flows, settings, files and the audit log stay. */
export async function resetData(req: ApiRequest) {
  const ctx = await requireUser(req)
  requireRole(ctx, 'coordinator')
  if (str(bodyOf(req), 'confirm') !== 'RESET') throw bad('Type RESET to confirm')
  const org = { org_id: ctx.orgId }
  await applyOps([
    { op: 'delete', table: 'reminder_drafts', match: org },
    { op: 'delete', table: 'human_decisions', match: org },
    { op: 'delete', table: 'tasks', match: org },
    { op: 'delete', table: 'messages', match: org },
    { op: 'delete', table: 'threads', match: org },
    { op: 'delete', table: 'external_people', match: { org_id: ctx.orgId, linked_profile_id: null } },
    { op: 'delete', table: 'imports', match: org },
    auditOp(ctx.orgId, ctx.userId, ctx.person.id, 'data.reset', 'data', ctx.orgId),
  ])
  return json(200, { ok: true, message: 'Workspace data cleared. Accounts, teams, flows, files and the audit log were kept.' })
}

const lastRun = new Map<string, number>()

export async function runEngineNow(req: ApiRequest) {
  const ctx = await requireUser(req)
  requireRole(ctx, 'coordinator', 'team_lead')
  const trigger = (str(bodyOf(req), 'trigger', { optional: true }) || 'manual') as SyncTrigger
  if (!['login', 'interval', 'manual'].includes(trigger)) throw bad('Unknown trigger')
  const last = lastRun.get(ctx.orgId) ?? 0
  if (trigger !== 'manual' && Date.now() - last < 30_000) return json(200, { ok: true, skipped: true, message: 'Ran moments ago' })
  rateLimit(`engine:${ctx.orgId}`, 30, 60_000)
  lastRun.set(ctx.orgId, Date.now())
  const out = await syncOrg(ctx.orgId, ctx.userId, trigger)
  return json(200, {
    ok: true,
    message: `Engine ran at ${out.input.now}: ${out.result.commitments.length} commitments, ${out.changed.tasks} tasks and ${out.changed.drafts} drafts changed`,
    runAt: out.input.now,
    mode: out.result.mode,
    changed: out.changed,
  })
}

const SETTING_KEYS: (keyof OrgSettings)[] = ['clockMode', 'customNow', 'flags', 'staleAfterHours', 'quietHours', 'skipWeekends']
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/

export async function updateSettings(req: ApiRequest) {
  const ctx = await requireUser(req)
  requireRole(ctx, 'coordinator')
  const patch = (bodyOf(req).patch ?? {}) as Partial<OrgSettings>
  const keys = Object.keys(patch) as (keyof OrgSettings)[]
  if (keys.length === 0 || keys.some((k) => !SETTING_KEYS.includes(k))) throw bad('Only engine and delivery settings can be changed here')
  if (patch.clockMode && !['dataset', 'live', 'custom'].includes(patch.clockMode)) throw bad('Unknown clock')
  if (patch.customNow && Number.isNaN(Date.parse(patch.customNow))) throw bad('Choose a valid time')
  if (patch.staleAfterHours !== undefined && !(Number.isFinite(patch.staleAfterHours) && patch.staleAfterHours >= 1 && patch.staleAfterHours <= 24 * 60)) throw bad('Stale window must be 1 to 1440 hours')
  if (patch.quietHours && !(HHMM.test(patch.quietHours.start) && HHMM.test(patch.quietHours.end))) throw bad('Quiet hours use HH:MM')
  if (patch.flags) {
    const f = patch.flags as unknown as Record<string, unknown>
    if (Object.entries(f).some(([k, v]) => !['staleSuppression', 'recipientReview', 'ai'].includes(k) || typeof v !== 'boolean')) throw bad('Unknown engine flag')
  }
  const before = await loadSettings(ctx.orgId)
  const after = { ...DEFAULT_ORG_SETTINGS, ...before, ...patch, flags: { ...before.flags, ...patch.flags } }
  await applyOps([
    { op: 'upsert', table: 'settings', conflict: ['org_id', 'key'], row: { org_id: ctx.orgId, key: 'app', value: after, updated_by: ctx.userId } },
    auditOp(ctx.orgId, ctx.userId, ctx.person.id, 'settings.update', 'settings', 'app', Object.fromEntries(keys.map((k) => [k, before[k]])), patch),
  ])
  await syncOrg(ctx.orgId, ctx.userId, 'write')
  return json(200, { ok: true, message: 'Settings saved' })
}

export async function saveFlow(req: ApiRequest) {
  const ctx = await requireUser(req)
  requireRole(ctx, 'coordinator')
  const flow = bodyOf(req).flow as Flow
  if (!flow || typeof flow !== 'object' || typeof flow.id !== 'string') throw bad('Send a flow')
  if (flow.isDefault) throw bad('Default flows are locked. Duplicate one to change it.')
  const key = flow.id.toLowerCase().replace(/[^a-z0-9_-]/g, '_').slice(0, 60)
  const clean: Flow = { ...flow, id: key, name: String(flow.name ?? '').slice(0, 80), steps: [...(flow.steps ?? [])].sort((a, b) => a.afterHours - b.afterHours) }
  const errors = validateFlow(clean)
  if (errors.length) throw bad(errors.join('. '))
  const { data: existing } = await admin().from('followup_flows').select('id, is_default, definition').eq('org_id', ctx.orgId).eq('flow_key', key).maybeSingle()
  if (existing?.is_default) throw bad('Default flows are locked. Duplicate one to change it.')
  await applyOps([
    {
      op: 'upsert',
      table: 'followup_flows',
      conflict: ['org_id', 'flow_key'],
      row: { org_id: ctx.orgId, flow_key: key, name: clean.name, is_default: false, applies_to: clean.appliesTo, definition: clean, skip_weekends: clean.skipWeekends, created_by: ctx.userId },
    },
    auditOp(ctx.orgId, ctx.userId, ctx.person.id, existing ? 'flow.update' : 'flow.create', 'settings', key, existing?.definition ?? null, clean),
  ])
  await syncOrg(ctx.orgId, ctx.userId, 'write')
  return json(200, { ok: true, message: 'Flow saved' })
}

export async function deleteFlow(req: ApiRequest) {
  const ctx = await requireUser(req)
  requireRole(ctx, 'coordinator')
  const key = str(bodyOf(req), 'id', { max: 60 })
  const { data: existing } = await admin().from('followup_flows').select('id, is_default, definition').eq('org_id', ctx.orgId).eq('flow_key', key).maybeSingle()
  if (!existing) throw notFound('Flow not found')
  if (existing.is_default) throw bad('Default flows cannot be deleted')
  await applyOps([{ op: 'delete', table: 'followup_flows', match: { id: existing.id } }, auditOp(ctx.orgId, ctx.userId, ctx.person.id, 'flow.delete', 'settings', key, existing.definition)])
  await syncOrg(ctx.orgId, ctx.userId, 'write')
  return json(200, { ok: true, message: 'Flow deleted' })
}

// ---------------------------------------------------------------------------
// Files: the browser uploads into its organization folder, then registers the file here
// ---------------------------------------------------------------------------

export async function registerFile(req: ApiRequest) {
  const ctx = await requireUser(req)
  rateLimit(`files:${ctx.userId}`, 60, 60 * 60_000)
  const b = bodyOf(req)
  const path = str(b, 'objectPath', { max: 400 })
  const originalName = str(b, 'originalName', { max: 255 })
  const taskKey = str(b, 'taskKey', { max: 120, optional: true })
  if (!path.startsWith(`${ctx.orgId}/`) || path.includes('..')) throw forbidden('That file is outside your workspace')
  const remove = () => admin().storage.from(BUCKET).remove([path])
  const task = taskKey ? await readableTask(ctx, taskKey).catch(async (e) => (await remove(), Promise.reject(e))) : null
  const { data: blob, error } = await admin().storage.from(BUCKET).download(path)
  if (error || !blob) throw notFound('Upload the file first')
  const bytes = new Uint8Array(await blob.arrayBuffer())
  const check = checkFile(originalName, bytes)
  if (!check.ok) {
    await remove()
    throw bad(check.reason)
  }
  const id = uuid()
  const hash = sha256(Buffer.from(bytes))
  try {
    await applyOps([
      { op: 'insert', table: 'files', row: { id, org_id: ctx.orgId, uploader_profile_id: ctx.userId, task_id: task?.id ?? null, original_name: originalName, object_path: path, mime: check.mime, size_bytes: bytes.byteLength, sha256: hash } },
      auditOp(ctx.orgId, ctx.userId, ctx.person.id, 'evidence.upload', 'evidence', id, null, { name: originalName, size: bytes.byteLength, sha256: hash, task: taskKey || null }),
    ])
  } catch (e) {
    // Never leave an object without its database record
    await remove()
    throw e
  }
  return json(201, { ok: true, message: `Uploaded ${originalName}`, file: { id, name: originalName, mime: check.mime, size: bytes.byteLength, sha256: hash } })
}

async function fileFor(ctx: Awaited<ReturnType<typeof requireUser>>, id: string) {
  const { data: f } = await admin().from('files').select('id, org_id, task_id, uploader_profile_id, object_path, original_name, deleted_at, size_bytes, sha256').eq('id', id).maybeSingle()
  if (!f || f.org_id !== ctx.orgId || f.deleted_at) throw notFound('File not found')
  if (ctx.role !== 'coordinator' && f.uploader_profile_id !== ctx.userId) {
    if (!f.task_id) throw notFound('File not found')
    const { data: t } = await admin().from('tasks').select('task_key').eq('id', f.task_id).single()
    await readableTask(ctx, t!.task_key)
  }
  return f
}

/** Short-lived signed link, made only after the permission check above. */
export async function fileUrl(req: ApiRequest) {
  const ctx = await requireUser(req)
  const f = await fileFor(ctx, str(bodyOf(req), 'id'))
  const { data, error } = await admin().storage.from(BUCKET).createSignedUrl(f.object_path, 60, { download: f.original_name })
  if (error || !data) throw new HttpError(500, 'server_error', 'Could not create a download link.')
  return json(200, { url: data.signedUrl, expiresIn: 60 })
}

export async function deleteFile(req: ApiRequest) {
  const ctx = await requireUser(req)
  requireRole(ctx, 'coordinator')
  const b = bodyOf(req)
  const f = await fileFor(ctx, str(b, 'id'))
  const reason = str(b, 'reason', { max: 500 })
  await applyOps([
    { op: 'update', table: 'files', match: { id: f.id }, set: { deleted_at: new Date().toISOString(), delete_reason: reason } },
    auditOp(ctx.orgId, ctx.userId, ctx.person.id, 'evidence.delete', 'evidence', f.id, { name: f.original_name, size: f.size_bytes, sha256: f.sha256 }, { reason }),
  ])
  await admin().storage.from(BUCKET).remove([f.object_path])
  return json(200, { ok: true, message: 'File deleted; the audit log keeps its name and hash' })
}
