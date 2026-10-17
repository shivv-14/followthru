import Dexie, { type Table } from 'dexie'
import type { AuditEvent, Dataset, Draft, EngineFlags, Flow, HumanDecision, IsoUtc, ManualTask, ScoreCheck, ValidationIssue } from '../engine/types'

export type DataSource = 'fixture' | 'import' | 'demo'

export interface StoredDataset {
  id: 'current'
  name: string
  source: DataSource
  loadedAt: IsoUtc
  data: Dataset
  issues: ValidationIssue[]
}

export type ClockMode = 'dataset' | 'live' | 'custom'

export interface AppSettings {
  userName: string
  profileId: string | null
  clockMode: ClockMode
  customNow: IsoUtc | null
  flags: EngineFlags
  staleAfterHours: number
  /** Gemini key for the optional AI pre-pass. Stays in this browser: never exported, never audited. */
  aiApiKey?: string
}

export interface SettingRow {
  key: 'app'
  value: AppSettings
}

export interface EvidenceFile {
  id: string
  name: string
  mime: string
  size: number
  sha256: string
  uploadedAt: IsoUtc
  uploadedBy: string
  linkedTo?: string
  blob: Blob
}

/** Saved engine run. Counts and checks only, never message text. */
export interface RunRecord {
  id: string
  at: IsoUtc
  evaluatedAt: IsoUtc
  mode: string
  dataset: string
  commitments: number
  openOverdue: number
  drafts: number
  checks: ScoreCheck[]
}

export class FollowThruDb extends Dexie {
  settings!: Table<SettingRow, string>
  datasets!: Table<StoredDataset, string>
  decisions!: Table<HumanDecision, string>
  tasks!: Table<ManualTask, string>
  drafts!: Table<Draft, string>
  flows!: Table<Flow, string>
  audit!: Table<AuditEvent, string>
  evidenceFiles!: Table<EvidenceFile, string>
  runs!: Table<RunRecord, string>

  constructor(name = 'followthru') {
    super(name)
    this.version(1).stores({
      settings: 'key',
      datasets: 'id',
      decisions: 'id, commitmentId, at',
      tasks: 'id, ownerId',
      drafts: 'id, commitmentId, state',
      flows: 'id',
      audit: 'id, at, entityId',
      evidenceFiles: 'id, uploadedAt, linkedTo',
      runs: 'id, at',
    })
  }
}

export const db = new FollowThruDb()
