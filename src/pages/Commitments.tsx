import { useSearchParams } from 'react-router-dom'
import { Button, Card, EmptyState, Input, Select } from '../components/ui'
import { CommitmentLink, CommitmentStatus, DeadlineText, OwnerText, PageHeader, viewerTimezone } from '../components/domain/parts'
import { downloadText, statusView } from '../components/domain/view'
import { commitmentsToCsv } from '../schema/io'
import { useEngine } from '../store'

const STATUS_FILTERS = ['all', 'overdue', 'open', 'tentative', 'review', 'done', 'cancelled', 'deferred'] as const

export default function Commitments() {
  const { result, now, people, dataset } = useEngine()
  const [params, setParams] = useSearchParams()
  const q = params.get('q') ?? ''
  const status = (params.get('status') ?? 'all') as (typeof STATUS_FILTERS)[number]
  const owner = params.get('owner') ?? 'all'
  const tz = viewerTimezone()

  function set(key: string, value: string) {
    const next = new URLSearchParams(params)
    if (!value || value === 'all') next.delete(key)
    else next.set(key, value)
    setParams(next, { replace: true })
  }

  const messages = new Map((dataset?.data.messages ?? []).map((m) => [m.id, m.text.toLowerCase()]))
  const needle = q.toLowerCase()
  const rows = result.commitments.filter((c) => {
    const view = statusView(c, now).key
    if (status === 'review' && !c.needsReview) return false
    if (status !== 'all' && status !== 'review' && view !== status) return false
    if (owner !== 'all' && c.ownerId !== owner) return false
    if (!needle) return true
    const owners = `${people.get(c.ownerId ?? '')?.name ?? ''} ${people.get(c.requesterId ?? '')?.name ?? ''}`.toLowerCase()
    return c.title.toLowerCase().includes(needle) || owners.includes(needle) || (c.linkedMessageIds ?? []).some((id) => messages.get(id)?.includes(needle))
  })

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Commitments"
        description="Every commitment found in the conversations and every assigned task, with owner, deadline and status resolved from the whole history."
        actions={
          <>
            <Button variant="secondary" size="sm" onClick={() => downloadText('commitments.csv', commitmentsToCsv(rows), 'text/csv')}>
              Export CSV
            </Button>
            <Button variant="secondary" size="sm" onClick={() => downloadText('commitments.json', JSON.stringify(rows, null, 2), 'application/json')}>
              Export JSON
            </Button>
          </>
        }
      />
      <Card className="mb-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <Input label="Search" value={q} onChange={(e) => set('q', e.target.value)} placeholder="Title, person or message text" />
          <Select label="Status" value={status} onChange={(e) => set('status', e.target.value)}>
            {STATUS_FILTERS.map((s) => (
              <option key={s} value={s}>
                {s === 'review' ? 'Needs review' : s[0].toUpperCase() + s.slice(1)}
              </option>
            ))}
          </Select>
          <Select label="Owner" value={owner} onChange={(e) => set('owner', e.target.value)}>
            <option value="all">Everyone</option>
            {[...people.values()].map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </div>
      </Card>

      {rows.length === 0 ? (
        <EmptyState title="No commitments match" description="Change the filters or the search." />
      ) : (
        <>
          <div className="hidden overflow-x-auto rounded-lg border border-surface-border md:block">
            <table className="w-full text-left text-sm">
              <thead className="bg-surface text-xs uppercase tracking-wide text-text-faint">
                <tr>
                  <th className="p-3">Commitment</th>
                  <th className="p-3">Owner</th>
                  <th className="p-3">Deadline</th>
                  <th className="p-3">Status</th>
                  <th className="p-3">Reply</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.id} className="border-t border-surface-border align-top">
                    <td className="p-3">
                      <CommitmentLink c={c} />
                      <p className="text-xs text-text-faint">
                        {c.source === 'manual' ? 'Assigned task' : `From ${c.sourceMessageId}`}
                        {c.needsReview ? <span className="text-status-tentative"> · needs review</span> : null}
                      </p>
                    </td>
                    <td className="p-3">
                      <OwnerText c={c} people={people} />
                    </td>
                    <td className="p-3 text-xs">
                      <DeadlineText c={c} people={people} viewerTz={tz} now={now} />
                    </td>
                    <td className="p-3">
                      <CommitmentStatus c={c} now={now} />
                    </td>
                    <td className="p-3 text-xs text-text-muted">{c.responseState === 'pending' ? 'Pending' : 'Responded'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="flex flex-col gap-2 md:hidden">
            {rows.map((c) => (
              <li key={c.id}>
                <Card>
                  <div className="mb-2 flex items-start justify-between gap-2">
                    <CommitmentLink c={c} />
                    <CommitmentStatus c={c} now={now} />
                  </div>
                  <p className="text-xs text-text-muted">
                    <OwnerText c={c} people={people} />
                  </p>
                  <div className="text-xs">
                    <DeadlineText c={c} people={people} viewerTz={tz} now={now} />
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}
