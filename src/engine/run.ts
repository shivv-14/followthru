import type { EngineConfig, EngineFlags, EngineInput, EngineModeLabel, EngineResult, IsoUtc } from './types'
import { resolveCommitments } from './history'
import { buildDrafts } from './drafts'

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
 * AI extraction is optional and needs a configured provider. None is bundled,
 * so asking for it always falls back to the rules and says so.
 */
export function modeLabel(flags: EngineFlags): EngineModeLabel {
  return flags.ai ? 'Rules (fallback)' : 'Rules'
}

/** Pure engine run: same input and config always give the same result. */
export function runEngine(input: EngineInput, config: EngineConfig): EngineResult {
  const people = new Map(input.dataset.people.map((p) => [p.id, p]))
  const commitments = resolveCommitments(input.dataset, config.now, input.decisions, input.manualTasks)
  const drafts = buildDrafts(commitments, input.previousDrafts ?? [], config, people)
  return { runAt: config.now, mode: modeLabel(config.flags), commitments, drafts, issues: [] }
}
