import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { evaluate, makeConfig, runEngine } from '../engine'
import type { AiSignal, Commitment, Draft, EngineConfig, EngineResult, Flow, HumanDecision, ManualTask, Person, Scorecard } from '../engine/types'
import { fetchAiSignals } from '../ai/gemini'
import { db, type AppSettings, type StoredDataset } from './db'
import { DEFAULT_SETTINGS, getSettings, syncDrafts } from './repo'
import { evaluationTime } from './clock'

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

const EMPTY_RESULT: EngineResult = { runAt: '', mode: 'Rules', commitments: [], drafts: [], issues: [] }

export function EngineProvider({ children }: { children: ReactNode }) {
  const settings = useLiveQuery(getSettings, [], undefined)
  const datasetRow = useLiveQuery(async () => (await db.datasets.get('current')) ?? null, [], undefined)
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

  // Optional AI pre-pass: once per loaded dataset and key, never inside the engine itself
  const [ai, setAi] = useState<AiStatus>({ state: 'off' })
  const aiOn = s.flags.ai
  const aiKey = aiOn ? (s.aiApiKey ?? '') : ''
  const datasetKey = dataset ? `${dataset.name}|${dataset.loadedAt}` : ''
  const datasetRef = useRef(dataset)
  datasetRef.current = dataset
  useEffect(() => {
    const ds = datasetRef.current
    if (!ready || !ds || !aiOn) return setAi({ state: 'off' })
    if (!aiKey) return setAi({ state: 'failed', reason: 'No API key saved' })
    const controller = new AbortController()
    setAi({ state: 'loading' })
    const people = new Map(ds.data.people.map((p) => [p.id, p]))
    void fetchAiSignals(ds.data.messages, people, { apiKey: aiKey, signal: controller.signal }).then((r) => {
      if (!controller.signal.aborted) setAi(r.ok ? { state: 'ready', signals: r.signals, model: r.model } : { state: 'failed', reason: r.reason })
    })
    return () => controller.abort()
  }, [ready, datasetKey, aiOn, aiKey])
  const aiSignals = ai.state === 'ready' ? ai.signals : undefined

  const result = useMemo(() => {
    if (!ready || !dataset) return { ...EMPTY_RESULT, runAt: now }
    return runEngine({ dataset: dataset.data, decisions, manualTasks: tasks, previousDrafts: storedDrafts, aiSignals }, config)
  }, [ready, dataset, decisions, tasks, storedDrafts, config, now, aiSignals])

  useEffect(() => {
    if (!ready || !dataset) return
    // A reset or a closing tab can close the database while this write is in flight; nothing to save then.
    syncDrafts(result.drafts, storedDrafts).catch((e: unknown) => {
      if ((e as { name?: string })?.name !== 'DatabaseClosedError') throw e
    })
  }, [ready, dataset, result, storedDrafts])

  const value = useMemo<EngineState>(() => {
    const people = new Map((dataset?.data.people ?? []).map((p) => [p.id, p]))
    const byId = new Map(result.commitments.map((c) => [c.id, c]))
    const drafts = new Map(result.drafts.map((d) => [d.commitmentId, d]))
    return {
      ready,
      ai,
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
  }, [ready, ai, dataset, s, now, config, result, flows, decisions, tasks])

  return <EngineContext.Provider value={value}>{children}</EngineContext.Provider>
}

export function useEngine(): EngineState {
  const ctx = useContext(EngineContext)
  if (!ctx) throw new Error('useEngine must be used inside EngineProvider')
  return ctx
}
