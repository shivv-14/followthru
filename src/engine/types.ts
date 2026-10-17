// Shared domain contract for FollowThru.
// Track B imports domain types from this file only. Breaking changes are
// announced first and logged in docs/track-a-status.md.

/** UTC instant as an ISO 8601 string ending in Z, for example 2026-10-16T12:30:00.000Z */
export type IsoUtc = string
/** IANA timezone name, for example Asia/Kolkata or America/Los_Angeles */
export type TimeZoneId = string

// ---------------------------------------------------------------------------
// Input data
// ---------------------------------------------------------------------------

export type Role = 'coordinator' | 'member'

export interface Person {
  id: string
  name: string
  timezone: TimeZoneId
  role?: Role
  teamId?: string
  email?: string
}

export interface Thread {
  id: string
  title?: string
  participantIds?: string[]
}

export interface Message {
  id: string
  threadId: string
  authorId: string
  /** Normalised to UTC after validation */
  sentAt: IsoUtc
  text: string
  replyToId?: string
  mentionIds?: string[]
}

export type CommitmentStatus = 'open' | 'done' | 'cancelled' | 'deferred'

/** Expected answer for one labelled commitment. Used only by tests and evaluation, never by engine rules. */
export interface CommitmentLabel {
  sourceMessageId: string
  ownerId: string
  dueAt: IsoUtc | null
  status: CommitmentStatus
  note?: string
}

