import * as z from 'zod'

// The one shape every email reading must have, whether it came from the AI provider or the
// rules fallback. Anything that does not validate is rejected and the email goes to review.

export const CLASSIFICATIONS = [
  'new_task',
  'meeting_minutes',
  'task_update',
  'completed',
  'blocker',
  'extension_request',
  'deadline_change',
  'cancelled',
  'clarification',
  'informational',
  'automated',
] as const

export const PRIORITIES = ['low', 'normal', 'high', 'critical'] as const

const text = (max: number) => z.string().trim().max(max)

export const actionItemSchema = z.object({
  title: text(200).min(3),
  description: text(2000).nullable(),
  assignee_email: text(320).nullable(),
  assignee_name: text(120).nullable(),
  /** The exact deadline wording from the email ("by Friday 5pm"), or null. The server resolves it. */
  deadline_text: text(120).nullable(),
  priority: z.enum(PRIORITIES),
  priority_reason: text(300).nullable(),
  blockers: z.array(text(300)).max(10),
})

export const updateSchema = z.object({
  kind: z.enum(['completed', 'blocker', 'extension_request', 'deadline_change', 'cancelled', 'progress']),
  /** Words that identify which task the update is about */
  target_hint: text(200),
  new_deadline_text: text(120).nullable(),
  blocker: text(300).nullable(),
  evidence_quote: text(300),
})

export const minutesSchema = z.object({
  title: text(200),
  decisions: z.array(text(300)).max(20),
  discussion: z.array(text(300)).max(20),
  open_questions: z.array(text(300)).max(20),
})

export const emailAnalysisSchema = z.object({
  classification: z.enum(CLASSIFICATIONS),
  action_required: z.boolean(),
  summary: text(600),
  items: z.array(actionItemSchema).max(20),
  update: updateSchema.nullable(),
  minutes: minutesSchema.nullable(),
  confidence: z.number().min(0).max(1),
  requires_human_review: z.boolean(),
  reasoning_summary: text(800),
  evidence_quotes: z.array(text(300)).max(10),
})

export type EmailAnalysis = z.infer<typeof emailAnalysisSchema>
export type ActionItem = z.infer<typeof actionItemSchema>
export type EmailUpdate = z.infer<typeof updateSchema>

/** Validates untrusted model output. Never throws. */
export function validateAnalysis(value: unknown): { ok: true; data: EmailAnalysis } | { ok: false; error: string } {
  const parsed = emailAnalysisSchema.safeParse(value)
  if (parsed.success) return { ok: true, data: parsed.data }
  const first = parsed.error.issues[0]
  return { ok: false, error: `${first.path.join('.') || '(root)'}: ${first.message}` }
}

/** JSON Schema of the analysis, sent to providers that support structured output. */
export const ANALYSIS_JSON_SCHEMA = {
  type: 'object',
  properties: {
    classification: { type: 'string', enum: [...CLASSIFICATIONS] },
    action_required: { type: 'boolean' },
    summary: { type: 'string' },
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          description: { type: 'string', nullable: true },
          assignee_email: { type: 'string', nullable: true },
          assignee_name: { type: 'string', nullable: true },
          deadline_text: { type: 'string', nullable: true },
          priority: { type: 'string', enum: [...PRIORITIES] },
          priority_reason: { type: 'string', nullable: true },
          blockers: { type: 'array', items: { type: 'string' } },
        },
        required: ['title', 'description', 'assignee_email', 'assignee_name', 'deadline_text', 'priority', 'priority_reason', 'blockers'],
      },
    },
    update: {
      type: 'object',
      nullable: true,
      properties: {
        kind: { type: 'string', enum: ['completed', 'blocker', 'extension_request', 'deadline_change', 'cancelled', 'progress'] },
        target_hint: { type: 'string' },
        new_deadline_text: { type: 'string', nullable: true },
        blocker: { type: 'string', nullable: true },
        evidence_quote: { type: 'string' },
      },
      required: ['kind', 'target_hint', 'new_deadline_text', 'blocker', 'evidence_quote'],
    },
    minutes: {
      type: 'object',
      nullable: true,
      properties: {
        title: { type: 'string' },
        decisions: { type: 'array', items: { type: 'string' } },
        discussion: { type: 'array', items: { type: 'string' } },
        open_questions: { type: 'array', items: { type: 'string' } },
      },
      required: ['title', 'decisions', 'discussion', 'open_questions'],
    },
    confidence: { type: 'number' },
    requires_human_review: { type: 'boolean' },
    reasoning_summary: { type: 'string' },
    evidence_quotes: { type: 'array', items: { type: 'string' } },
  },
  required: ['classification', 'action_required', 'summary', 'items', 'update', 'minutes', 'confidence', 'requires_human_review', 'reasoning_summary', 'evidence_quotes'],
} as const
