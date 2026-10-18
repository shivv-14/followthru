import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Copy, KeyRound, UserPlus } from 'lucide-react'
import { Button, Card, CardHeader, CardTitle, Dialog, EmptyState, Input, LoadingState, Select, StatusChip } from '../components/ui'
import { Notice, PageHeader } from '../components/domain/parts'
import { callApi } from '../cloud/api'
import { useCloud, type AccountRole } from '../cloud/session'
import type { ActionResult } from '../store'

interface Account {
  id: string
  full_name: string
  username: string
  email: string | null
  role: AccountRole
  timezone: string
  person_id: string
  is_active: boolean
  must_change_password: boolean
  last_login_at: string | null
  teams: string[]
}
interface Team {
  id: string
  team_key: string
  name: string
  description: string | null
  lead_profile_id: string | null
}
interface Person {
  external_id: string
  name: string
  timezone: string
  team_key: string | null
  linked_profile_id: string | null
}

const ROLE_LABEL: Record<AccountRole, string> = { coordinator: 'Coordinator / Team Lead', team_lead: 'Coordinator / Team Lead', member: 'Team member' }
const detected = Intl.DateTimeFormat().resolvedOptions().timeZone

/** Accounts and teams. Coordinators manage the workspace; team leads manage members of the teams they lead. */
export default function People() {
  const cloud = useCloud()!
  const me = cloud.me!
  const isCoordinator = me.profile.role === 'coordinator'
  const [data, setData] = useState<{ accounts: Account[]; teams: Team[]; people: Person[] } | null>(null)
  const [notice, setNotice] = useState<ActionResult | null>(null)
  const [secret, setSecret] = useState<{ who: string; username: string; password: string; handoff: string } | null>(null)
  const [creating, setCreating] = useState(false)

  const load = useCallback(async () => {
    const res = await callApi<{ accounts: Account[]; teams: Team[]; people: Person[] }>('accounts/list')
    if (res.ok) setData(res.data)
    else setNotice({ ok: false, message: res.error.message })
  }, [])
  useEffect(() => {
    void load()
  }, [load, cloud.version])

  const act = async (route: string, body: Record<string, unknown>) => {
    const res = await callApi<{ message: string; temporaryPassword?: string; handoff?: string }>(route, body)
    setNotice(res.ok ? { ok: true, message: res.data.message ?? 'Done' } : { ok: false, message: res.error.message })
    await load()
    return res
  }

  if (!data) return <LoadingState label="Loading accounts" />
  const unlinked = data.people.filter((p) => !p.linked_profile_id)
  const leadable = data.accounts.filter((a) => a.role !== 'member' && a.is_active)

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="People"
        description={isCoordinator ? 'Create accounts, hand over temporary passwords, manage teams and link accounts to people in the imported conversations.' : 'Members of the teams you lead.'}
        actions={
          <Button onClick={() => setCreating(true)}>
            <UserPlus size={16} aria-hidden /> New account
          </Button>
        }
      />
      <div className="mb-4">
        <Notice result={notice} />
      </div>
      <JoinRequests onChange={() => void load()} />

      <Card className="mb-4 overflow-x-auto p-0">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="text-xs text-text-faint">
            <tr>
              <th className="px-5 py-3">Person</th>
              <th className="px-3 py-3">Role</th>
              <th className="px-3 py-3">Teams</th>
              <th className="px-3 py-3">Status</th>
              <th className="px-3 py-3">Last sign-in</th>
              <th className="px-5 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {data.accounts.map((a) => (
              <tr key={a.id} className="border-t border-surface-border align-top">
                <td className="px-5 py-3">
                  <p className="font-medium">{a.full_name}</p>
                  <p className="text-xs text-text-faint">
                    @{a.username}
                    {a.email ? ` · ${a.email}` : ''} · {a.timezone}
                  </p>
                  {isCoordinator && a.id !== me.profile.id && unlinked.length > 0 ? (
                    <select
                      aria-label={`Link ${a.full_name} to a person in the conversations`}
                      className="mt-1 max-w-56 rounded-lg border border-surface-border bg-transparent px-2 py-1 text-xs text-text-muted [&>option]:bg-bg"
                      value=""
                      onChange={(e) => e.target.value && void act('accounts/link-person', { profileId: a.id, externalId: e.target.value })}
                    >
                      <option value="">Link to a person in the data…</option>
                      {unlinked.map((p) => (
                        <option key={p.external_id} value={p.external_id}>
                          {p.name} ({p.external_id})
                        </option>
                      ))}
                    </select>
                  ) : null}
                </td>
                <td className="px-3 py-3">
                  {isCoordinator && a.id !== me.profile.id ? (
                    <select
                      aria-label={`Role of ${a.full_name}`}
                      value={a.role}
                      onChange={(e) => void act('accounts/update', { profileId: a.id, role: e.target.value })}
                      className="rounded-lg border border-surface-border bg-transparent px-2 py-1 text-sm [&>option]:bg-bg"
                    >
                      <option value="member">Team member</option>
                      <option value="coordinator">Coordinator / Team Lead</option>
                      {a.role === 'team_lead' ? <option value="team_lead">Coordinator / Team Lead (team scope)</option> : null}
                    </select>
                  ) : (
                    ROLE_LABEL[a.role]
                  )}
                </td>
                <td className="px-3 py-3 text-text-muted">{a.teams.filter(Boolean).join(', ') || '—'}</td>
                <td className="px-3 py-3">
                  {!a.is_active ? <StatusChip status="cancelled" label="Disabled" /> : a.must_change_password ? <StatusChip status="tentative" label="Temporary password" /> : <StatusChip status="done" label="Active" />}
                </td>
                <td className="px-3 py-3 text-xs text-text-muted">{a.last_login_at ? new Date(a.last_login_at).toLocaleString() : 'Never'}</td>
                <td className="px-5 py-3">
                  {a.id !== me.profile.id ? (
                    <div className="flex justify-end gap-2">
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={async () => {
                          const res = await act('accounts/reset-password', { profileId: a.id })
                          if (res.ok && res.data.temporaryPassword) setSecret({ who: a.full_name, username: a.username, password: res.data.temporaryPassword, handoff: res.data.handoff ?? '' })
                        }}
                      >
                        <KeyRound size={14} aria-hidden /> Reset
                      </Button>
                      <Button size="sm" variant={a.is_active ? 'ghost' : 'secondary'} onClick={() => void act('accounts/set-active', { profileId: a.id, active: !a.is_active })}>
                        {a.is_active ? 'Disable' : 'Enable'}
                      </Button>
                    </div>
                  ) : (
                    <p className="text-right text-xs text-text-faint">You</p>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Teams teams={data.teams} accounts={data.accounts} leadable={leadable} isCoordinator={isCoordinator} ledTeams={me.ledTeams} act={act} />

      {isCoordinator && unlinked.length > 0 ? (
        <Card className="mt-4">
          <CardHeader>
            <CardTitle>People in the conversations without an account ({unlinked.length})</CardTitle>
          </CardHeader>
          <p className="mb-3 text-sm text-text-muted">Give someone an account so they see and update their own tasks. Their tasks link up automatically.</p>
          <ul className="flex flex-wrap gap-2">
            {unlinked.map((p) => (
              <li key={p.external_id} className="rounded-full border border-surface-border px-3 py-1 text-sm text-text-muted">
                {p.name} · {p.timezone}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <CreateAccount
        open={creating}
        onClose={() => setCreating(false)}
        teams={data.teams.filter((t) => isCoordinator || me.ledTeams.includes(t.team_key))}
        people={unlinked}
        isCoordinator={isCoordinator}
        onCreated={(s) => {
          setCreating(false)
          setSecret(s)
          void load()
        }}
      />

      <Dialog open={!!secret} onClose={() => setSecret(null)} title="First password" variant="modal">
        {secret ? (
          <div className="flex flex-col gap-3 text-sm">
            <p className="text-text-muted">
              For <strong className="text-white">{secret.who}</strong> (username <code>@{secret.username}</code>). Shown only now and not stored anywhere; they must change it when they first sign in.
            </p>
            <div className="flex items-center gap-2 rounded-2xl border border-surface-border bg-white/[0.04] p-3">
              <code className="flex-1 break-all font-mono text-base text-white">{secret.password}</code>
              <Button size="sm" variant="secondary" onClick={() => void navigator.clipboard?.writeText(secret.password)} aria-label="Copy password">
                <Copy size={14} aria-hidden />
              </Button>
            </div>
            <p className="text-xs text-text-faint">{secret.handoff}</p>
            <Button onClick={() => setSecret(null)}>I have handed it over</Button>
          </div>
        ) : null}
      </Dialog>
    </div>
  )
}

function CreateAccount({
  open,
  onClose,
  teams,
  people,
  isCoordinator,
  onCreated,
}: {
  open: boolean
  onClose: () => void
  teams: Team[]
  people: Person[]
  isCoordinator: boolean
  onCreated: (s: { who: string; username: string; password: string; handoff: string }) => void
}) {
  const [form, setForm] = useState({ fullName: '', username: '', email: '', role: 'member' as AccountRole, timezone: detected, personExternalId: '', team: teams[0]?.team_key ?? '' })
  const [error, setError] = useState('')
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }))

  async function submit(e: FormEvent) {
    e.preventDefault()
    const res = await callApi<{ temporaryPassword: string; handoff: string; account: { username: string; fullName: string } }>('accounts/create', {
      ...form,
      teamKeys: form.team ? [form.team] : [],
      personExternalId: form.personExternalId || undefined,
    })
    if (!res.ok) return setError(res.error.message)
    setError('')
    onCreated({ who: res.data.account.fullName, username: res.data.account.username, password: res.data.temporaryPassword, handoff: res.data.handoff })
    setForm((f) => ({ ...f, fullName: '', username: '', email: '', personExternalId: '' }))
  }

  return (
    <Dialog open={open} onClose={onClose} title="New account" variant="modal">
      <form onSubmit={submit} className="flex flex-col gap-3" noValidate>
        {isCoordinator && people.length > 0 ? (
          <Select
            label="Person in the conversations (optional)"
            value={form.personExternalId}
            onChange={(e) => {
              const p = people.find((x) => x.external_id === e.target.value)
              setForm((f) => ({ ...f, personExternalId: e.target.value, ...(p ? { fullName: p.name, timezone: p.timezone, team: p.team_key ?? f.team } : {}) }))
            }}
            hint="Links the account to their existing tasks"
          >
            <option value="">Someone new</option>
            {people.map((p) => (
              <option key={p.external_id} value={p.external_id}>
                {p.name}
              </option>
            ))}
          </Select>
        ) : null}
        <Input label="Full name" value={form.fullName} onChange={set('fullName')} />
        <Input label="Username" value={form.username} onChange={set('username')} hint={`They sign in with this. First password: ${form.username ? form.username.toLowerCase() + '1' : 'username + 1'} (they must change it)`} />
        <Input label="Email (optional)" type="email" value={form.email} onChange={set('email')} hint="Leave empty to sign in by username only" />
        <div className="grid gap-3 sm:grid-cols-2">
          <Select label="Role" value={form.role} onChange={set('role')} disabled={!isCoordinator}>
            <option value="member">Team member</option>
            {isCoordinator ? <option value="coordinator">Coordinator / Team Lead</option> : null}
          </Select>
          <Select label="Team" value={form.team} onChange={set('team')}>
            {isCoordinator ? <option value="">No team</option> : null}
            {teams.map((t) => (
              <option key={t.team_key} value={t.team_key}>
                {t.name}
              </option>
            ))}
          </Select>
        </div>
        <Input label="Timezone" value={form.timezone} onChange={set('timezone')} />
        {error ? (
          <p role="alert" className="text-sm text-status-overdue">
            {error}
          </p>
        ) : null}
        <Button type="submit">Create account</Button>
      </form>
    </Dialog>
  )
}

function Teams({
  teams,
  accounts,
  leadable,
  isCoordinator,
  ledTeams,
  act,
}: {
  teams: Team[]
  accounts: Account[]
  leadable: Account[]
  isCoordinator: boolean
  ledTeams: string[]
  act: (route: string, body: Record<string, unknown>) => Promise<unknown>
}) {
  const [draft, setDraft] = useState({ teamKey: '', name: '', leadProfileId: '' })
  const members = accounts.filter((a) => a.role === 'member' && a.is_active)
  const visible = teams.filter((t) => isCoordinator || ledTeams.includes(t.team_key))
  return (
    <Card>
      <CardHeader>
        <CardTitle>Teams</CardTitle>
      </CardHeader>
      {visible.length === 0 ? <EmptyState title="No teams yet" description="Teams group people for assignment, review and team leads." /> : null}
      <div className="grid gap-3 md:grid-cols-2">
        {visible.map((t) => {
          const inTeam = accounts.filter((a) => a.teams.includes(t.team_key))
          return (
            <div key={t.id} className="rounded-2xl border border-surface-border p-4">
              <p className="font-medium">
                {t.name} <span className="text-xs text-text-faint">({t.team_key})</span>
              </p>
              <p className="mb-2 text-xs text-text-faint">Lead: {accounts.find((a) => a.id === t.lead_profile_id)?.full_name ?? 'none'}</p>
              <ul className="mb-2 flex flex-wrap gap-1.5">
                {inTeam.map((a) => (
                  <li key={a.id} className="flex items-center gap-1 rounded-full bg-pill px-2.5 py-1 text-xs text-pill-text">
                    {a.full_name}
                    <button type="button" aria-label={`Remove ${a.full_name} from ${t.name}`} className="text-white/50 hover:text-white" onClick={() => void act('teams/members', { teamKey: t.team_key, remove: [a.id] })}>
                      ✕
                    </button>
                  </li>
                ))}
                {inTeam.length === 0 ? <li className="text-xs text-text-muted">No members</li> : null}
              </ul>
              <select
                aria-label={`Add a member to ${t.name}`}
                value=""
                onChange={(e) => e.target.value && void act('teams/members', { teamKey: t.team_key, add: [e.target.value] })}
                className="w-full rounded-lg border border-surface-border bg-transparent px-2 py-1.5 text-sm text-text-muted [&>option]:bg-bg"
              >
                <option value="">Add a member…</option>
                {members
                  .filter((a) => !a.teams.includes(t.team_key))
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.full_name}
                    </option>
                  ))}
              </select>
            </div>
          )
        })}
      </div>
      {isCoordinator ? (
        <form
          className="mt-4 grid items-end gap-3 sm:grid-cols-4"
          onSubmit={(e) => {
            e.preventDefault()
            void act('teams/save', draft).then(() => setDraft({ teamKey: '', name: '', leadProfileId: '' }))
          }}
        >
          <Input label="Team id" value={draft.teamKey} onChange={(e) => setDraft((d) => ({ ...d, teamKey: e.target.value }))} placeholder="design" />
          <Input label="Name" value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} placeholder="Design" />
          <Select label="Lead" value={draft.leadProfileId} onChange={(e) => setDraft((d) => ({ ...d, leadProfileId: e.target.value }))}>
            <option value="">No lead</option>
            {leadable.map((a) => (
              <option key={a.id} value={a.id}>
                {a.full_name}
              </option>
            ))}
          </Select>
          <Button type="submit" variant="secondary" disabled={!draft.teamKey || !draft.name}>
            Save team
          </Button>
        </form>
      ) : null}
      <p className="mt-3 text-xs text-text-faint">Saving with an existing team id updates that team. Imported people keep the team from the conversation data.</p>
    </Card>
  )
}

