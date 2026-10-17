import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Button, Card, CardHeader, CardTitle, EmptyState, Select, StatusChip, Textarea } from '../components/ui'
import { CommitmentStatus, DeadlineText, Notice, PageHeader, useActionNotice, viewerTimezone } from '../components/domain/parts'
import { PROGRESS_LABEL, REVIEW_LABEL, SUPPRESSION_LABEL, draftStateView, personName, shortTime } from '../components/domain/view'
import type { DecisionType, TaskProgress } from '../engine/types'
import { useActions, useEngine, useEvidenceFiles } from '../store'

const EVENT_LABEL: Record<string, string> = {
  created: 'Created',
  accepted: 'Accepted',
  delegated: 'Owner changed',
  deadline_changed: 'Deadline changed',
  completed: 'Completed',
  cancelled: 'Cancelled',
  deferred: 'Deferred',
  reopened: 'Reopened',
  review_flagged: 'Flagged for review',
  human_decision: 'Coordinator decision',
}

export default function CommitmentDetail() {
  const { id = '' } = useParams<{ id: string }>()
  const { commitment, draftFor, people, now, user, dataset } = useEngine()
  const actions = useActions()
  const notice = useActionNotice()
  const files = useEvidenceFiles()
  const [note, setNote] = useState('')
  const [newOwner, setNewOwner] = useState('')
  const [newDue, setNewDue] = useState('')
  const [blocker, setBlocker] = useState('')
  const [submitNote, setSubmitNote] = useState('')
  const [submitFiles, setSubmitFiles] = useState<FileList | null>(null)
  const c = commitment(id)
  const tz = viewerTimezone()

  if (!c) {
    return <EmptyState title="Commitment not found" description="It may belong to data that was replaced." />
  }

  const draft = draftFor(c.id)
  const isCoordinator = user?.role === 'coordinator'
  const isOwner = user?.id === c.ownerId
  const messages = new Map((dataset?.data.messages ?? []).map((m) => [m.id, m]))
  const threadTitle = (tid: string) => dataset?.data.threads.find((t) => t.id === tid)?.title ?? tid

  const decide = (type: DecisionType, extra: Parameters<typeof actions.decide>[2] = {}) =>
    notice.run(async () => {
      const res = await actions.decide(c.id, type, { note: note.trim() || undefined, ...extra })
      if (res.ok) setNote('')
      return res
    })

  async function submitWork() {
    await notice.run(async () => {
      const fileIds: string[] = []
      for (const f of Array.from(submitFiles ?? [])) {
        const up = await actions.upload(f, c!.id)
        if (!up.ok) return up
        if (up.fileId) fileIds.push(up.fileId)
      }
      const res = await actions.decide(c!.id, 'submit_work', { note: submitNote.trim(), fileIds })
      if (res.ok) {
        setSubmitNote('')
        setSubmitFiles(null)
      }
      return res
    })
  }

  return (
    <div className="mx-auto max-w-5xl">
      <Link to="/commitments" className="mb-2 inline-block text-sm text-text-muted hover:text-text-primary">
        ← All commitments
      </Link>
      <PageHeader
        title={c.title}
        description={`${c.source === 'manual' ? 'Assigned task' : `Opened by message ${c.sourceMessageId}`} · requested by ${personName(people, c.requesterId)}`}
        actions={<CommitmentStatus c={c} now={now} />}
      />

      {c.needsReview ? (
        <div role="alert" className="mb-4 rounded-lg border border-status-tentative/40 bg-status-tentative/10 p-3 text-sm text-status-tentative">
          <p className="font-medium">Needs human review. No reminder is drafted while this is open, except a request for a firm date.</p>
          <ul className="mt-1 list-disc pl-5">
            {c.reviewReasons.map((r) => (
              <li key={r}>{REVIEW_LABEL[r]}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="flex flex-col gap-4 lg:col-span-2">
          <Card>
            <dl className="grid gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-xs text-text-faint">Owner</dt>
                <dd>{personName(people, c.ownerId)}</dd>
              </div>
              <div>
                <dt className="text-xs text-text-faint">Deadline</dt>
                <dd>
                  <DeadlineText c={c} people={people} viewerTz={tz} now={now} />
                  {c.deadline.phrase ? <span className="block text-xs text-text-faint">Said as "{c.deadline.phrase}", read in {c.deadline.interpretedTz}</span> : null}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-text-faint">Reply from owner</dt>
                <dd>{c.responseState === 'pending' ? 'Pending (silence does not change status)' : 'Responded'}</dd>
              </div>
              <div>
                <dt className="text-xs text-text-faint">Progress</dt>
                <dd>{c.progress ? PROGRESS_LABEL[c.progress] : '—'}</dd>
              </div>
            </dl>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Why? Evidence timeline</CardTitle>
            </CardHeader>
            <ol className="relative flex flex-col gap-4 border-l border-surface-border pl-4">
              {c.events.map((e, i) => (
                <li key={i}>
                  <p className="text-sm text-text-primary">
                    {EVENT_LABEL[e.type] ?? e.type}
                    {e.to && e.type === 'delegated' ? ` → ${personName(people, e.to)}` : ''}
                    {e.type === 'deadline_changed' ? ` → ${e.to ? shortTime(e.to, tz) : 'none'}` : ''}
                    {e.type === 'human_decision' && e.to ? ` → ${e.to}` : ''}
                  </p>
                  <p className="text-xs text-text-faint">
                    {shortTime(e.at, tz)} · {personName(people, e.by)}
                    {e.evidence?.messageId ? ` · ${e.evidence.messageId} in ${threadTitle(e.evidence.threadId)}` : ''} · rule {e.evidence?.rule}
                  </p>
                  {e.evidence?.quote ? <blockquote className="mt-1 border-l-2 border-accent/50 pl-2 text-xs text-text-muted">"{e.evidence.quote}"</blockquote> : null}
                </li>
              ))}
            </ol>
          </Card>

          {c.linkedMessageIds && c.linkedMessageIds.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>Linked messages</CardTitle>
              </CardHeader>
              <ul className="flex flex-col gap-2 text-sm">
                {c.linkedMessageIds.map((mid) => {
                  const m = messages.get(mid)
                  return m ? (
                    <li key={mid} className="rounded-md border border-surface-border p-2">
                      <p className="text-xs text-text-faint">
                        {mid} · {personName(people, m.authorId)} · {threadTitle(m.threadId)} · {shortTime(m.sentAt, people.get(m.authorId)?.timezone)} their time
                      </p>
                      <p className="text-text-muted">{m.text}</p>
                    </li>
                  ) : null
                })}
              </ul>
            </Card>
          ) : null}

          {(c.submissions?.length ?? 0) > 0 || (c.blockers?.length ?? 0) > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>Submissions and blockers</CardTitle>
              </CardHeader>
              <ul className="flex flex-col gap-2 text-sm">
                {c.blockers?.map((b, i) => (
                  <li key={`b${i}`} className="rounded-md border border-surface-border p-2">
                    <StatusChip status={b.resolved ? 'done' : 'overdue'} label={b.resolved ? 'Blocker resolved' : 'Blocker'} /> <span className="text-text-muted">{b.text}</span>
                    <span className="block text-xs text-text-faint">
                      {personName(people, b.by)} · {shortTime(b.at, tz)}
                    </span>
                  </li>
                ))}
                {c.submissions?.map((s) => (
                  <li key={s.id} className="rounded-md border border-surface-border p-2">
                    <StatusChip status={s.state === 'approved' ? 'done' : s.state === 'rejected' ? 'cancelled' : 'tentative'} label={`Submission ${s.state}`} />{' '}
                    <span className="text-text-muted">{s.note || 'No note'}</span>
                    <span className="block text-xs text-text-faint">
                      {personName(people, s.by)} · {shortTime(s.at, tz)}
                      {s.fileIds.length ? ` · files: ${s.fileIds.map((f) => files.find((x) => x.id === f)?.name ?? f).join(', ')}` : ''}
                    </span>
                    {isCoordinator && s.state === 'pending' ? (
                      <span className="mt-2 flex gap-2">
                        <Button size="sm" onClick={() => decide('approve_submission', { submissionId: s.id })}>
                          Approve work
                        </Button>
                        <Button size="sm" variant="secondary" onClick={() => decide('reject_submission', { submissionId: s.id })}>
                          Send back
                        </Button>
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
        </div>

        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Reminder draft</CardTitle>
              {draft ? <StatusChip status={draftStateView(draft).key} label={draftStateView(draft).label} /> : null}
            </CardHeader>
            {draft ? (
              <>
                <p className="mb-2 text-sm text-text-muted">{draft.body}</p>
                <p className="text-xs text-text-faint">
                  {draft.kind} · version {draft.version} · to {personName(people, draft.recipientId)}
                  {draft.suppression ? ` · ${SUPPRESSION_LABEL[draft.suppression.reason]}` : ''}
                </p>
                <Link to={`/queue#${draft.id}`} className="mt-2 inline-block text-sm text-accent hover:underline">
                  Review in queue →
                </Link>
              </>
            ) : (
              <p className="text-sm text-text-muted">No draft. {c.status !== 'open' ? 'Closed work is never chased.' : 'Not overdue yet, or waiting for review.'}</p>
            )}
          </Card>

          {isCoordinator ? (
            <Card>
              <CardHeader>
                <CardTitle>Coordinator actions</CardTitle>
              </CardHeader>
              <div className="flex flex-col gap-3">
                <Textarea label="Note (kept in the audit log)" value={note} onChange={(e) => setNote(e.target.value)} placeholder="For example: confirmed by phone" />
                {c.status === 'open' ? (
                  <div className="grid grid-cols-3 gap-2">
                    <Button size="sm" onClick={() => decide('mark_done')}>
                      Done
                    </Button>
                    <Button size="sm" variant="secondary" onClick={() => decide('defer')}>
                      Defer
                    </Button>
                    <Button size="sm" variant="danger" onClick={() => decide('cancel')}>
                      Cancel
                    </Button>
                  </div>
                ) : (
                  <Button size="sm" variant="secondary" onClick={() => decide('reopen')}>
                    Reopen
                  </Button>
                )}
                {c.needsReview ? (
                  <Button size="sm" variant="secondary" onClick={() => decide('resolve_review')}>
                    Mark reviewed
                  </Button>
                ) : null}
                <div className="flex items-end gap-2">
                  <div className="flex-1">
                    <Select label="Reassign to" value={newOwner} onChange={(e) => setNewOwner(e.target.value)}>
                      <option value="">Choose…</option>
                      {[...people.values()]
                        .filter((p) => p.id !== c.ownerId)
                        .map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                    </Select>
                  </div>
                  <Button size="sm" variant="secondary" disabled={!newOwner} onClick={() => decide('reassign', { ownerId: newOwner })}>
                    Save
                  </Button>
                </div>
                <div className="flex items-end gap-2">
                  <label className="flex flex-1 flex-col gap-1.5 text-sm font-medium text-text-primary">
                    New deadline (your time)
                    <input
                      type="datetime-local"
                      value={newDue}
                      onChange={(e) => setNewDue(e.target.value)}
                      className="h-10 rounded-md border border-surface-border bg-surface px-3 text-sm [color-scheme:dark]"
                    />
                  </label>
                  <Button size="sm" variant="secondary" disabled={!newDue} onClick={() => decide('change_deadline', { dueAt: new Date(newDue).toISOString() })}>
                    Save
                  </Button>
                </div>
                {c.blockers?.some((b) => !b.resolved) ? (
                  <Button size="sm" variant="secondary" onClick={() => decide('resolve_blocker')}>
                    Mark blockers resolved
                  </Button>
                ) : null}
              </div>
            </Card>
          ) : null}

          {isOwner && c.status === 'open' ? (
            <Card>
              <CardHeader>
                <CardTitle>Your update</CardTitle>
              </CardHeader>
              <div className="flex flex-col gap-3">
                <Select label="Progress" value={c.progress ?? 'not_started'} onChange={(e) => decide('set_progress', { progress: e.target.value as TaskProgress })}>
                  {(['not_started', 'in_progress'] as const).map((p) => (
                    <option key={p} value={p}>
                      {PROGRESS_LABEL[p]}
                    </option>
                  ))}
                  {c.progress && !['not_started', 'in_progress'].includes(c.progress) ? <option value={c.progress}>{PROGRESS_LABEL[c.progress]}</option> : null}
                </Select>
                <Textarea label="Report a blocker" value={blocker} onChange={(e) => setBlocker(e.target.value)} placeholder="What is stopping you?" />
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={!blocker.trim()}
                  onClick={() =>
                    notice.run(async () => {
                      const res = await actions.decide(c.id, 'report_blocker', { note: blocker.trim() })
                      if (res.ok) setBlocker('')
                      return res
                    })
                  }
                >
                  Report blocker
                </Button>
                <Textarea label="Submit work for approval" value={submitNote} onChange={(e) => setSubmitNote(e.target.value)} placeholder="What did you deliver?" />
                <input type="file" multiple onChange={(e) => setSubmitFiles(e.target.files)} aria-label="Attach files" className="text-xs text-text-muted" />
                <Button size="sm" onClick={submitWork} disabled={notice.busy}>
                  Submit for approval
                </Button>
              </div>
            </Card>
          ) : null}
          <Notice result={notice.result} />
        </div>
      </div>
    </div>
  )
}
