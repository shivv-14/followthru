import { addDays, toWallTime, wallTimeToUtcMs } from '../../../src/engine/time'
import { admin, type Op } from './admin'

const minutes = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + (m || 0)
}

/**
 * When an in-app reminder may be shown: now, or the end of quiet hours (and the weekend, if
 * skipped) in the recipient's timezone. Quiet hours may wrap midnight, for example 21:00-09:00.
 */
export function deliverAfter(nowMs: number, tz: string, quiet: { start: string; end: string }, skipWeekends: boolean): number {
  const start = minutes(quiet.start)
  const end = minutes(quiet.end)
  let t = nowMs
  for (let guard = 0; guard < 8; guard++) {
    const w = toWallTime(t, tz)
    const m = w.hour * 60 + w.minute
    const inQuiet = start > end ? m >= start || m < end : m >= start && m < end
    const weekend = skipWeekends && (w.weekday === 0 || w.weekday === 6)
    if (!inQuiet && !weekend) return t
    // Jump to the next quiet-hours end (today or tomorrow), then check the weekend again
    const day = inQuiet && start > end && m >= start ? 1 : weekend && !inQuiet ? 1 : 0
    const next = wallTimeToUtcMs(addDays({ year: w.year, month: w.month, day: w.day, hour: Math.floor(end / 60), minute: end % 60, second: 0 }, day), tz)
    t = next > t ? next : t + 3_600_000
  }
  return t
}

export interface NoteInput {
  orgId: string
  recipients: string[]
  type: string
  title: string
  body?: string
  taskKey?: string
  link?: string
  /** Unique per event: retries with the same key never create a second notification */
  eventKey: string
  deliverAfter?: string
  skip?: string
}

export function notificationOps(n: NoteInput): Op[] {
  return [...new Set(n.recipients)]
    .filter((r) => r && r !== n.skip)
    .map((recipient) => ({
      op: 'upsert' as const,
      table: 'notifications',
      conflict: ['recipient_profile_id', 'event_key'],
      ignore_duplicates: true,
      row: {
        org_id: n.orgId,
        recipient_profile_id: recipient,
        type: n.type,
        title: n.title.slice(0, 200),
        body: n.body?.slice(0, 2000) ?? null,
        task_key: n.taskKey ?? null,
        link: n.link ?? (n.taskKey ? `/commitments/${n.taskKey}` : null),
        event_key: n.eventKey,
        ...(n.deliverAfter ? { deliver_after: n.deliverAfter } : {}),
      },
    }))
}

/** Coordinators of the organization plus the lead of the task's team. */
export async function reviewerIds(orgId: string, teamKey: string | null | undefined): Promise<string[]> {
  const [{ data: coordinators }, { data: team }] = await Promise.all([
    admin().from('profiles').select('id').eq('org_id', orgId).eq('role', 'coordinator').eq('is_active', true),
    teamKey ? admin().from('teams').select('lead_profile_id').eq('org_id', orgId).eq('team_key', teamKey).maybeSingle() : Promise.resolve({ data: null }),
  ])
  return [...(coordinators ?? []).map((c) => c.id as string), ...(team?.lead_profile_id ? [team.lead_profile_id as string] : [])]
}

export function auditOp(orgId: string, actorProfileId: string | null, actorPerson: string | null, action: string, entityType: string, entityId: string, before?: unknown, after?: unknown): Op {
  return {
    op: 'insert',
    table: 'audit_log',
    row: { org_id: orgId, actor_profile_id: actorProfileId, actor_person: actorPerson, action, entity_type: entityType, entity_id: entityId, before: before ?? null, after: after ?? null },
  }
}
