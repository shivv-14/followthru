import type { DecisionType, Role } from './types'

export type AppAction =
  | 'approve_draft'
  | 'confirm_recipient'
  | 'create_task'
  | 'edit_flows'
  | 'import_data'
  | 'reset_data'
  | 'upload_evidence'
  | 'export_data'

const COORDINATOR_ONLY_DECISIONS: DecisionType[] = [
  'mark_done',
  'cancel',
  'defer',
  'reopen',
  'reassign',
  'change_deadline',
  'resolve_review',
  'resolve_blocker',
  'approve_submission',
  'reject_submission',
  'decline_extension',
]

const OWNER_DECISIONS: DecisionType[] = ['set_progress', 'report_blocker', 'submit_work', 'request_extension']

/**
 * Members can report progress, blockers and submit work on their own items.
 * They cannot approve, cancel, defer or reassign. Coordinators can do everything.
 */
export function canDecide(role: Role, type: DecisionType, isOwner: boolean): boolean {
  if (role === 'coordinator') return true
  if (COORDINATOR_ONLY_DECISIONS.includes(type)) return false
  return OWNER_DECISIONS.includes(type) && isOwner
}

const MEMBER_ACTIONS: AppAction[] = ['upload_evidence', 'export_data']

export function canDo(role: Role, action: AppAction): boolean {
  return role === 'coordinator' || MEMBER_ACTIONS.includes(action)
}
