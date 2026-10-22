import { type FormEvent, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { Button, Card, CardHeader, CardTitle, EmptyState, Input, Select, StatusChip, Textarea } from '../components/ui'
import { CommitmentLink, CommitmentStatus, DeadlineText, Notice, PageHeader, useActionNotice, viewerTimezone } from '../components/domain/parts'
import { PROGRESS_LABEL, personName, shortTime, statusView } from '../components/domain/view'
import { useActions, useEngine } from '../store'

function AssignForm() {
  const { people } = useEngine()
  const actions = useActions()
  const notice = useActionNotice()
  const [title, setTitle] = useState('')
  const [target, setTarget] = useState('')
  const [start, setStart] = useState('')
  const [due, setDue] = useState('')
  const [description, setDescription] = useState('')
  const [priority, setPriority] = useState<'low' | 'normal' | 'high' | 'critical'>('normal')
  const teams = [...new Set([...people.values()].map((p) => p.teamId).filter(Boolean))] as string[]

  async function submit(event: FormEvent) {
    event.preventDefault()
    const isTeam = target.startsWith('team:')
    const teamId = isTeam ? target.slice(5) : undefined
    const ownerIds = isTeam ? [...people.values()].filter((p) => p.teamId === teamId).map((p) => p.id) : target ? [target] : []
    await notice.run(async () => {
      if (start && due && new Date(due) < new Date(start)) return { ok: false, message: 'The end date and time must not be earlier than the start' }
      const res = await actions.createTasks({
        title,
        ownerIds,
        teamId,
        startAt: start ? new Date(start).toISOString() : null,
        dueAt: due ? new Date(due).toISOString() : null,
        description: description.trim() || undefined,
        priority,
      })
      if (res.ok) {
        setTitle('')
        setStart('')
        setDue('')
        setDescription('')
      }
      return res
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Assign a task</CardTitle>
      </CardHeader>
      <form onSubmit={submit} className="flex flex-col gap-3" noValidate>
        <Input label="Task" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Prepare the launch FAQ" />
        <Select label="Assign to" value={target} onChange={(e) => setTarget(e.target.value)} hint="A team assignment creates one task for each member.">
          <option value="">Choose a person or team…</option>
          <optgroup label="Teams">
            {teams.map((t) => (
              <option key={t} value={`team:${t}`}>
                Whole team: {t}
              </option>
            ))}
          </optgroup>
          <optgroup label="People">
            {[...people.values()].map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </optgroup>
        </Select>
        <Textarea label="Description (optional)" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What done looks like, links, instructions" />
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1.5 text-sm font-medium text-text-primary">
            Start Date &amp; Time
            <input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} className="h-10 w-full min-w-0 rounded-xl border border-surface-border bg-white/[0.04] px-3 text-sm [color-scheme:dark]" />
          </label>
          <label className="flex flex-col gap-1.5 text-sm font-medium text-text-primary">
            End Date &amp; Time (deadline)
            <input type="datetime-local" value={due} min={start || undefined} onChange={(e) => setDue(e.target.value)} className="h-10 w-full min-w-0 rounded-xl border border-surface-border bg-white/[0.04] px-3 text-sm [color-scheme:dark]" />
          </label>
        </div>
        <p className="-mt-1 text-xs text-text-faint">Times are in your timezone ({Intl.DateTimeFormat().resolvedOptions().timeZone}); each person sees them in their own time.</p>
        <Select label="Priority" value={priority} onChange={(e) => setPriority(e.target.value as typeof priority)}>
          <option value="low">Low</option>
          <option value="normal">Normal</option>
          <option value="high">High</option>
          <option value="critical">Critical</option>
        </Select>
        <Button type="submit" disabled={notice.busy}>
          Assign
        </Button>
        <Notice result={notice.result} />
      </form>
    </Card>
  )
}

function PeopleGrid() {
  const { result, people, now } = useEngine()
  return (
    <Card>
      <CardHeader>
        <CardTitle>People</CardTitle>
      </CardHeader>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="text-text-faint">
            <tr>
              <th className="p-2">Person</th>
              <th className="p-2">Team</th>
              <th className="p-2">Local time</th>
              <th className="p-2">Open</th>
              <th className="p-2">Overdue</th>
              <th className="p-2">Done</th>
              <th className="p-2">Blockers</th>
            </tr>
          </thead>
          <tbody>
            {[...people.values()].map((p) => {
              const items = result.commitments.filter((c) => c.ownerId === p.id)
              return (
                <tr key={p.id} className="border-t border-surface-border">
                  <td className="p-2 text-text-primary">
                    {p.name} <span className="text-text-faint">· {p.role ?? 'member'}</span>
                  </td>
                  <td className="p-2 capitalize">{p.teamId ?? '—'}</td>
                  <td className="p-2">
                    {new Intl.DateTimeFormat('en-GB', { timeZone: p.timezone, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(now))}
                    <span className="block text-text-faint">{p.timezone}</span>
                  </td>
                  <td className="p-2">{items.filter((c) => c.status === 'open').length}</td>
                  <td className="p-2 text-status-overdue">{items.filter((c) => statusView(c, now).key === 'overdue').length}</td>
                  <td className="p-2 text-status-done">{items.filter((c) => c.status === 'done').length}</td>
                  <td className="p-2">{items.flatMap((c) => c.blockers ?? []).filter((b) => !b.resolved).length}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </Card>
  )
}

export default function Team() {
  const { result, user, people, now } = useEngine()
  const location = useLocation()
  const redirectNotice = (location.state as { notice?: string } | null)?.notice
  const extensions = result.commitments.filter((c) => c.extensionRequest?.state === 'pending')
  const tz = viewerTimezone()
  const isCoordinator = user?.role === 'coordinator'
  const mine = result.commitments.filter((c) => c.ownerId === user?.id)
  const pendingSubmissions = result.commitments.flatMap((c) => (c.submissions ?? []).filter((s) => s.state === 'pending').map((s) => ({ c, s })))
  const blockers = result.commitments.flatMap((c) => (c.blockers ?? []).filter((b) => !b.resolved).map((b) => ({ c, b })))

  return (
    <div className="mx-auto max-w-6xl">
      {redirectNotice ? <p className="mb-3 rounded-md border border-status-tentative/40 px-3 py-2 text-sm text-status-tentative">{redirectNotice}</p> : null}
      <PageHeader title={isCoordinator ? 'Team' : 'My tasks'} description={isCoordinator ? 'Assign work, approve submissions and clear blockers.' : 'Update progress, report blockers and submit work for approval.'} />
      <div className="grid gap-4 lg:grid-cols-3">
        {isCoordinator ? (
          <div className="flex flex-col gap-4">
            <AssignForm />
          </div>
        ) : null}
        <div className={isCoordinator ? 'flex flex-col gap-4 lg:col-span-2' : 'flex flex-col gap-4 lg:col-span-3'}>
          {isCoordinator ? (
            <>
              <PeopleGrid />
              <Card>
                <CardHeader>
                  <CardTitle>More time requested ({extensions.length})</CardTitle>
                </CardHeader>
                {extensions.length === 0 ? (
                  <p className="text-sm text-text-muted">No requests waiting.</p>
                ) : (
                  <ul className="flex flex-col gap-2 text-sm">
                    {extensions.map((c) => (
                      <li key={c.id} className="flex flex-wrap justify-between gap-2 border-b border-surface-border pb-2">
                        <span>
                          <CommitmentLink c={c} />
                          <span className="block text-xs text-text-faint">
                            {personName(people, c.extensionRequest!.by)} asks for {shortTime(c.extensionRequest!.dueAt, tz)} (your time) · {c.extensionRequest!.note}
                          </span>
                        </span>
                        <Link to={`/commitments/${c.id}`} className="text-sm text-accent hover:underline">
                          Decide →
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle>Submissions waiting for approval ({pendingSubmissions.length})</CardTitle>
                </CardHeader>
                {pendingSubmissions.length === 0 ? (
                  <p className="text-sm text-text-muted">No submissions waiting.</p>
                ) : (
                  <ul className="flex flex-col gap-2 text-sm">
                    {pendingSubmissions.map(({ c, s }) => (
                      <li key={s.id} className="flex flex-wrap justify-between gap-2 border-b border-surface-border pb-2">
                        <span>
                          <CommitmentLink c={c} />
                          <span className="block text-xs text-text-faint">
                            {personName(people, s.by)} · {shortTime(s.at, tz)} · {s.note || 'No note'} · {s.fileIds.length} files
                          </span>
                        </span>
                        <Link to={`/commitments/${c.id}`} className="text-sm text-accent hover:underline">
                          Review →
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle>Open blockers ({blockers.length})</CardTitle>
                </CardHeader>
                {blockers.length === 0 ? (
                  <p className="text-sm text-text-muted">No blockers reported.</p>
                ) : (
                  <ul className="flex flex-col gap-2 text-sm">
                    {blockers.map(({ c, b }, i) => (
                      <li key={i} className="border-b border-surface-border pb-2">
                        <CommitmentLink c={c} />
                        <span className="block text-xs text-status-overdue">{b.text}</span>
                        <span className="block text-xs text-text-faint">
                          {personName(people, b.by)} · {shortTime(b.at, tz)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </>
          ) : null}
          <Card>
            <CardHeader>
              <CardTitle>{isCoordinator ? 'Assigned to you' : 'Your commitments and tasks'}</CardTitle>
            </CardHeader>
            {mine.length === 0 ? (
              <EmptyState title="Nothing assigned to you" />
            ) : (
              <ul className="flex flex-col divide-y divide-surface-border">
                {mine.map((c) => (
                  <li key={c.id} className="flex flex-wrap items-start justify-between gap-2 py-3">
                    <div>
                      <CommitmentLink c={c} />
                      <p className="text-xs text-text-faint">
                        {c.source === 'manual' ? 'Assigned task' : 'From conversation'} · {c.progress ? PROGRESS_LABEL[c.progress] : 'Not started'}
                        {c.progress === 'blocked' ? <StatusChip status="overdue" label="Blocked" className="ml-2" /> : null}
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-1 text-xs">
                      <CommitmentStatus c={c} now={now} />
                      <DeadlineText c={c} people={people} viewerTz={tz} now={now} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </div>
  )
}
