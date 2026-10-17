import { useLiveQuery } from 'dexie-react-hooks'
import { db } from './db'

export function useAuditLog(limit = 200) {
  return useLiveQuery(() => db.audit.orderBy('at').reverse().limit(limit).toArray(), [limit]) ?? []
}

export function useEvidenceFiles() {
  return useLiveQuery(() => db.evidenceFiles.orderBy('uploadedAt').reverse().toArray(), []) ?? []
}

export function useRuns() {
  return useLiveQuery(() => db.runs.orderBy('at').reverse().toArray(), []) ?? []
}
