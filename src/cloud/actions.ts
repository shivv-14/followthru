import type { DecisionType, Flow, ValidationResult } from '../engine/types'
import type { Actions, ActionResult, DecisionInput, NewTaskInput } from '../store/actions'
import type { AppSettings, DataSource } from '../store/db'
import type { EngineState } from '../store/engineContext'
import type { BackupValidation } from '../schema/backup'
import { supabase } from '../lib/supabase'
import { callApi, type ApiResult } from './api'
import type { CloudData } from './CloudEngineProvider'

const MAX_UPLOAD = 10 * 1024 * 1024
const ALLOWED = /\.(png|jpe?g|webp|gif|pdf|txt|csv|json|docx|xlsx|pptx|zip)$/i

function result(res: ApiResult<{ message?: string }>, fallback = 'Saved'): ActionResult {
  return res.ok ? { ok: true, message: res.data.message ?? fallback } : { ok: false, message: res.error.message }
}

/** Same actions as the demo mode, backed by the server API. Every rule is checked again on the server. */
export function createCloudActions(state: EngineState, cloud: CloudData): Actions {
  const done = async (res: ApiResult<{ message?: string }>, fallback?: string) => {
    cloud.reload()
    return result(res, fallback)
  }
  const draft = (draftId: string) => state.result.drafts.find((d) => d.id === draftId)
  const draftAction = async (draftId: string, action: string, extra: Record<string, unknown> = {}) => {
    const d = draft(draftId)
    if (!d) return { ok: false, message: 'Draft not found' }
    return done(await callApi('drafts/action', { draftKey: draftId, action, expectedVersion: d.version, ...extra }))
  }

  return {
    async decide(commitmentId: string, type: DecisionType, input: DecisionInput = {}) {
      return done(await callApi('tasks/decide', { taskKey: commitmentId, type, input, expectedVersion: cloud.taskRows.get(commitmentId)?.rowVersion }))
    },
    confirmRecipient: (draftId: string, confirmed: boolean) => draftAction(draftId, confirmed ? 'confirm' : 'unconfirm'),
    approve: (draftId: string) => draftAction(draftId, 'approve'),
    reject: (draftId: string, reason: string) => (reason.trim() ? draftAction(draftId, 'reject', { reason }) : Promise.resolve({ ok: false, message: 'Give a reason for rejecting the draft' })),
    edit: (draftId: string, body: string) => draftAction(draftId, 'edit', { body }),
    snooze: (draftId: string, until: string, reason = '') => draftAction(draftId, 'snooze', { until, reason }),
    unsnooze: (draftId: string) => draftAction(draftId, 'unsnooze'),
    regenerate: (draftId: string) => draftAction(draftId, 'regenerate'),
    async createTasks(input: NewTaskInput) {
      return done(await callApi('tasks/create', input))
    },
    async saveFlow(flow: Flow) {
      return done(await callApi('flows/save', { flow }))
    },
    async deleteFlow(id: string) {
      return done(await callApi('flows/delete', { id }))
    },
    /** Uploads straight into this workspace's private folder, then the server checks the bytes and records the hash. */
    async upload(file: File, linkedTo?: string) {
      if (file.size > MAX_UPLOAD) return { ok: false, message: 'Files must be 10 MB or smaller' }
      if (!ALLOWED.test(file.name)) return { ok: false, message: 'Use PNG, JPEG, WebP, GIF, PDF, TXT, CSV, JSON, DOCX, XLSX, PPTX or ZIP' }
      const safe = file.name.replace(/[^\w.-]+/g, '_').slice(-120)
      const path = `${cloud.orgId}/${crypto.randomUUID()}/${safe}`
      const { error } = await supabase().storage.from('task-attachments').upload(path, file, { contentType: file.type || undefined, upsert: false })
      if (error) return { ok: false, message: /mime|type/i.test(error.message) ? 'That file type is not allowed' : 'The upload failed. Try again.' }
      const res = await callApi<{ message: string; file: { id: string } }>('files/register', { objectPath: path, originalName: file.name, taskKey: linkedTo })
      cloud.reload()
      return res.ok ? { ok: true, message: res.data.message, fileId: res.data.file.id } : { ok: false, message: res.error.message }
    },
    async updateSettings(patch: Partial<AppSettings>) {
      const allowed = Object.fromEntries(Object.entries(patch).filter(([k]) => ['clockMode', 'customNow', 'flags', 'staleAfterHours'].includes(k)))
      if (Object.keys(allowed).length === 0) return { ok: true, message: 'Nothing to save' }
      return done(await callApi('settings/update', { patch: allowed }), 'Settings saved')
    },
    async loadDataset(name: string, source: DataSource, validation: ValidationResult) {
      if (!validation.ok || !validation.data) return { ok: false, message: 'Fix the validation errors first' }
      return done(await callApi('data/import', { name, source, format: name.toLowerCase().endsWith('.csv') ? 'csv' : 'json', dataset: validation.data }))
    },
    async resetAll() {
      return done(await callApi('data/reset', { confirm: 'RESET' }))
    },
    /** A JSON copy of everything this account can see. The database itself is backed up by Supabase. */
    async exportBackup() {
      const { data: audit } = await supabase().from('audit_log').select('created_at, actor_person, action, entity_type, entity_id, before, after').order('created_at').limit(10_000)
      const backup = {
        format: 'followthru-cloud-export',
        version: 1,
        exportedAt: new Date().toISOString(),
        workspace: cloud.orgName,
        dataset: state.dataset,
        decisions: state.decisions,
        tasks: state.tasks,
        commitments: state.result.commitments,
        drafts: state.result.drafts,
        flows: state.flows,
        settings: cloud.orgSettings,
        runs: cloud.runs,
        audit: audit ?? [],
        evidenceFiles: cloud.files,
      }
      return { ok: true, message: 'Export ready', json: JSON.stringify(backup, null, 2) }
    },
    async restoreBackup(_validation: BackupValidation) {
      return { ok: false, message: 'Restoring a browser backup into a cloud workspace is not supported. Import the conversation data instead.' }
    },
    async deleteEvidence(fileId: string, reason: string) {
      if (!reason.trim()) return { ok: false, message: 'Give a reason for deleting the file' }
      return done(await callApi('files/delete', { id: fileId, reason }))
    },
    async saveRun() {
      return done(await callApi('engine/run', { trigger: 'manual' }), 'Engine run saved')
    },
  }
}
