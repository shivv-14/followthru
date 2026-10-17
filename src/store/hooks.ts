import { useLiveQuery } from 'dexie-react-hooks'
import type { AuditEvent } from '../engine/types'
import { db } from './db'

export interface AuditFilter {
  actorId?: string
  /** For example "draft." or "decision.mark" */
  actionPrefix?: string
  entity?: AuditEvent['entity']
  /** Inclusive ISO bounds */
  from?: string
  to?: string
}

export function matchesAudit(a: AuditEvent, f: AuditFilter): boolean {
  if (f.actorId && a.actorId !== f.actorId) return false
  if (f.actionPrefix && !a.action.startsWith(f.actionPrefix)) return false
  if (f.entity && a.entity !== f.entity) return false
  if (f.from && a.at < f.from) return false
  if (f.to && a.at > f.to) return false
  return true
}

/** Newest first; the filter runs inside the database cursor, so large logs are not copied into the component. */
export function useAuditLog(limit = 200, filter: AuditFilter = {}) {
  const key = JSON.stringify(filter)
  return (
    useLiveQuery(
      () =>
        db.audit
          .orderBy('at')
          .reverse()
          .filter((a) => matchesAudit(a, filter))
          .limit(limit)
          .toArray(),
      [limit, key],
    ) ?? []
  )
}

export function useEvidenceFiles() {
  return useLiveQuery(() => db.evidenceFiles.orderBy('uploadedAt').reverse().toArray(), []) ?? []
}

export function useRuns() {
  return useLiveQuery(() => db.runs.orderBy('at').reverse().toArray(), []) ?? []
}

/** Keys whose values differ between an audit entry's before and after. */
export function changedKeys(before: unknown, after: unknown): string[] {
  const b = (before && typeof before === 'object' ? before : {}) as Record<string, unknown>
  const a = (after && typeof after === 'object' ? after : {}) as Record<string, unknown>
  return [...new Set([...Object.keys(b), ...Object.keys(a)])].filter((k) => JSON.stringify(b[k]) !== JSON.stringify(a[k]))
}
