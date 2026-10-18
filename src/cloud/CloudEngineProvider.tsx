import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { DEFAULT_FLAGS, DEFAULT_STALE_HOURS, evaluate, makeConfig } from '../engine'
import type { Commitment, CommitmentLabel, Dataset, Draft, EngineFlags, EngineModeLabel, Flow, HumanDecision, ManualTask } from '../engine/types'
import { supabase } from '../lib/supabase'
import { evaluationTime } from '../store/clock'
import type { AppSettings, ClockMode, EvidenceFile, RunRecord, StoredDataset } from '../store/db'
import { EngineContext, type EngineState } from '../store/engineContext'
import { callApi } from './api'
import { useCloud } from './session'

export interface OrgSettingsValue {
  clockMode: ClockMode
  customNow: string | null
  flags: EngineFlags
  staleAfterHours: number
  quietHours: { start: string; end: string }
  skipWeekends: boolean
}

export interface LastRun {
  at: string
  evaluatedAt: string
  trigger: string
  status: string
  counts: Record<string, number>
}

/** Cloud-only details the shared engine state has no place for. */
export interface CloudData {
  orgId: string
  orgName: string
  /** task_key -> database row id and optimistic-lock version */
  taskRows: Map<string, { id: string; rowVersion: number }>
  files: EvidenceFile[]
  runs: RunRecord[]
  lastRun: LastRun | null
  orgSettings: OrgSettingsValue
  loading: boolean
  error: string | null
  reload: () => void
}

const CloudDataContext = createContext<CloudData | null>(null)
export const useCloudData = () => useContext(CloudDataContext)

const DEFAULT_ORG: OrgSettingsValue = { clockMode: 'dataset', customNow: null, flags: DEFAULT_FLAGS, staleAfterHours: DEFAULT_STALE_HOURS, quietHours: { start: '21:00', end: '09:00' }, skipWeekends: true }
const LIVE_TABLES = ['notifications', 'tasks', 'reminder_drafts', 'human_decisions', 'engine_runs', 'comments', 'files', 'settings']

interface Loaded {
  dataset: StoredDataset
  tasks: { task_key: string; id: string; row_version: number; snapshot: Commitment | null; manual_task: ManualTask | null }[]
  drafts: Draft[]
  decisions: HumanDecision[]
  flows: Flow[]
  org: OrgSettingsValue
  files: EvidenceFile[]
  runs: RunRecord[]
  lastRun: LastRun | null
  mode: EngineModeLabel
}

async function rows<T>(query: PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const { data, error } = await query
  if (error) throw new Error(error.message)
  return data ?? []
}

