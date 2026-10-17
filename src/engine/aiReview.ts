import type { AiSignal, Commitment, Dataset } from './types'

/** Below this the AI reading is ignored entirely. */
export const AI_MIN_CONFIDENCE = 0.7

const CLOSING = { completion: 'done', cancellation: 'cancelled', deferral: 'deferred' } as const

function linkedMessageIds(c: Commitment): string[] {
  const ids = [c.sourceMessageId, ...(c.linkedMessageIds ?? []), ...c.events.map((e) => e.evidence?.messageId ?? '')]
  return [...new Set(ids.filter(Boolean))]
}

/** The message whose rule-based reading closed the commitment, if any. */
function closingMessageId(c: Commitment): string | undefined {
  return [...c.events].reverse().find((e) => e.type === 'completed' || e.type === 'cancelled' || e.type === 'deferred')?.evidence?.messageId
}

/**
 * Compares the AI reading with the rules. A confident disagreement on a message linked
 * to a commitment adds the review reason `ai_disagreement`; status, owner and deadline
 * are never changed, so the AI can only send work to a human, never close or chase it.
 */
export function applyAiSignals(commitments: Commitment[], signals: AiSignal[], dataset: Dataset): Commitment[] {
  const byMessage = new Map<string, AiSignal>()
  for (const s of signals) if (s.confidence >= AI_MIN_CONFIDENCE) byMessage.set(s.messageId, s)
  if (byMessage.size === 0) return commitments
  const messages = new Map(dataset.messages.map((m) => [m.id, m]))

  return commitments.map((c) => {
    const closer = closingMessageId(c)
    const conflict = linkedMessageIds(c).find((id) => {
      const s = byMessage.get(id)
      if (!s) return false
      const aiCloses = s.kind in CLOSING ? CLOSING[s.kind as keyof typeof CLOSING] : null
      // AI says this message closes the work, but the rules left it open
      if (c.status === 'open' && aiCloses) return true
      // The rules closed the work on this message, but the AI reads it differently
      if (id === closer && c.status !== 'open' && aiCloses !== c.status) return true
      return false
    })
    if (!conflict || c.reviewReasons.includes('ai_disagreement')) return c
    const m = messages.get(conflict)
    return {
      ...c,
      needsReview: true,
      reviewReasons: [...c.reviewReasons, 'ai_disagreement'],
      events: [
        ...c.events,
        {
          type: 'review_flagged' as const,
          at: m?.sentAt ?? c.events[c.events.length - 1]?.at ?? '',
          by: m?.authorId ?? '',
          to: 'ai_disagreement',
          evidence: m ? { messageId: m.id, threadId: m.threadId, at: m.sentAt, quote: m.text.slice(0, 120), rule: 'ai_disagreement' } : undefined,
        },
      ].sort((a, b) => a.at.localeCompare(b.at)),
    }
  })
}
