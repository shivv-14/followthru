import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import type { AuditEvent } from '../engine/types'
import { db } from './db'
import { useCloudData } from '../cloud/CloudEngineProvider'
import { useCloud } from '../cloud/session'
import { supabase } from '../lib/supabase'

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

/** Newest first; the filter runs inside the database (IndexedDB cursor, or a Supabase query limited by RLS to coordinators). */
export function useAuditLog(limit = 200, filter: AuditFilter = {}) {
  const key = JSON.stringify(filter)
  const cloud = useCloud()
  const local = useLiveQuery(
    () =>
      cloud
        ? []
        : db.audit
            .orderBy('at')
            .reverse()
            .filter((a) => matchesAudit(a, filter))
            .limit(limit)
            .toArray(),
    [limit, key, !!cloud],
  )
  const [remote, setRemote] = useState<AuditEvent[]>([])
  useEffect(() => {
    if (!cloud || cloud.status !== 'signed_in') return
    let q = supabase().from('audit_log').select('id, created_at, actor_person, actor_profile_id, action, entity_type, entity_id, before, after').order('created_at', { ascending: false }).limit(Math.min(limit, 5000))
    if (filter.actorId) q = q.eq('actor_person', filter.actorId)
    if (filter.actionPrefix) q = q.like('action', `${filter.actionPrefix}%`)
    if (filter.entity) q = q.eq('entity_type', filter.entity)
    if (filter.from) q = q.gte('created_at', filter.from)
    if (filter.to) q = q.lte('created_at', filter.to)
    let stale = false
    void q.then(({ data }) => {
      if (stale) return
      setRemote(
        (data ?? []).map((r) => ({
          id: String(r.id),
          at: r.created_at,
          actorId: r.actor_person ?? r.actor_profile_id ?? 'system',
          action: r.action,
          entity: r.entity_type as AuditEvent['entity'],
          entityId: r.entity_id,
          before: r.before ?? undefined,
          after: r.after ?? undefined,
        })),
      )
    })
    return () => {
      stale = true
    }
  }, [cloud?.status, cloud?.version, limit, key])
  return cloud ? remote : (local ?? [])
}

export function useEvidenceFiles() {
  const cloud = useCloudData()
  const local = useLiveQuery(() => (cloud ? [] : db.evidenceFiles.orderBy('uploadedAt').reverse().toArray()), [!!cloud])
  return cloud ? cloud.files : (local ?? [])
}

export function useRuns() {
  const cloud = useCloudData()
  const local = useLiveQuery(() => (cloud ? [] : db.runs.orderBy('at').reverse().toArray()), [!!cloud])
  return cloud ? cloud.runs : (local ?? [])
}

/** Keys whose values differ between an audit entry's before and after. */
export function changedKeys(before: unknown, after: unknown): string[] {
  const b = (before && typeof before === 'object' ? before : {}) as Record<string, unknown>
  const a = (after && typeof after === 'object' ? after : {}) as Record<string, unknown>
  return [...new Set([...Object.keys(b), ...Object.keys(a)])].filter((k) => JSON.stringify(b[k]) !== JSON.stringify(a[k]))
}