/** Reads everything this user may see (RLS filters it) and rebuilds the engine's shapes. */
async function load(orgName: string): Promise<Loaded> {
  const db = supabase()
  const [people, threads, messages, imports, tasks, drafts, decisions, flows, settings, files, runs] = await Promise.all([
    rows<any>(db.from('external_people').select('external_id, name, timezone, role, team_key').order('name')),
    rows<any>(db.from('threads').select('external_id, title')),
    rows<any>(db.from('messages').select('external_id, thread_external_id, author_external_id, text, sent_at, reply_to_external_id, mention_external_ids').order('sent_at').limit(5000)),
    rows<any>(db.from('imports').select('file_name, source, created_at, reference_time, labels, issues').eq('status', 'imported').order('created_at')),
    rows<any>(db.from('tasks').select('id, task_key, row_version, snapshot, manual_task')),
    rows<any>(db.from('reminder_drafts').select('snapshot')),
    rows<any>(db.from('human_decisions').select('payload').order('recorded_at')),
    rows<any>(db.from('followup_flows').select('definition').order('created_at')),
    rows<any>(db.from('settings').select('value').eq('key', 'app')),
    rows<any>(db.from('files').select('id, original_name, mime, size_bytes, sha256, created_at, uploader_profile_id, task_id').order('created_at', { ascending: false }).limit(500)),
    rows<any>(db.from('engine_runs').select('id, created_at, evaluated_at, trigger, status, counts, extractor').order('created_at', { ascending: false }).limit(50)),
  ])
  const latest = imports.at(-1)
  const ref = imports.filter((i) => i.reference_time).at(-1)?.reference_time
  const data: Dataset = {
    people: people.map((p) => ({ id: p.external_id, name: p.name, timezone: p.timezone, role: p.role, ...(p.team_key ? { teamId: p.team_key } : {}) })),
    threads: threads.map((t) => ({ id: t.external_id, ...(t.title ? { title: t.title } : {}) })),
    messages: messages.map((m) => ({
      id: m.external_id,
      threadId: m.thread_external_id,
      authorId: m.author_external_id,
      sentAt: new Date(m.sent_at).toISOString(),
      text: m.text,
      ...(m.reply_to_external_id ? { replyToId: m.reply_to_external_id } : {}),
      ...(m.mention_external_ids?.length ? { mentionIds: m.mention_external_ids } : {}),
    })),
    labels: imports.flatMap((i) => (i.labels ?? []) as CommitmentLabel[]),
    ...(ref ? { referenceTime: new Date(ref).toISOString() } : {}),
  }
  const taskById = new Map(tasks.map((t) => [t.id as string, t.task_key as string]))
  const org = { ...DEFAULT_ORG, ...(settings[0]?.value ?? {}) }
  const taskRuns: RunRecord[] = runs.map((r) => ({
    id: r.id,
    at: r.created_at,
    evaluatedAt: r.evaluated_at,
    mode: r.extractor,
    dataset: latest?.file_name ?? orgName,
    commitments: r.counts?.commitments ?? 0,
    openOverdue: r.counts?.overdue ?? 0,
    drafts: r.counts?.drafts ?? 0,
    checks: [],
  }))
  return {
    dataset: {
      id: 'current',
      name: latest?.file_name ?? orgName,
      source: latest?.source ?? 'import',
      loadedAt: latest?.created_at ?? new Date(0).toISOString(),
      data,
      issues: latest?.issues ?? [],
    },
    tasks,
    drafts: drafts.map((d) => d.snapshot as Draft),
    decisions: decisions.map((d) => d.payload as HumanDecision),
    flows: flows.map((f) => f.definition as Flow),
    org: { ...org, flags: { ...DEFAULT_FLAGS, ...org.flags } },
    files: files.map((f) => ({ id: f.id, name: f.original_name, mime: f.mime, size: f.size_bytes, sha256: f.sha256, uploadedAt: f.created_at, uploadedBy: f.uploader_profile_id, linkedTo: f.task_id ? taskById.get(f.task_id) : undefined })),
    runs: taskRuns,
    lastRun: runs[0] ? { at: runs[0].created_at, evaluatedAt: runs[0].evaluated_at, trigger: runs[0].trigger, status: runs[0].status, counts: runs[0].counts ?? {} } : null,
    mode: (runs[0]?.extractor as EngineModeLabel) ?? 'Rules',
  }
}

function useLiveClock(): string {
  const [now, setNow] = useState(() => new Date().toISOString())
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date().toISOString()), 60_000)
    return () => window.clearInterval(id)
  }, [])
  return now
}

