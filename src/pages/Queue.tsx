import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Button, Card, Dialog, EmptyState, Select, StatusChip, Tabs, Textarea } from '../components/ui'
import { Notice, PageHeader, useActionNotice } from '../components/domain/parts'
import { SUPPRESSION_LABEL, draftStateView, personName, shortTime } from '../components/domain/view'
import { checkBeforeApproval, draftText, MAX_DRAFT_BODY, recipientWarnings } from '../engine/approval'
import { isSnoozed } from '../engine/drafts'
import { SnoozeDialog } from '../components/domain/SnoozeDialog'
import type { ActionResult } from '../store/actions'
import type { Draft } from '../engine/types'
import { useActions, useEngine } from '../store'

type Notice = ReturnType<typeof useActionNotice>

function DraftCard({ draft, notice }: { draft: Draft; notice: Notice }) {
  const { commitment, people, config, dataset, now, user, flows } = useEngine()
  const actions = useActions()
  const [showHistory, setShowHistory] = useState(false)
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(draftText(draft))
  const [rejecting, setRejecting] = useState(false)
  const [reason, setReason] = useState('')
  const [snoozing, setSnoozing] = useState(false)
  const c = commitment(draft.commitmentId)
  const isCoordinator = user?.role === 'coordinator'
  const snoozed = isSnoozed(draft, now)
  const canRegenerate = isCoordinator && ['pending_review', 'rejected', 'stale'].includes(draft.state) && !snoozed
  const snooze = async (until: string, why: string) => {
    let res: ActionResult = { ok: false, message: 'Not saved' }
    await notice.run(async () => (res = await actions.snooze(draft.id, until, why)))
    return res
  }
  const check = checkBeforeApproval(draft, c, config, people)
  const warnings = dataset ? recipientWarnings(draft, c, dataset.data, now) : []
  const view = draftStateView(draft, now)
  const flow = flows.find((f) => f.id === draft.flowId)
  const recipient = people.get(draft.recipientId ?? '')

  return (
    <Card id={draft.id} className="scroll-mt-20">
      <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
        <div>
          {c ? (
            <Link to={`/commitments/${c.id}`} className="font-medium text-text-primary hover:text-accent">
              {c.title}
            </Link>
          ) : (
            <span className="text-text-muted">{draft.commitmentId}</span>
          )}
          <p className="text-xs text-text-faint">
            {draft.kind === 'clarify' ? 'Ask for a firm date' : 'Reminder'} · version {draft.version}
            {flow ? ` · ${flow.name}, step ${(draft.step ?? 0) + 1} (${flow.steps[draft.step ?? 0]?.tone ?? ''})` : ''} · updated {shortTime(draft.updatedAt)}
          </p>
        </div>
        <StatusChip status={view.key} label={view.label} />
      </div>

      <div className="mb-3 rounded-md border border-surface-border bg-surface p-3">
        <p className="mb-1 text-xs text-text-faint">
          To: <span className="text-text-primary">{recipient ? `${recipient.name} (${recipient.timezone})` : 'Unknown'}</span>
          {draft.recipientRole && draft.recipientRole !== 'owner' ? ` · escalation to ${draft.recipientRole}` : ''}
        </p>
        {draft.subject ? <p className="mb-1 text-sm font-medium text-text-primary">{draft.subject}</p> : null}
        {editing ? (
          <div className="flex flex-col gap-2">
            <Textarea label="Draft text" value={text} onChange={(e) => setText(e.target.value)} maxLength={MAX_DRAFT_BODY} hint={`${text.trim().length} of ${MAX_DRAFT_BODY} characters`} />
            <div className="flex gap-2">
              <Button
                size="sm"
                disabled={!text.trim() || notice.busy}
                onClick={() =>
                  notice.run(async () => {
                    const res = await actions.edit(draft.id, text)
                    if (res.ok) setEditing(false)
                    return res
                  })
                }
              >
                Save text
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setText(draftText(draft))
                  setEditing(false)
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <p className="text-sm text-text-muted">{draftText(draft)}</p>
        )}
        {draft.editedBody && !editing ? <p className="mt-1 text-xs text-status-tentative">Edited by {personName(people, draft.editedBy)}</p> : null}
      </div>

      {draft.suppression ? (
        <p className="mb-2 text-sm text-status-deferred">
          Suppressed: {SUPPRESSION_LABEL[draft.suppression.reason]}
          {draft.suppression.evidence?.messageId ? ` (evidence ${draft.suppression.evidence.messageId}: "${draft.suppression.evidence.quote}")` : ''}
        </p>
      ) : null}
      {draft.state === 'rejected' ? (
        <p className="mb-2 text-sm text-status-cancelled">
          Rejected by {personName(people, draft.rejectedBy)}: {draft.rejectReason}
        </p>
      ) : null}

      {snoozed ? (
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2 rounded-md border border-surface-border p-2 text-sm">
          <p className="text-text-muted">
            Snoozed until <span className="text-text-primary">{shortTime(draft.snoozedUntil!)}</span> by {personName(people, draft.snoozedBy)}
            {draft.snoozeReason ? `: ${draft.snoozeReason}` : ''}
          </p>
          {isCoordinator ? (
            <Button size="sm" variant="secondary" disabled={notice.busy} onClick={() => notice.run(() => actions.unsnooze(draft.id))}>
              Wake now
            </Button>
          ) : null}
        </div>
      ) : null}

      {draft.state === 'pending_review' && !snoozed ? (
        <>
          {warnings.length > 0 ? (
            <ul className="mb-2 list-disc pl-5 text-xs text-status-tentative">
              {warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          ) : null}
          <label className="mb-2 flex items-center gap-2 text-sm text-text-primary">
            <input
              type="checkbox"
              checked={draft.recipientConfirmed}
              disabled={!isCoordinator}
              onChange={(e) => notice.run(() => actions.confirmRecipient(draft.id, e.target.checked))}
              className="size-4 accent-[var(--color-accent)]"
            />
            I checked this goes to the right person
          </label>
          {!check.ok ? (
            <ul className="mb-2 text-xs text-text-muted">
              {check.blockers.map((b, i) => (
                <li key={i}>• {b.message}</li>
              ))}
            </ul>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={!isCoordinator || (!check.ok && !check.suppressWith) || notice.busy} onClick={() => notice.run(() => actions.approve(draft.id))}>
              {check.suppressWith ? 'Re-check and suppress' : 'Approve'}
            </Button>
            {isCoordinator ? (
              <>
                <Button size="sm" variant="secondary" disabled={editing}
                  onClick={() => {
                    setText(draftText(draft))
                    setEditing(true)
                  }}
                >
                  Edit
                </Button>
                <Button size="sm" variant="secondary" onClick={() => setSnoozing(true)}>
                  Snooze
                </Button>
                <Button size="sm" variant="ghost" title="Dismiss this draft. It stays rejected until the work changes and a new version is written." onClick={() => setRejecting(true)}>
                  Reject
                </Button>
              </>
            ) : (
              <span className="self-center text-xs text-text-faint">Only a coordinator can approve</span>
            )}
          </div>
        </>
      ) : null}

      {canRegenerate ? (
        <Button size="sm" variant="ghost" className="mt-2" disabled={notice.busy || editing} onClick={() => notice.run(() => actions.regenerate(draft.id))}>
          Regenerate text
        </Button>
      ) : null}

      {draft.history.length > 1 || showHistory ? (
        <button type="button" className="mt-3 text-xs text-accent hover:underline" onClick={() => setShowHistory((v) => !v)}>
          {showHistory ? 'Hide' : 'Show'} version history ({draft.history.length})
        </button>
      ) : null}
      {showHistory ? (
        <ol className="mt-2 flex flex-col gap-2 text-xs">
          {draft.history.map((h) => (
            <li key={h.version} className="rounded-md border border-surface-border p-2">
              <p className="text-text-faint">
                v{h.version} · {h.cause.replace(/_/g, ' ')} · {shortTime(h.at)} · due {h.dueAt ? shortTime(h.dueAt) : 'none'} · to {personName(people, h.recipientId)}
              </p>
              <p className="text-text-muted">{h.body}</p>
            </li>
          ))}
        </ol>
      ) : null}

      {snoozing ? <SnoozeDialog open onClose={() => setSnoozing(false)} now={now} busy={notice.busy} onSnooze={snooze} /> : null}
      <Dialog open={rejecting} onClose={() => setRejecting(false)} title="Reject (dismiss) this draft" variant="modal">
        <div className="flex flex-col gap-3">
          <Textarea label="Reason (kept in the audit log)" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="For example: wrong tone for this client" />
          <div className="flex gap-2">
            <Button
              variant="danger"
              disabled={!reason.trim() || notice.busy}
              onClick={() =>
                notice.run(async () => {
                  const res = await actions.reject(draft.id, reason)
                  if (res.ok) {
                    setRejecting(false)
                    setReason('')
                  }
                  return res
                })
              }
            >
              Reject draft
            </Button>
            <Button variant="ghost" onClick={() => setRejecting(false)}>
              Keep it
            </Button>
          </div>
        </div>
      </Dialog>
    </Card>
  )
}

function Lane({ drafts, empty, notice }: { drafts: Draft[]; empty: string; notice: Notice }) {
  if (drafts.length === 0) return <EmptyState title={empty} />
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      {drafts.map((d) => (
        <DraftCard key={d.id} draft={d} notice={notice} />
      ))}
    </div>
  )
}

export default function Queue() {
  const { result, user, scorecard, people, commitment, now } = useEngine()
  const notice = useActionNotice()
  const [owner, setOwner] = useState('')
  const [due, setDue] = useState<'all' | 'overdue' | 'week'>('all')
  const mine = user?.role === 'coordinator' ? result.drafts : result.drafts.filter((d) => d.recipientId === user?.id)
  // Filters: whose task it is, and how close the deadline is
  const visible = mine.filter((d) => {
    const c = commitment(d.commitmentId)
    if (owner && c?.ownerId !== owner) return false
    const dueAt = c?.deadline.dueAt ? Date.parse(c.deadline.dueAt) : null
    if (due === 'overdue' && !(dueAt && dueAt < Date.parse(now))) return false
    if (due === 'week' && !(dueAt && dueAt < Date.parse(now) + 7 * 86_400_000)) return false
    return true
  })
  const by = (states: Draft['state'][], kind?: Draft['kind']) => visible.filter((d) => states.includes(d.state) && (!kind || d.kind === kind))
  // Snoozed drafts wait in their own tab and come back to review when the evaluation clock passes their wake-up time
  const awake = (list: Draft[]) => list.filter((d) => !isSnoozed(d, now))
  const reminders = awake(by(['pending_review'], 'reminder'))
  const clarify = awake(by(['pending_review'], 'clarify'))
  const snoozedList = by(['pending_review']).filter((d) => isSnoozed(d, now))
  const closedCheck = scorecard.checks.find((c) => c.name === 'zero_wrong_reminders')
  const activeOnClosed = closedCheck?.pass ? 0 : Number(/^(\d+)/.exec(closedCheck?.detail ?? '')?.[1] ?? 0)

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Draft queue"
        description="One draft per commitment. Deadline or owner changes update the same draft as a new version. Approving re-checks freshness first; approved reminders appear inside FollowThru only."
      />
      <p className={activeOnClosed === 0 ? 'mb-3 text-sm text-status-done' : 'mb-3 text-sm text-status-overdue'}>
        {activeOnClosed} active reminders for completed, cancelled or deferred work
      </p>
      <div className="mb-4 flex flex-wrap gap-3">
        <Select label="Owner" value={owner} onChange={(e) => setOwner(e.target.value)}>
          <option value="">Everyone</option>
          {[...people.values()].map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
        <Select label="Deadline" value={due} onChange={(e) => setDue(e.target.value as typeof due)}>
          <option value="all">Any deadline</option>
          <option value="overdue">Already overdue</option>
          <option value="week">Due within 7 days</option>
        </Select>
      </div>
      <div className="mb-3" aria-live="polite">
        <Notice result={notice.result} />
      </div>
      <Tabs
        items={[
          { value: 'review', label: `Needs review (${reminders.length})`, content: <Lane drafts={reminders} empty="No reminders waiting for review" notice={notice} /> },
          { value: 'clarify', label: `Needs clarification (${clarify.length})`, content: <Lane drafts={clarify} empty="No tentative deadlines to confirm" notice={notice} /> },
          { value: 'snoozed', label: `Snoozed (${snoozedList.length})`, content: <Lane drafts={snoozedList} empty="Nothing snoozed" notice={notice} /> },
          { value: 'approved', label: `Approved (${by(['approved']).length})`, content: <Lane drafts={by(['approved'])} empty="Nothing approved yet" notice={notice} /> },
          { value: 'stale', label: `Stale (${by(['stale']).length})`, content: <Lane drafts={by(['stale'])} empty="No stale drafts" notice={notice} /> },
          { value: 'suppressed', label: `Suppressed (${by(['suppressed']).length})`, content: <Lane drafts={by(['suppressed'])} empty="Nothing suppressed" notice={notice} /> },
          { value: 'rejected', label: `Rejected (${by(['rejected']).length})`, content: <Lane drafts={by(['rejected'])} empty="Nothing rejected" notice={notice} /> },
        ]}
      />
    </div>
  )
}
