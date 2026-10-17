import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Button, Card, EmptyState, StatusChip, Tabs } from '../components/ui'
import { Notice, PageHeader, useActionNotice } from '../components/domain/parts'
import { SUPPRESSION_LABEL, draftStateView, personName, shortTime } from '../components/domain/view'
import { checkBeforeApproval, recipientWarnings } from '../engine/approval'
import type { Draft } from '../engine/types'
import { useActions, useEngine } from '../store'

type Notice = ReturnType<typeof useActionNotice>

function DraftCard({ draft, notice }: { draft: Draft; notice: Notice }) {
  const { commitment, people, config, dataset, now, user, flows } = useEngine()
  const actions = useActions()
  const [showHistory, setShowHistory] = useState(false)
  const c = commitment(draft.commitmentId)
  const check = checkBeforeApproval(draft, c, config, people)
  const warnings = dataset ? recipientWarnings(draft, c, dataset.data, now) : []
  const isCoordinator = user?.role === 'coordinator'
  const view = draftStateView(draft)
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
        </p>
        {draft.subject ? <p className="mb-1 text-sm font-medium text-text-primary">{draft.subject}</p> : null}
        <p className="text-sm text-text-muted">{draft.body}</p>
      </div>

      {draft.suppression ? (
        <p className="mb-2 text-sm text-status-deferred">
          Suppressed: {SUPPRESSION_LABEL[draft.suppression.reason]}
          {draft.suppression.evidence?.messageId ? ` (evidence ${draft.suppression.evidence.messageId}: "${draft.suppression.evidence.quote}")` : ''}
        </p>
      ) : null}

      {draft.state === 'pending_review' ? (
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
              {check.suppressWith ? 'Re-check and suppress' : 'Approve (shadow, not sent)'}
            </Button>
            {!isCoordinator ? <span className="self-center text-xs text-text-faint">Only a coordinator can approve</span> : null}
          </div>
        </>
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
  const { result, user } = useEngine()
  const notice = useActionNotice()
  const visible = user?.role === 'coordinator' ? result.drafts : result.drafts.filter((d) => d.recipientId === user?.id)
  const by = (states: Draft['state'][]) => visible.filter((d) => states.includes(d.state))

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Draft queue"
        description="One draft per commitment. Deadline or owner changes update the same draft as a new version. Approving re-checks freshness first. Shadow mode: nothing is ever sent."
      />
      <div className="mb-3" aria-live="polite">
        <Notice result={notice.result} />
      </div>
      <Tabs
        items={[
          { value: 'review', label: `Needs review (${by(['pending_review']).length})`, content: <Lane drafts={by(['pending_review'])} empty="No drafts waiting for review" notice={notice} /> },
          { value: 'approved', label: `Approved (${by(['approved']).length})`, content: <Lane drafts={by(['approved'])} empty="Nothing approved yet" notice={notice} /> },
          { value: 'stale', label: `Stale (${by(['stale']).length})`, content: <Lane drafts={by(['stale'])} empty="No stale drafts" notice={notice} /> },
          { value: 'suppressed', label: `Suppressed (${by(['suppressed']).length})`, content: <Lane drafts={by(['suppressed'])} empty="Nothing suppressed" notice={notice} /> },
        ]}
      />
    </div>
  )
}
