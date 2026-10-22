import type { Commitment, Flow, TimeZoneId } from './types'
import { toWallTime } from './time'

export const DEFAULT_FLOW: Flow = {
  id: 'flow_default',
  name: 'Standard follow-up',
  isDefault: true,
  appliesTo: 'all',
  steps: [
    { afterHours: 0, tone: 'gentle' },
    { afterHours: 24, tone: 'firm' },
    { afterHours: 72, tone: 'escalate' },
  ],
  skipWeekends: false,
}

export const WORKWEEK_FLOW: Flow = {
  id: 'flow_workweek',
  name: 'Working days only',
  isDefault: true,
  appliesTo: 'none',
  steps: [
    { afterHours: 4, tone: 'gentle' },
    { afterHours: 28, tone: 'firm' },
  ],
  skipWeekends: true,
}

export const DEFAULT_FLOWS: Flow[] = [DEFAULT_FLOW, WORKWEEK_FLOW]

/** Team flow first, then a flow for everyone, then the built-in default. */
export function flowFor(c: Commitment, flows: Flow[] | undefined): Flow {
  const list = flows && flows.length > 0 ? flows : [DEFAULT_FLOW]
  return (
    (c.teamId && list.find((f) => f.appliesTo === c.teamId)) ||
    list.find((f) => f.appliesTo === 'all' && !f.isDefault) ||
    list.find((f) => f.appliesTo === 'all') ||
    DEFAULT_FLOW
  )
}

/** Hours between two instants, optionally skipping Saturdays and Sundays in the owner's timezone. */
export function elapsedHours(fromMs: number, toMs: number, skipWeekends: boolean, tz: TimeZoneId): number {
  if (toMs <= fromMs) return 0
  if (!skipWeekends) return (toMs - fromMs) / 3_600_000
  let hours = 0
  const HOUR = 3_600_000
  for (let t = fromMs; t < toMs; t += HOUR) {
    const wd = toWallTime(t, tz).weekday
    if (wd !== 0 && wd !== 6) hours += Math.min(1, (toMs - t) / HOUR)
  }
  return hours
}

/** Index of the latest step that is due, or -1 when the first step is not due yet. */
export function stepFor(flow: Flow, hoursOverdue: number): number {
  let step = -1
  flow.steps.forEach((s, i) => {
    if (hoursOverdue >= s.afterHours) step = i
  })
  return step
}

export function validateFlow(flow: Pick<Flow, 'name' | 'steps'>): string[] {
  const errors: string[] = []
  if (!flow.name.trim()) errors.push('Give the flow a name')
  if (flow.steps.length === 0) errors.push('Add at least one step')
  flow.steps.forEach((s, i) => {
    if (!Number.isFinite(s.afterHours) || s.afterHours < 0) errors.push(`Step ${i + 1}: hours must be 0 or more`)
    if (i > 0 && s.afterHours <= flow.steps[i - 1].afterHours) errors.push(`Step ${i + 1}: must come after step ${i}`)
    if (s.recipient !== undefined && !['owner', 'requester', 'coordinator'].includes(s.recipient)) errors.push(`Step ${i + 1}: unknown recipient`)
  })
  return errors
}
