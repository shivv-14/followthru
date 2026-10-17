import { useState } from 'react'
import { Link } from 'react-router-dom'
import clsx from 'clsx'
import type { Commitment, Person } from '../../engine/types'
import { formatDeadline } from '../../engine/deadline'
import { StatusChip } from '../ui'
import type { ActionResult } from '../../store'
import { personName, relative, statusView } from './view'

export function CommitmentStatus({ c, now }: { c: Commitment; now: string }) {
  const v = statusView(c, now)
  return <StatusChip status={v.key} label={v.label} />
}

/** Deadline in the owner's time, with the viewer's time when it differs. */
export function DeadlineText({ c, people, viewerTz, now }: { c: Commitment; people: Map<string, Person>; viewerTz: string; now: string }) {
  if (!c.deadline.dueAt) return <span className="text-text-faint">No deadline</span>
  const ownerTz = people.get(c.ownerId ?? '')?.timezone ?? c.deadline.interpretedTz
  const tentative = c.deadline.certainty === 'tentative'
  return (
    <span className="inline-flex flex-col">
      <span className={clsx(tentative && 'text-status-tentative')}>
        {tentative ? '~ ' : ''}
        {formatDeadline(c.deadline.dueAt, ownerTz)}
        <span className="text-text-faint"> · {relative(c.deadline.dueAt, now)}</span>
      </span>
      {ownerTz !== viewerTz ? <span className="text-xs text-text-faint">Your time: {formatDeadline(c.deadline.dueAt, viewerTz)}</span> : null}
    </span>
  )
}

export function OwnerText({ c, people }: { c: Commitment; people: Map<string, Person> }) {
  return <span className={clsx(!c.ownerId && 'text-status-overdue')}>{personName(people, c.ownerId)}</span>
}

export function CommitmentLink({ c }: { c: Commitment }) {
  return (
    <Link to={`/commitments/${c.id}`} className="font-medium text-text-primary hover:text-accent">
      {c.title}
    </Link>
  )
}

export function Notice({ result }: { result: ActionResult | null }) {
  if (!result) return null
  return (
    <p role="status" className={clsx('rounded-md border px-3 py-2 text-sm', result.ok ? 'border-status-done/40 text-status-done' : 'border-status-overdue/40 text-status-overdue')}>
      {result.message}
    </p>
  )
}

/** Runs an action and keeps its result for a Notice. */
export function useActionNotice() {
  const [result, setResult] = useState<ActionResult | null>(null)
  const [busy, setBusy] = useState(false)
  async function run(action: () => Promise<ActionResult>) {
    setBusy(true)
    try {
      setResult(await action())
    } catch (e) {
      setResult({ ok: false, message: (e as Error).message })
    } finally {
      setBusy(false)
    }
  }
  return { result, busy, run, clear: () => setResult(null) }
}

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: React.ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="font-display text-2xl font-semibold text-text-primary">{title}</h1>
        {description ? <p className="mt-1 max-w-2xl text-sm text-text-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  )
}

const toneClass = {
  overdue: 'text-status-overdue',
  done: 'text-status-done',
  tentative: 'text-status-tentative',
  deferred: 'text-status-deferred',
} as const

export function Stat({ label, value, tone }: { label: string; value: number | string; tone?: keyof typeof toneClass }) {
  return (
    <div className="glass-surface rounded-lg p-4">
      <p className="text-xs uppercase tracking-wide text-text-faint">{label}</p>
      <p className={clsx('mt-1 font-display text-3xl font-semibold', tone ? toneClass[tone] : 'text-text-primary')}>{value}</p>
    </div>
  )
}

export function viewerTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone
}