export function CloudEngineProvider({ children }: { children: ReactNode }) {
  const cloud = useCloud()!
  const me = cloud.me
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const live = useLiveClock()
  const timer = useRef<number | undefined>(undefined)
  const active = cloud.status === 'signed_in' && !!me && !me.profile.mustChangePassword

  // Load, then refetch whenever something changes (live update, focus, every 30 s as a fallback)
  useEffect(() => {
    if (!active) {
      setLoaded(null)
      return
    }
    let stale = false
    setLoading(true)
    load(me!.org.name)
      .then((l) => !stale && (setLoaded(l), setError(null)))
      .catch((e: Error) => !stale && setError(`Could not load the workspace: ${e.message}`))
      .finally(() => !stale && setLoading(false))
    return () => {
      stale = true
    }
  }, [active, cloud.version, me])

  useEffect(() => {
    if (!active) return
    const db = supabase()
    const refetch = () => {
      window.clearTimeout(timer.current)
      timer.current = window.setTimeout(cloud.bump, 400)
    }
    const channel = db.channel(`org-${me!.org.id}`)
    for (const table of LIVE_TABLES) channel.on('postgres_changes', { event: '*', schema: 'public', table }, refetch)
    channel.subscribe()
    const onFocus = () => document.visibilityState === 'visible' && refetch()
    document.addEventListener('visibilitychange', onFocus)
    const poll = window.setInterval(refetch, 30_000)
    // Reviewers keep the engine current: overdue checks move with the clock
    const engine = me!.profile.role !== 'member' ? window.setInterval(() => void callApi('engine/run', { trigger: 'interval' }).then(refetch), 5 * 60_000) : undefined
    return () => {
      void db.removeChannel(channel)
      document.removeEventListener('visibilitychange', onFocus)
      window.clearInterval(poll)
      window.clearInterval(engine)
      window.clearTimeout(timer.current)
    }
  }, [active, me, cloud.bump])

  const value = useMemo<EngineState>(() => {
    const org = loaded?.org ?? DEFAULT_ORG
    const dataset = loaded?.dataset ?? null
    // The server sends the data clock, so members (who see only part of the data) use the same time as reviewers
    const now = org.clockMode === 'dataset' && me?.dataClock ? me.dataClock : evaluationTime(org, dataset && (dataset.data.messages.length || dataset.data.referenceTime) ? dataset : null, live)
    const commitments = (loaded?.tasks ?? []).map((t) => t.snapshot).filter((c): c is Commitment => !!c)
    const drafts = loaded?.drafts ?? []
    const result = { runAt: now, mode: loaded?.mode ?? 'Rules', commitments, drafts, issues: [] }
    const people = new Map((dataset?.data.people ?? []).map((p) => [p.id, p]))
    const byId = new Map(commitments.map((c) => [c.id, c]))
    const draftBy = new Map(drafts.map((d) => [d.commitmentId, d]))
    const settings: AppSettings = { userName: me?.profile.fullName ?? '', profileId: me?.profile.personId ?? null, clockMode: org.clockMode, customNow: org.customNow, flags: org.flags, staleAfterHours: org.staleAfterHours }
    return {
      ready: !!loaded,
      ai: { state: 'off' },
      dataset,
      settings,
      now,
      config: makeConfig(now, { flags: org.flags, staleAfterHours: org.staleAfterHours, flows: loaded?.flows.length ? loaded.flows : undefined }),
      result,
      scorecard: evaluate(commitments, drafts, dataset?.data.labels ?? [], now),
      user: me ? { ...me.person, ...(people.get(me.person.id) ?? {}), role: me.person.role } : null,
      people,
      flows: loaded?.flows ?? [],
      decisions: loaded?.decisions ?? [],
      tasks: (loaded?.tasks ?? []).map((t) => t.manual_task).filter((t): t is ManualTask => !!t),
      commitment: (id) => byId.get(id),
      draftFor: (id) => draftBy.get(id),
    }
  }, [loaded, live, me])

  const data = useMemo<CloudData | null>(
    () =>
      me
        ? {
            orgId: me.org.id,
            orgName: me.org.name,
            taskRows: new Map((loaded?.tasks ?? []).map((t) => [t.task_key, { id: t.id, rowVersion: t.row_version }])),
            files: loaded?.files ?? [],
            runs: loaded?.runs ?? [],
            lastRun: loaded?.lastRun ?? null,
            orgSettings: loaded?.org ?? DEFAULT_ORG,
            loading,
            error,
            reload: cloud.bump,
          }
        : null,
    [me, loaded, loading, error, cloud.bump],
  )

  return (
    <CloudDataContext.Provider value={data}>
      <EngineContext.Provider value={value}>{children}</EngineContext.Provider>
    </CloudDataContext.Provider>
  )
}