interface JoinRequest {
  id: string
  status: 'pending' | 'approved' | 'rejected'
  message: string | null
  created_at: string
  decided_at: string | null
  decision_reason: string | null
  profiles: { full_name: string; username: string; timezone: string } | null
}

/** People asking to join this workspace. Approving makes them a team member; both answers are saved and the person sees them. */
function JoinRequests({ onChange }: { onChange: () => void }) {
  const cloud = useCloud()!
  const [requests, setRequests] = useState<JoinRequest[]>([])
  const [notice, setNotice] = useState<ActionResult | null>(null)
  const [rejecting, setRejecting] = useState<JoinRequest | null>(null)
  const [reason, setReason] = useState('')
  const load = useCallback(async () => {
    const res = await callApi<{ requests: JoinRequest[] }>('workspaces/requests')
    if (res.ok) setRequests(res.data.requests)
  }, [])
  useEffect(() => {
    void load()
  }, [load, cloud.version])

  async function decide(r: JoinRequest, approve: boolean, why?: string) {
    const res = await callApi<{ message: string }>('workspaces/decide', { requestId: r.id, approve, reason: why })
    setNotice(res.ok ? { ok: true, message: res.data.message } : { ok: false, message: res.error.message })
    setRejecting(null)
    setReason('')
    await load()
    onChange()
  }

  const pending = requests.filter((r) => r.status === 'pending')
  if (requests.length === 0) return null
  return (
    <Card className="mb-4">
      <CardHeader>
        <CardTitle>Join requests ({pending.length} waiting)</CardTitle>
      </CardHeader>
      <Notice result={notice} />
      <ul className="flex flex-col gap-2">
        {requests.slice(0, 20).map((r) => (
          <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-surface-border p-3 text-sm">
            <div>
              <p className="font-medium">
                {r.profiles?.full_name ?? 'Someone'} <span className="text-text-faint">@{r.profiles?.username}</span>
              </p>
              <p className="text-xs text-text-faint">
                Asked {new Date(r.created_at).toLocaleString()}
                {r.message ? ` · "${r.message}"` : ''}
                {r.decided_at ? ` · ${r.status} ${new Date(r.decided_at).toLocaleString()}` : ''}
                {r.decision_reason ? ` · ${r.decision_reason}` : ''}
              </p>
            </div>
            {r.status === 'pending' ? (
              <div className="flex gap-2">
                <Button size="sm" onClick={() => void decide(r, true)}>
                  Approve
                </Button>
                <Button size="sm" variant="secondary" onClick={() => setRejecting(r)}>
                  Reject
                </Button>
              </div>
            ) : (
              <StatusChip status={r.status === 'approved' ? 'done' : 'cancelled'} label={r.status === 'approved' ? 'Approved' : 'Rejected'} />
            )}
          </li>
        ))}
      </ul>
      <Dialog open={!!rejecting} onClose={() => setRejecting(null)} title="Reject this request?" variant="modal">
        <div className="flex flex-col gap-3">
          <Input label="Reason (they will see it)" value={reason} onChange={(e) => setReason(e.target.value)} />
          <Button variant="danger" disabled={!reason.trim()} onClick={() => rejecting && void decide(rejecting, false, reason)}>
            Reject
          </Button>
        </div>
      </Dialog>
    </Card>
  )
}
