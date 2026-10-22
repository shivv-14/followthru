import type { AuditEvent } from '../engine/types'
import type { EvidenceFile } from './db'
import type { EngineState } from './EngineProvider'

/** One JSON file a judge can read: what was evaluated, the scorecard, results, the audit trail and uploaded file hashes. */
export function buildEvidencePack(state: EngineState, auditRows: AuditEvent[], files: EvidenceFile[], generatedAt: string): string {
  const ds = state.dataset
  return JSON.stringify(
    {
      format: 'followthru-evidence-pack',
      generatedAt,
      dataset: ds ? { name: ds.name, source: ds.source, synthetic: ds.source === 'demo' || ds.data.labels.length === 0, loadedAt: ds.loadedAt } : null,
      evaluationClock: state.now,
      engineMode: state.result.mode,
      flags: state.config.flags,
      scorecard: state.scorecard,
      commitments: state.result.commitments,
      drafts: state.result.drafts,
      audit: auditRows,
      evidenceFiles: files.map(({ blob: _blob, ...meta }) => meta),
    },
    null,
    2,
  )
}
