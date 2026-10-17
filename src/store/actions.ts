import { useMemo } from 'react'
import { approveDraft, canDecide, canDo, checkBeforeApproval, editDraft, rejectDraft, suppressDraft, validateFlow } from '../engine'
import type { DecisionType, Flow, HumanDecision, IsoUtc, ManualTask, TaskProgress, ValidationResult } from '../engine/types'
import { db, type AppSettings, type DataSource } from './db'
import type { BackupValidation } from '../schema/backup'
import * as repo from './repo'
import { useEngine, type EngineState } from './EngineProvider'

export interface ActionResult {
  ok: boolean
  message: string
}

const ok = (message: string): ActionResult => ({ ok: true, message })
const fail = (message: string): ActionResult => ({ ok: false, message })

export interface DecisionInput {
  note?: string
  ownerId?: string
  dueAt?: IsoUtc | null
  progress?: TaskProgress
  submissionId?: string
  fileIds?: string[]
}

export interface NewTaskInput {
  title: string
  ownerIds: string[]
  teamId?: string
  dueAt: IsoUtc | null
}

export function createActions(state: EngineState) {
  const actor = state.user
  const actorId = actor?.id ?? 'setup'
  const role = actor?.role ?? 'member'

  return {
    async decide(commitmentId: string, type: DecisionType, input: DecisionInput = {}): Promise<ActionResult> {
      const c = state.commitment(commitmentId)
      if (!actor) return fail('Choose a profile first')
      if (!c) return fail('Commitment not found')
      if (!canDecide(role, type, c.ownerId === actor.id)) return fail('Your role cannot do that here')
      if (type === 'report_blocker' && !input.note?.trim()) return fail('Describe the blocker')
      if (type === 'reassign' && !input.ownerId) return fail('Choose the new owner')
      if (type === 'request_extension') {
        if (!input.dueAt || Date.parse(input.dueAt) <= Date.parse(state.now)) return fail('Choose a new date after the current evaluation time')
        if (!input.note?.trim()) return fail('Say why you need more time')
      }
      const d: HumanDecision = { id: repo.newId('h'), commitmentId, type, at: state.now, recordedAt: repo.nowIso(), by: actor.id, ...input }
      if (type === 'submit_work') d.submissionId = repo.newId('s')
      await repo.addDecision(d)
      return ok('Saved')
    },

    async confirmRecipient(draftId: string, confirmed: boolean): Promise<ActionResult> {
      if (!actor || !canDo(role, 'confirm_recipient')) return fail('Only a coordinator can confirm recipients')
      const draft = await db.drafts.get(draftId)
      if (!draft) return fail('Draft not found')
      await repo.putDraft(actor.id, confirmed ? 'draft.confirm_recipient' : 'draft.unconfirm_recipient', draft, { ...draft, recipientConfirmed: confirmed })
      return ok(confirmed ? 'Recipient confirmed' : 'Confirmation removed')
    },

    /** Re-checks freshness against the latest state right before approving. */
    async approve(draftId: string): Promise<ActionResult> {
      if (!actor || !canDo(role, 'approve_draft')) return fail('Only a coordinator can approve drafts')
      const draft = await db.drafts.get(draftId)
      if (!draft) return fail('Draft not found')
      const check = checkBeforeApproval(draft, state.commitment(draft.commitmentId), state.config, state.people)
      if (check.suppressWith) {
        await repo.putDraft(actor.id, 'draft.suppress_on_approval', draft, suppressDraft(draft, check.suppressWith, state.now))
        return fail(`Suppressed instead of approved: ${check.blockers[0].message}`)
      }
      if (!check.ok) return fail(check.blockers.map((b) => b.message).join('. '))
      await repo.putDraft(actor.id, 'draft.approve', draft, approveDraft(draft, actor.id, state.now))
      return ok('Approved in shadow mode. Nothing was sent.')
    },

    async reject(draftId: string, reason: string): Promise<ActionResult> {
      if (!actor || !canDo(role, 'approve_draft')) return fail('Only a coordinator can reject drafts')
      if (!reason.trim()) return fail('Give a reason for rejecting the draft')
      const draft = await db.drafts.get(draftId)
      if (!draft) return fail('Draft not found')
      if (draft.state !== 'pending_review') return fail(`Draft is ${draft.state.replace('_', ' ')}, not waiting for review`)
      await repo.putDraft(actor.id, 'draft.reject', draft, rejectDraft(draft, actor.id, state.now, reason))
      return ok('Draft rejected')
    },

    async edit(draftId: string, body: string): Promise<ActionResult> {
      if (!actor || !canDo(role, 'approve_draft')) return fail('Only a coordinator can edit drafts')
      const draft = await db.drafts.get(draftId)
      if (!draft) return fail('Draft not found')
      try {
        await repo.putDraft(actor.id, 'draft.edit', draft, editDraft(draft, actor.id, state.now, body))
        return ok('Draft text saved')
      } catch (e) {
        return fail((e as Error).message)
      }
    },

    async createTasks(input: NewTaskInput): Promise<ActionResult> {
      if (!actor || !canDo(role, 'create_task')) return fail('Only a coordinator can assign tasks')
      if (!input.title.trim()) return fail('Give the task a title')
      if (input.ownerIds.length === 0) return fail('Choose a person or a team')
      if (input.dueAt && Date.parse(input.dueAt) <= Date.parse(state.now)) return fail('The deadline must be after the current evaluation time')
      const tasks: ManualTask[] = input.ownerIds.map((ownerId) => ({
        id: repo.newId('task'),
        title: input.title.trim(),
        ownerId,
        requesterId: actor.id,
        teamId: input.teamId ?? state.people.get(ownerId)?.teamId,
        dueAt: input.dueAt,
        createdAt: state.now,
      }))
      await repo.addTasks(actor.id, tasks)
      return ok(tasks.length === 1 ? 'Task assigned' : `${tasks.length} tasks assigned`)
    },

    async saveFlow(flow: Flow): Promise<ActionResult> {
      if (!actor || !canDo(role, 'edit_flows')) return fail('Only a coordinator can edit flows')
      if (flow.isDefault) return fail('Default flows are locked. Duplicate one to change it.')
      const errors = validateFlow(flow)
      if (errors.length > 0) return fail(errors.join('. '))
      await repo.saveFlow(actor.id, { ...flow, steps: [...flow.steps].sort((a, b) => a.afterHours - b.afterHours) })
      return ok('Flow saved')
    },

    async deleteFlow(id: string): Promise<ActionResult> {
      if (!actor || !canDo(role, 'edit_flows')) return fail('Only a coordinator can edit flows')
      try {
        await repo.deleteFlow(actor.id, id)
        return ok('Flow deleted')
      } catch (e) {
        return fail((e as Error).message)
      }
    },

    async upload(file: File, linkedTo?: string): Promise<ActionResult & { fileId?: string }> {
      if (!actor) return fail('Choose a profile first')
      try {
        const rec = await repo.addEvidenceFile(actor.id, file, linkedTo)
        return { ...ok(`Uploaded ${rec.name}`), fileId: rec.id }
      } catch (e) {
        return fail((e as Error).message)
      }
    },

    async updateSettings(patch: Partial<AppSettings>): Promise<ActionResult> {
      const coordinatorOnly: (keyof AppSettings)[] = ['flags', 'staleAfterHours', 'aiApiKey']
      if (Object.keys(patch).some((k) => coordinatorOnly.includes(k as keyof AppSettings)) && role !== 'coordinator') {
        return fail('Only a coordinator can change engine settings')
      }
      await repo.updateSettings(actorId, patch)
      return ok('Settings saved')
    },

    async loadDataset(name: string, source: DataSource, validation: ValidationResult): Promise<ActionResult> {
      if (state.dataset && actor && !canDo(role, 'import_data')) return fail('Only a coordinator can replace the data')
      if (!validation.ok) return fail('Fix the validation errors first')
      await repo.loadDataset(actorId, name, source, validation)
      if (actor && !validation.data!.people.some((p) => p.id === actor.id)) await repo.updateSettings(actorId, { profileId: null })
      return ok(`Loaded ${name}`)
    },

    async resetAll(): Promise<ActionResult> {
      if (state.dataset && actor && !canDo(role, 'reset_data')) return fail('Only a coordinator can reset data')
      await repo.resetAllData(actorId)
      return ok('All local data cleared')
    },

    async exportBackup(): Promise<ActionResult & { json?: string }> {
      if (!state.dataset) return fail('Load data first')
      try {
        return { ...ok('Backup ready'), json: await repo.exportBackup(actorId) }
      } catch (e) {
        return fail((e as Error).message)
      }
    },

    async restoreBackup(validation: BackupValidation): Promise<ActionResult> {
      if (state.dataset && (!actor || !canDo(role, 'import_data'))) return fail('Only a coordinator can restore a backup')
      if (!validation.ok || !validation.backup) return fail('Fix the backup errors first')
      await repo.importBackup(actorId, validation.backup)
      return ok(`Restored the backup from ${validation.backup.exportedAt}`)
    },

    async deleteEvidence(fileId: string, reason: string): Promise<ActionResult> {
      if (!actor || role !== 'coordinator') return fail('Only a coordinator can delete evidence')
      if (!reason.trim()) return fail('Give a reason for deleting the file')
      try {
        await repo.deleteEvidenceFile(actor.id, fileId, reason.trim())
        return ok('File deleted; the audit log keeps its name and hash')
      } catch (e) {
        return fail((e as Error).message)
      }
    },

    async saveRun(): Promise<ActionResult> {
      if (!state.dataset) return fail('Load data first')
      const r = state.result
      await repo.saveRun(actorId, {
        evaluatedAt: r.runAt,
        mode: r.mode,
        dataset: state.dataset.name,
        commitments: r.commitments.length,
        openOverdue: r.drafts.filter((d) => d.kind === 'reminder' && (d.state === 'pending_review' || d.state === 'approved')).length,
        drafts: r.drafts.length,
        checks: state.scorecard.checks,
      })
      return ok('Run saved')
    },
  }
}

export type Actions = ReturnType<typeof createActions>

export function useActions(): Actions {
  const state = useEngine()
  return useMemo(() => createActions(state), [state])
}
