import { createContext } from 'react'
import type { AiSignal, Commitment, Draft, EngineConfig, EngineResult, Flow, HumanDecision, ManualTask, Person, Scorecard } from '../engine/types'
import type { AppSettings, StoredDataset } from './db'

/** State of the optional AI pre-pass. Anything but 'ready' means the rules ran alone. */
export type AiStatus = { state: 'off' } | { state: 'loading' } | { state: 'ready'; signals: AiSignal[]; model: string } | { state: 'failed'; reason: string }

export interface EngineState {
  ready: boolean
  ai: AiStatus
  dataset: StoredDataset | null
  settings: AppSettings
  now: string
  config: EngineConfig
  result: EngineResult
  scorecard: Scorecard
  user: Person | null
  people: Map<string, Person>
  flows: Flow[]
  decisions: HumanDecision[]
  tasks: ManualTask[]
  commitment: (id: string) => Commitment | undefined
  draftFor: (commitmentId: string) => Draft | undefined
}

export const EngineContext = createContext<EngineState | null>(null)
