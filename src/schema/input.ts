import * as z from 'zod'
import type { CommitmentLabel, Message, Person, Thread } from '../engine/types'

// Canonical FollowThru input format. Structure only; meaning (timezones,
// timestamps, references) is checked in validate.ts.

const id = z.string().trim().min(1)

export const statusSchema = z.enum(['open', 'done', 'cancelled', 'deferred'])

export const personSchema = z.object({
  id,
  name: z.string().trim().min(1),
  timezone: z.string().trim().min(1),
  role: z.enum(['coordinator', 'member']).optional(),
  teamId: z.string().optional(),
  email: z.string().optional(),
}) satisfies z.ZodType<Person>

export const threadSchema = z.object({
  id,
  title: z.string().optional(),
  participantIds: z.array(z.string()).optional(),
}) satisfies z.ZodType<Thread>

/** sentAt is any string here; validate.ts requires Z or an explicit offset and normalises to UTC. */
export const messageSchema = z.object({
  id,
  threadId: id,
  authorId: id,
  sentAt: z.string(),
  text: z.string(),
  replyToId: z.string().optional(),
  mentionIds: z.array(z.string()).optional(),
}) satisfies z.ZodType<Message>

export const labelSchema = z.object({
  sourceMessageId: id,
  ownerId: id,
  dueAt: z.string().nullable(),
  status: statusSchema,
  note: z.string().optional(),
}) satisfies z.ZodType<CommitmentLabel>

export const datasetInputSchema = z.object({
  referenceTime: z.string().optional(),
  people: z.array(personSchema),
  threads: z.array(threadSchema).optional(),
  messages: z.array(messageSchema),
  labels: z.array(labelSchema).optional(),
})

export type DatasetInput = z.infer<typeof datasetInputSchema>

/** Engine run options accepted by the API. */
export const engineConfigInputSchema = z.object({
  now: z.string().optional(),
  flags: z
    .object({
      staleSuppression: z.boolean().optional(),
      recipientReview: z.boolean().optional(),
      ai: z.boolean().optional(),
    })
    .optional(),
  staleAfterHours: z.number().positive().max(24 * 30).optional(),
})

export type EngineConfigInput = z.infer<typeof engineConfigInputSchema>