/** Validated, normalised input. Messages are sorted by sentAt, then id. */
export interface Dataset {
  referenceTime?: IsoUtc
  people: Person[]
  threads: Thread[]
  messages: Message[]
  labels: CommitmentLabel[]
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export type IssueSeverity = 'error' | 'warning'

export type IssueCode =
  | 'invalid_json'
  | 'missing_field'
  | 'invalid_type'
  | 'invalid_value'
  | 'invalid_timestamp'
  | 'unknown_timezone'
  | 'duplicate_id'
  | 'unknown_author'
  | 'unknown_thread'
  | 'unknown_reply_target'
  | 'unknown_mention'
  | 'empty_text'
  | 'label_unknown_message'
  | 'label_unknown_owner'
  | 'csv_parse_error'
  | 'csv_missing_column'

export interface ValidationIssue {
  code: IssueCode
  severity: IssueSeverity
  /** Path into the input, for example ['messages', 3, 'sentAt'] */
  path: (string | number)[]
  message: string
}

export interface ValidationResult {
  ok: boolean
  /** Present when there are no errors (warnings allowed) */
  data?: Dataset
  issues: ValidationIssue[]
}

// ---------------------------------------------------------------------------
// Deadlines
// ---------------------------------------------------------------------------

/** firm: stated as a deadline. tentative: hedged ("maybe Friday"). none: no usable deadline. */
export type DeadlineCertainty = 'firm' | 'tentative' | 'none'

export interface Evidence {
  messageId: string
  threadId: string
  at: IsoUtc
  /** Short quote from the message. Never the full text. */
  quote: string
  /** Name of the rule that produced this decision */
  rule: string
}

export interface Deadline {
  dueAt: IsoUtc | null
  certainty: DeadlineCertainty
  /** Original phrase, for example "maybe Friday" */
  phrase: string
  /** Timezone the phrase was read in (the speaker's) */
  interpretedTz: TimeZoneId
  evidence?: Evidence
}

/** none: no due date. upcoming: firm, not yet due. overdue: firm and past due. tentative_passed: hedged date has passed and needs clarifying. */
export type DeadlineState = 'none' | 'upcoming' | 'overdue' | 'tentative_passed' | 'tentative_upcoming'

// ---------------------------------------------------------------------------
// Commitments
// ---------------------------------------------------------------------------

/** pending: no reply from the owner yet. Silence never changes status. */
export type ResponseState = 'pending' | 'responded'

export type CommitmentEventType =
  | 'created'
  | 'accepted'
  | 'delegated'
  | 'deadline_changed'
  | 'completed'
  | 'cancelled'
  | 'deferred'
  | 'reopened'
  | 'review_flagged'
  | 'human_decision'
  | 'progress'
  | 'not_done'
  | 'blocker'

export interface CommitmentEvent {
  type: CommitmentEventType
  at: IsoUtc
  /** Person id who caused the event */
  by: string
  evidence?: Evidence
  /** Previous value where relevant (owner id, dueAt, status) */
  from?: string | null
  /** New value where relevant */
  to?: string | null
}

export type ReviewReason =
  | 'unauthorised_status_claim'
  | 'ambiguous_completion'
  | 'tentative_deadline'
  | 'unclear_owner'
  | 'unaccepted_delegation'
  | 'conflicting_evidence'
  | 'weak_cross_thread_link'
  | 'missing_deadline'

/** not_started to submitted is the member's own progress report. Status still changes only through evidence or a coordinator decision. */
export type TaskProgress = 'not_started' | 'in_progress' | 'blocked' | 'submitted'

export interface Blocker {
  at: IsoUtc
  by: string
  text: string
  resolved: boolean
}

export interface Submission {
  id: string
  at: IsoUtc
  by: string
  note: string
  fileIds: string[]
  state: 'pending' | 'approved' | 'rejected'
  decidedBy?: string
  decidedAt?: IsoUtc
}

export interface Commitment {
  /** 'c_' + source message id, or 'c_' + task id for manual tasks */
  id: string
  title: string
  /** Empty string for manual tasks */
  sourceMessageId: string
  /** Where the commitment came from. Missing means 'message'. */
  source?: 'message' | 'manual'
  teamId?: string
  progress?: TaskProgress
  blockers?: Blocker[]
  submissions?: Submission[]
  /** Every message linked to this commitment, in time order */
  linkedMessageIds?: string[]
  requesterId: string | null
  ownerId: string | null
  deadline: Deadline
  status: CommitmentStatus
  responseState: ResponseState
  needsReview: boolean
  reviewReasons: ReviewReason[]
  threadIds: string[]
  events: CommitmentEvent[]
}

// ---------------------------------------------------------------------------
// Drafts and queue
// ---------------------------------------------------------------------------

export type DraftKind = 'reminder' | 'clarify'

/** pending_review: waiting for a coordinator. approved: approved in shadow mode, nothing is sent. */
export type DraftState = 'pending_review' | 'approved' | 'suppressed' | 'stale'

export type SuppressionReason =
  | 'completed'
  | 'cancelled'
  | 'deferred'
  | 'not_overdue'
  | 'needs_review'
  | 'stale'
  | 'recipient_unconfirmed'
  | 'superseded'

export interface Suppression {
  reason: SuppressionReason
  at: IsoUtc
  evidence?: Evidence
}

export interface DraftVersion {
  version: number
  at: IsoUtc
  dueAt: IsoUtc | null
  recipientId: string | null
  body: string
  subject?: string
  /** Why this version was written, for example 'created' or 'deadline_changed' */
  cause: string
}

/** Who a flow step writes to. Missing means the owner. */
export type RecipientRole = 'owner' | 'requester' | 'coordinator'

/** What the owner has said since the deadline: nothing, something, or "not yet" with a progress note. */
export type ReplyState = 'pending' | 'responded' | 'not_done'

export interface Draft {
  /** 'd_' + commitment id */
  id: string
  /** Equal to commitmentId. One commitment, at most one draft. */
  idempotencyKey: string
  commitmentId: string
  kind: DraftKind
  recipientId: string | null
  recipientConfirmed: boolean
  state: DraftState
  version: number
  body: string
  createdAt: IsoUtc
  updatedAt: IsoUtc
  suppression?: Suppression
  history: DraftVersion[]
  /** Follow-up flow and step that produced this draft */
  flowId?: string
  step?: number
  approvedBy?: string
  approvedAt?: IsoUtc
  /** Short subject line, under 60 characters */
  subject?: string
  /** Role of the recipient for this draft's flow step */
  recipientRole?: RecipientRole
  /** Owner reply state the wording was written for */
  replyState?: ReplyState
}

// ---------------------------------------------------------------------------
// Follow-up flows
// ---------------------------------------------------------------------------

export type FlowTone = 'gentle' | 'firm' | 'escalate'

export interface FlowStep {
  /** Hours after the deadline before this step's reminder is drafted */
  afterHours: number
  tone: FlowTone
  /** Who receives this step's draft. Missing means the owner. */
  recipient?: RecipientRole
}

export interface Flow {
  id: string
  name: string
  /** Default flows are locked; copy them to change */
  isDefault: boolean
  /** 'all', or a team id */
  appliesTo: string
  /** Sorted by afterHours ascending */
  steps: FlowStep[]
  skipWeekends: boolean
}

// ---------------------------------------------------------------------------
// Human decisions and manual tasks (engine inputs next to messages)
// ---------------------------------------------------------------------------

export type DecisionType =
  | 'mark_done'
  | 'cancel'
  | 'defer'
  | 'reopen'
  | 'reassign'
  | 'change_deadline'
  | 'resolve_review'
  | 'set_progress'
  | 'report_blocker'
  | 'resolve_blocker'
  | 'submit_work'
  | 'approve_submission'
  | 'reject_submission'

export interface HumanDecision {
  id: string
  commitmentId: string
  type: DecisionType
  at: IsoUtc
  by: string
  note?: string
  ownerId?: string
  dueAt?: IsoUtc | null
  progress?: TaskProgress
  submissionId?: string
  fileIds?: string[]
}

export interface ManualTask {
  id: string
  title: string
  ownerId: string
  requesterId: string
  teamId?: string
  dueAt: IsoUtc | null
  createdAt: IsoUtc
}

export interface EngineInput {
  dataset: Dataset
  decisions?: HumanDecision[]
  manualTasks?: ManualTask[]
  /** Drafts from the previous run, so updates keep the same draft and bump its version */
  previousDrafts?: Draft[]
}

// ---------------------------------------------------------------------------
// Engine run
// ---------------------------------------------------------------------------

/** Label shown in the UI. 'Rules (fallback)' when AI was requested but is unavailable. */
export type EngineModeLabel = 'Rules' | 'Rules (fallback)' | 'AI assisted'

export interface EngineFlags {
  staleSuppression: boolean
  recipientReview: boolean
  /** Optional AI extraction. Off by default and only used after rules pass. */
  ai: boolean
}

export interface EngineConfig {
  /** Evaluation clock. Always passed in; the engine never reads the system clock. */
  now: IsoUtc
  flags: EngineFlags
  /** Unapproved drafts older than this become stale */
  staleAfterHours: number
  /** Active follow-up flows. Missing means the built-in default flow. */
  flows?: Flow[]
}

export interface EngineResult {
  runAt: IsoUtc
  mode: EngineModeLabel
  commitments: Commitment[]
  drafts: Draft[]
  issues: ValidationIssue[]
}

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

export interface LabelCheck {
  sourceMessageId: string
  expected: CommitmentLabel
  actual: { ownerId: string | null; dueAt: IsoUtc | null; status: CommitmentStatus } | null
  ownerOk: boolean
  deadlineOk: boolean
  statusOk: boolean
  evidenceMessageIds: string[]
}

export interface ScoreCheck {
  name: 'owner_deadline_status' | 'zero_wrong_reminders' | 'one_action_one_draft'
  points: number
  pass: boolean
  detail: string
}

export interface Scorecard {
  runAt: IsoUtc
  labelChecks: LabelCheck[]
  checks: ScoreCheck[]
}

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

export interface AuditEvent {
  id: string
  at: IsoUtc
  actorId: string
  action: string
  entity: 'commitment' | 'draft' | 'task' | 'evidence' | 'settings' | 'data'
  entityId: string
  before?: unknown
  after?: unknown
}
