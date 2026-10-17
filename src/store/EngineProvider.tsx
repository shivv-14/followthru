import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { evaluate, makeConfig, runEngine } from '../engine'
import type { Commitment, Draft, EngineConfig, EngineResult, Flow, HumanDecision, ManualTask, Person, Scorecard } from '../engine/types'
import { db, type AppSettings, type StoredDataset } from './db'
import { DEFAULT_SETTINGS, getSettings, syncDrafts } from './repo'

export interface EngineState {
  ready: boolean
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

const EngineContext = createContext<EngineState | null>(null)

function useMinuteClock(enabled: boolean): string {
  const [now, setNow] = useState(() => new Date().toISOString())
  useEffect(() => {
    if (!enabled) return
    setNow(new Date().toISOString())
    const id = window.setInterval(() => setNow(new Date().toISOString()), 60_000)
    return () => window.clearInterval(id)
  }, [enabled])
  return now
}

/** Evaluation clock: the dataset's reference time, the live clock, or a chosen time. */
export function evaluationTime(settings: AppSettings, dataset: StoredDataset | null, live: string): string {
  if (settings.clockMode === 'custom' && settings.customNow) return settings.customNow
  if (settings.clockMode === 'dataset' && dataset) {
    return dataset.data.referenceTime ?? dataset.data.messages.at(-1)?.sentAt ?? live
  }
  return live
}

const EMPTY_RESULT: EngineResult = { runAt: '', mode: 'Rules', commitments: [], drafts: [], issues: [] }

export function EngineProvider({ children }: { children: ReactNode }) {
  const settings = useLiveQuery(getSettings, [], undefined)
  const datasetRow = useLiveQuery(() => db.datasets.get('current'), [], null)
  const decisions = useLiveQuery(() => db.decisions.toArray(), [], undefined)
  const tasks = useLiveQuery(() => db.tasks.toArray(), [], undefined)
  const storedDrafts = useLiveQuery(() => db.drafts.toArray(), [], undefined)
  const flows = useLiveQuery(() => db.flows.toArray(), [], undefined)

  const s = settings ?? DEFAULT_SETTINGS
  const dataset = datasetRow ?? null
  const live = useMinuteClock(s.clockMode === 'live' || !dataset)
  const now = evaluationTime(s, dataset, live)
  const ready = settings !== undefined && datasetRow !== undefined && decisions !== undefined && tasks !== undefined && storedDrafts !== undefined && flows !== undefined

  const config = useMemo(() => makeConfig(now, { flags: s.flags, staleAfterHours: s.staleAfterHours, flows }), [now, s.flags, s.staleAfterHours, flows])

  const result = useMemo(() => {
    if (!ready || !dataset) return { ...EMPTY_RESULT, runAt: now }
    return runEngine({ dataset: dataset.data, decisions, manualTasks: tasks, previousDrafts: storedDrafts }, config)
  }, [ready, dataset, decisions, tasks, storedDrafts, config, now])

  useEffect(() => {
    if (ready && dataset) void syncDrafts(result.drafts)
  }, [ready, dataset, result])

  const value = useMemo<EngineState>(() => {
    const people = new Map((dataset?.data.people ?? []).map((p) => [p.id, p]))
    const byId = new Map(result.commitments.map((c) => [c.id, c]))
    const drafts = new Map(result.drafts.map((d) => [d.commitmentId, d]))
    return {
      ready,
      dataset,
      settings: s,
      now,
      config,
      result,
      scorecard: evaluate(result.commitments, result.drafts, dataset?.data.labels ?? [], result.runAt),
      user: (s.profileId && people.get(s.profileId)) || null,
      people,
      flows: flows ?? [],
      decisions: decisions ?? [],
      tasks: tasks ?? [],
      commitment: (id) => byId.get(id),
      draftFor: (id) => drafts.get(id),
    }
  }, [ready, dataset, s, now, config, result, flows, decisions, tasks])

  return <EngineContext.Provider value={value}>{children}</EngineContext.Provider>
}

export function useEngine(): EngineState {
  const ctx = useContext(EngineContext)
  if (!ctx) throw new Error('useEngine must be used inside EngineProvider')
  return ctx
}
