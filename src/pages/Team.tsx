import { type FormEvent, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button, Card, CardHeader, CardTitle, EmptyState, Input, Select, StatusChip } from '../components/ui'
import { CommitmentLink, CommitmentStatus, DeadlineText, Notice, PageHeader, useActionNotice, viewerTimezone } from '../components/domain/parts'
import { PROGRESS_LABEL, personName, shortTime } from '../components/domain/view'
import { useActions, useEngine } from '../store'

function AssignForm() {
  const { people } = useEngine()
  const actions = useActions()
  const notice = useActionNotice()
  const [title, setTitle] = useState('')
  const [target, setTarget] = useState('')
  const [due, setDue] = useState('')
  const teams = [...new Set([...people.values()].map((p) => p.teamId).filter(Boolean))] as string[]

  async function submit(event: FormEvent) {
    event.preventDefault()
    const isTeam = target.startsWith('team:')
    const teamId = isTeam ? target.slice(5) : undefined
    const ownerIds = isTeam ? [...people.values()].filter((p) => p.teamId === teamId).map((p) => p.id) : target ? [target] : []
    await notice.run(async () => {
      const res = await actions.createTasks({ title, ownerIds, teamId, dueAt: due ? new Date(due).toISOString() : null })
      if (res.ok) {
        setTitle('')
        setDue('')
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
        <label className="flex flex-col gap-1.5 text-sm font-medium text-text-primary">
          Deadline (your time, optional)
          <input type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} className="h-10 rounded-md border border-surface-border bg-surface px-3 text-sm [color-scheme:dark]" />
        </label>
        <Button type="submit" disabled={notice.busy}>
          Assign
        </Button>
        <Notice result={notice.result} />
      </form>
    </Card>
  )
}

export default function Team() {
  const { result, user, people, now } = useEngine()
  const tz = viewerTimezone()
  const isCoordinator = user?.role === 'coordinator'
  const mine = result.commitments.filter((c) => c.ownerId === user?.id)
  const pendingSubmissions = result.commitments.flatMap((c) => (c.submissions ?? []).filter((s) => s.state === 'pending').map((s) => ({ c, s })))
  const blockers = result.commitments.flatMap((c) => (c.blockers ?? []).filter((b) => !b.resolved).map((b) => ({ c, b })))

  return (
    <div className="mx-auto max-w-6xl">
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
