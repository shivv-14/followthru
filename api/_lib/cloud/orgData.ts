import { DEFAULT_FLAGS, DEFAULT_STALE_HOURS, makeConfig } from '../../../src/engine'
import type { CommitmentLabel, Dataset, Draft, EngineConfig, EngineFlags, Flow, HumanDecision, ManualTask, Message, Person, Thread } from '../../../src/engine/types'
import { evaluationTime } from '../../../src/store/clock'
import type { ClockMode } from '../../../src/store/db'
import { admin, selectAll } from './admin'

export interface OrgSettings {
  clockMode: ClockMode
  customNow: string | null
  flags: EngineFlags
  staleAfterHours: number
  /** Approved reminders are held back until quiet hours end in the recipient's timezone */
  quietHours: { start: string; end: string }
  skipWeekends: boolean
  /** Team for imported people without one (team-lead workspaces) */
  defaultTeamKey?: string
}

export const DEFAULT_ORG_SETTINGS: OrgSettings = {
  clockMode: 'dataset',
  customNow: null,
  flags: DEFAULT_FLAGS,
  staleAfterHours: DEFAULT_STALE_HOURS,
  quietHours: { start: '21:00', end: '09:00' },
  skipWeekends: true,
}

export interface StoredTask {
  id: string
  task_key: string
  source: 'conversation' | 'manual'
  owner_person: string | null
  owner_profile_id: string | null
  team_key: string | null
  row_version: number
  status: string
  snapshot: unknown
}

export interface StoredDraft {
  id: string
  draft_key: string
  task_key: string
  row_version: number
  version: number
  state: string
  snapshot: Draft
}

export interface OrgInput {
  orgId: string
  settings: OrgSettings
  dataset: Dataset
  datasetName: string | null
  decisions: HumanDecision[]
  manualTasks: ManualTask[]
  flows: Flow[]
  tasks: StoredTask[]
  drafts: StoredDraft[]
  /** person id -> profile id for people who have an account */
  profileByPerson: Map<string, string>
  now: string
  config: EngineConfig
}

export async function loadSettings(orgId: string): Promise<OrgSettings> {
  const { data } = await admin().from('settings').select('value').eq('org_id', orgId).eq('key', 'app').maybeSingle()
  const v = (data?.value ?? {}) as Partial<OrgSettings>
  return { ...DEFAULT_ORG_SETTINGS, ...v, flags: { ...DEFAULT_FLAGS, ...v.flags } }
}

/** Everything the engine needs for one organization, read with the service role and scoped by org_id. */
export async function loadOrgInput(orgId: string, liveNow = new Date().toISOString()): Promise<OrgInput> {
  const byOrg = (q: any) => q.eq('org_id', orgId)
  const [settings, people, threads, messages, imports, decisions, tasks, drafts, flows, profiles] = await Promise.all([
    loadSettings(orgId),
    selectAll<any>('external_people', 'external_id, name, timezone, role, team_key, email', byOrg),
    selectAll<any>('threads', 'external_id, title', byOrg),
    selectAll<any>('messages', 'external_id, thread_external_id, author_external_id, text, sent_at, reply_to_external_id, mention_external_ids', byOrg, 'sent_at'),
    selectAll<any>('imports', 'file_name, reference_time, labels, created_at', (q: any) => byOrg(q).eq('status', 'imported'), 'created_at'),
    selectAll<any>('human_decisions', 'payload, at, recorded_at', byOrg, 'recorded_at'),
    selectAll<StoredTask & { manual_task: ManualTask | null }>('tasks', 'id, task_key, source, owner_person, owner_profile_id, team_key, row_version, status, snapshot, manual_task', byOrg),
    selectAll<StoredDraft>('reminder_drafts', 'id, draft_key, task_key, row_version, version, state, snapshot', byOrg),
    selectAll<any>('followup_flows', 'definition', byOrg, 'created_at'),
    selectAll<any>('profiles', 'id, person_id', byOrg),
  ])

  const latest = imports.at(-1)
  const dataset: Dataset = {
    referenceTime: imports.filter((i: any) => i.reference_time).at(-1)?.reference_time ? new Date(imports.filter((i: any) => i.reference_time).at(-1).reference_time).toISOString() : undefined,
    people: people.map(
      (p: any): Person => ({ id: p.external_id, name: p.name, timezone: p.timezone, role: p.role, ...(p.team_key ? { teamId: p.team_key } : {}), ...(p.email ? { email: p.email } : {}) }),
    ),
    threads: threads.map((t: any): Thread => ({ id: t.external_id, ...(t.title ? { title: t.title } : {}) })),
    messages: messages.map(
      (m: any): Message => ({
        id: m.external_id,
        threadId: m.thread_external_id,
        authorId: m.author_external_id,
        sentAt: new Date(m.sent_at).toISOString(),
        text: m.text,
        ...(m.reply_to_external_id ? { replyToId: m.reply_to_external_id } : {}),
        ...(m.mention_external_ids?.length ? { mentionIds: m.mention_external_ids } : {}),
      }),
    ),
    labels: imports.flatMap((i: any) => (i.labels ?? []) as CommitmentLabel[]),
  }
  if (!dataset.referenceTime) delete dataset.referenceTime

  // Decisions in the order they were made (the engine also sorts by at, then recordedAt)
  const decisionList = decisions.map((d: any) => d.payload as HumanDecision)
  const manualTasks = tasks.filter((t) => t.source === 'manual' && t.manual_task).map((t) => t.manual_task as ManualTask)
  const flowList = flows.map((f: any) => f.definition as Flow)
  const now = evaluationTime(settings, dataset.messages.length || dataset.referenceTime ? { data: dataset } : null, liveNow)

  return {
    orgId,
    settings,
    dataset,
    datasetName: latest?.file_name ?? null,
    decisions: decisionList,
    manualTasks,
    flows: flowList,
    tasks,
    drafts,
    profileByPerson: new Map(profiles.map((p: any) => [p.person_id as string, p.id as string])),
    now,
    config: makeConfig(now, { flags: settings.flags, staleAfterHours: settings.staleAfterHours, flows: flowList.length ? flowList : undefined }),
  }
}
