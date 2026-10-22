import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import clsx from 'clsx'
import { Button, Card, EmptyState } from '../components/ui'
import { PageHeader } from '../components/domain/parts'
import { useNotifications } from '../cloud/NotificationBell'

const PAGE = 20

export default function Notifications() {
  const [page, setPage] = useState(0)
  const { items, unread, total, markRead } = useNotifications(PAGE, page * PAGE)
  const navigate = useNavigate()
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Notifications"
        description={`${unread} unread · ${total} in total. Reminders held for quiet hours appear when they are due.`}
        actions={
          unread > 0 ? (
            <Button variant="secondary" size="sm" onClick={() => void markRead(null)}>
              Mark all read
            </Button>
          ) : null
        }
      />
      {items.length === 0 ? (
        <EmptyState title="No notifications" description="Assignments, reviews, comments and approved reminders show up here." />
      ) : (
        <Card className="p-0">
          <ul>
            {items.map((n) => (
              <li key={n.id} className="border-b border-surface-border last:border-0">
                <button
                  type="button"
                  onClick={() => {
                    void markRead([n.id])
                    if (n.link) navigate(n.link)
                  }}
                  className={clsx('flex w-full flex-col gap-1 px-5 py-4 text-left hover:bg-white/[0.04]', !n.read_at && 'bg-white/[0.03]')}
                >
                  <span className="flex items-center gap-2 font-medium">
                    {!n.read_at ? <span className="size-2 rounded-full bg-accent" aria-label="Unread" /> : null}
                    {n.title}
                  </span>
                  {n.body ? <span className="text-sm text-text-muted">{n.body}</span> : null}
                  <span className="text-xs text-text-faint">
                    {new Date(n.created_at).toLocaleString()} · {n.type.replace(/_/g, ' ')}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}
      {total > PAGE ? (
        <div className="mt-4 flex justify-between">
          <Button variant="secondary" size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
            Newer
          </Button>
          <Button variant="secondary" size="sm" disabled={(page + 1) * PAGE >= total} onClick={() => setPage((p) => p + 1)}>
            Older
          </Button>
        </div>
      ) : null}
    </div>
  )
}
