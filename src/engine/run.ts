import type { EngineConfig, EngineFlags, EngineInput, EngineModeLabel, EngineResult, IsoUtc } from './types'
import { resolveCommitments } from './history'
import { rulesExtractor, type Extractor } from './extractor'
import { buildDrafts } from './drafts'
import { applyAiSignals } from './aiReview'

export const DEFAULT_FLAGS: EngineFlags = { staleSuppression: true, recipientReview: true, ai: false }
export const DEFAULT_STALE_HOURS = 24

export function makeConfig(now: IsoUtc, partial: Partial<Omit<EngineConfig, 'now'>> = {}): EngineConfig {
  return {
    now,
    flags: { ...DEFAULT_FLAGS, ...partial.flags },
    staleAfterHours: partial.staleAfterHours ?? DEFAULT_STALE_HOURS,
    flows: partial.flows,
  }
}

/**
 * AI is optional. With the flag on it is 'AI assisted' only when signals from a
 * configured provider were actually passed in; otherwise the rules ran alone and say so.
 */
export function modeLabel(flags: EngineFlags, aiUsed = false): EngineModeLabel {
  if (!flags.ai) return 'Rules'
  return aiUsed ? 'AI assisted' : 'Rules (fallback)'
}

/** Pure engine run: same input and config always give the same result. */
export function runEngine(input: EngineInput, config: EngineConfig, extractor: Extractor = rulesExtractor): EngineResult {
  const people = new Map(input.dataset.people.map((p) => [p.id, p]))
  const ruled = resolveCommitments(input.dataset, config.now, input.decisions, input.manualTasks, extractor)
  const aiUsed = config.flags.ai && input.aiSignals !== undefined
  const commitments = aiUsed ? applyAiSignals(ruled, input.aiSignals!, input.dataset) : ruled
  const drafts = buildDrafts(commitments, input.previousDrafts ?? [], config, people)
  return { runAt: config.now, mode: modeLabel(config.flags, aiUsed), commitments, drafts, issues: [] }
}
