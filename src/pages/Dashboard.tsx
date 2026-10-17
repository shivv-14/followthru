import { Link } from 'react-router-dom'
import { Card, CardHeader, CardTitle, EmptyState } from '../components/ui'
import { CommitmentLink, CommitmentStatus, DeadlineText, OwnerText, PageHeader, Stat, viewerTimezone } from '../components/domain/parts'
import { REVIEW_LABEL, firstName, statusView } from '../components/domain/view'
import { blockingReviewReasons } from '../engine/drafts'
import { useEngine } from '../store'

const DAY = 86_400_000

export default function Dashboard() {
  const { result, now, people, user, dataset } = useEngine()
  const tz = viewerTimezone()
  const all = result.commitments
  const mine = user?.role === 'coordinator' ? all : all.filter((c) => c.ownerId === user?.id)
  const open = mine.filter((c) => c.status === 'open')
  const overdue = open.filter((c) => statusView(c, now).key === 'overdue')
  const review = open.filter((c) => c.needsReview)
  const drafts = result.drafts.filter((d) => mine.some((c) => c.id === d.commitmentId))
  const pending = drafts.filter((d) => d.state === 'pending_review')
  const suppressed = drafts.filter((d) => d.state === 'suppressed' || d.state === 'stale')
  const closed = mine.filter((c) => c.status !== 'open')

  const attention = [...new Set([...review, ...overdue])].sort((a, b) => (a.deadline.dueAt ?? '').localeCompare(b.deadline.dueAt ?? ''))

  const start = new Date(new Date(now).toDateString()).getTime()
  const days = Array.from({ length: 7 }, (_, i) => {
    const from = start + i * DAY
    const items = open.filter((c) => c.deadline.dueAt && Date.parse(c.deadline.dueAt) >= from && Date.parse(c.deadline.dueAt) < from + DAY)
    return { from, items }
  })

  const teams = [...new Set(all.map((c) => c.teamId ?? 'none'))].map((team) => {
    const items = all.filter((c) => (c.teamId ?? 'none') === team)
    return { team, open: items.filter((c) => c.status === 'open').length, overdue: items.filter((c) => statusView(c, now).key === 'overdue').length, total: items.length }
  })

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title={user?.role === 'coordinator' ? 'What needs attention' : `Your work, ${firstName(people, user?.id)}`}
        description={`${dataset?.name ?? ''} · ${result.mode} · evaluated at ${new Date(now).toLocaleString()}`}
      />

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Open" value={open.length} />
        <Stat label="Overdue" value={overdue.length} tone="overdue" />
        <Stat label="Needs review" value={review.length} tone="tentative" />
        <Stat label="Drafts to review" value={pending.length} />
        <Stat label="Suppressed" value={suppressed.length} tone="deferred" />
        <Stat label="Closed" value={closed.length} tone="done" />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Needs your attention</CardTitle>
            <Link to="/queue" className="text-sm text-accent hover:underline">
              Open queue →
            </Link>
          </CardHeader>
          {attention.length === 0 ? (
            <EmptyState title="Nothing overdue or waiting for review" description="Closed work is never chased." />
          ) : (
            <ul className="flex flex-col divide-y divide-surface-border">
              {attention.map((c) => (
                <li key={c.id} className="flex flex-wrap items-start justify-between gap-2 py-3">
                  <div className="min-w-0">
                    <CommitmentLink c={c} />
                    <p className="text-xs text-text-muted">
                      <OwnerText c={c} people={people} /> · {c.responseState === 'pending' ? 'no reply yet' : 'has replied'}
                    </p>
                    {blockingReviewReasons(c).length > 0 || c.reviewReasons.includes('tentative_deadline') ? (
                      <p className="text-xs text-status-tentative">{c.reviewReasons.map((r) => REVIEW_LABEL[r]).join(' · ')}</p>
                    ) : null}
                  </div>
                  <div className="flex flex-col items-end gap-1 text-right text-xs">
                    <CommitmentStatus c={c} now={now} />
                    <DeadlineText c={c} people={people} viewerTz={tz} now={now} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Team health</CardTitle>
          </CardHeader>
          <ul className="flex flex-col gap-3">
            {teams.map((t) => (
              <li key={t.team}>
                <div className="mb-1 flex justify-between text-sm">
                  <span className="capitalize text-text-primary">{t.team === 'none' ? 'No team' : t.team}</span>
                  <span className="text-text-muted">
                    {t.open} open · <span className={t.overdue ? 'text-status-overdue' : ''}>{t.overdue} overdue</span>
                  </span>
                </div>
                <div className="flex h-1.5 overflow-hidden rounded-full bg-surface" aria-hidden>
                  <div className="bg-status-overdue" style={{ width: `${(t.overdue / Math.max(1, t.total)) * 100}%` }} />
                  <div className="bg-status-open/60" style={{ width: `${((t.open - t.overdue) / Math.max(1, t.total)) * 100}%` }} />
                  <div className="bg-status-done" style={{ width: `${((t.total - t.open) / Math.max(1, t.total)) * 100}%` }} />
                </div>
              </li>
            ))}
          </ul>
        </Card>

        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle>Next 7 days</CardTitle>
          </CardHeader>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
            {days.map(({ from, items }) => (
              <div key={from} className="rounded-md border border-surface-border p-2">
                <p className="mb-1 text-xs text-text-faint">{new Date(from).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}</p>
                {items.length === 0 ? (
                  <p className="text-xs text-text-faint">—</p>
                ) : (
                  items.map((c) => (
                    <Link key={c.id} to={`/commitments/${c.id}`} className="block truncate text-xs text-text-primary hover:text-accent" title={c.title}>
                      {c.deadline.certainty === 'tentative' ? '~ ' : ''}
                      {c.title}
                    </Link>
                  ))
                )}
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  )
}
