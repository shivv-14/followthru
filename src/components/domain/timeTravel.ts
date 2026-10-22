import { makeConfig, runEngine } from '../../engine'
import type { Commitment, Dataset, Draft, EngineConfig, HumanDecision, IsoUtc, ManualTask } from '../../engine/types'

export interface ReplayPoint {
  at: IsoUtc
  /** What happened at this moment, for the slider label */
  label: string
}

export interface ReplayFrame {
  at: IsoUtc
  commitment?: Commitment
  draft?: Draft
}

/** Moments worth stopping at: every event on the commitment plus the current clock. */
export function replayPoints(c: Commitment, now: IsoUtc): ReplayPoint[] {
  const seen = new Set<string>()
  const points: ReplayPoint[] = []
  for (const e of [...c.events].sort((a, b) => a.at.localeCompare(b.at))) {
    if (seen.has(e.at) || e.at > now) continue
    seen.add(e.at)
    points.push({ at: e.at, label: e.type.replace(/_/g, ' ') })
  }
  if (!seen.has(now)) points.push({ at: now, label: 'now' })
  return points
}

/**
 * Re-runs the engine as if the clock were `at`: only messages and decisions known
 * by then count. Previous drafts are not carried in, so each frame is a fresh view.
 */
export function replayAt(
  commitmentId: string,
  at: IsoUtc,
  input: { dataset: Dataset; decisions?: HumanDecision[]; manualTasks?: ManualTask[] },
  config?: Partial<Omit<EngineConfig, 'now'>>,
): ReplayFrame {
  const dataset: Dataset = { ...input.dataset, referenceTime: at, messages: input.dataset.messages.filter((m) => m.sentAt <= at) }
  const decisions = (input.decisions ?? []).filter((d) => d.at <= at)
  const manualTasks = (input.manualTasks ?? []).filter((t) => t.createdAt <= at)
  const result = runEngine({ dataset, decisions, manualTasks }, makeConfig(at, config))
  return { at, commitment: result.commitments.find((c) => c.id === commitmentId), draft: result.drafts.find((d) => d.commitmentId === commitmentId) }
}
