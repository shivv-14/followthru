import { useEffect, useRef, useState } from 'react'
import { Bell } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import clsx from 'clsx'
import { supabase } from '../lib/supabase'
import { useCloud } from './session'

export interface NotificationRow {
  id: string
  type: string
  title: string
  body: string | null
  link: string | null
  read_at: string | null
  created_at: string
}

/** Your notifications (RLS returns only yours, and only once due), newest first. */
export function useNotifications(limit = 20, offset = 0) {
  const cloud = useCloud()
  const [items, setItems] = useState<NotificationRow[]>([])
  const [unread, setUnread] = useState(0)
  const [total, setTotal] = useState(0)
  useEffect(() => {
    if (!cloud || cloud.status !== 'signed_in') return
    let stale = false
    const db = supabase()
    void Promise.all([
      db.from('notifications').select('id, type, title, body, link, read_at, created_at', { count: 'exact' }).order('created_at', { ascending: false }).range(offset, offset + limit - 1),
      db.from('notifications').select('id', { count: 'exact', head: true }).is('read_at', null),
    ]).then(([list, count]) => {
      if (stale) return
      setItems((list.data ?? []) as NotificationRow[])
      setTotal(list.count ?? 0)
      setUnread(count.count ?? 0)
    })
    return () => {
      stale = true
    }
  }, [cloud, cloud?.status, cloud?.version, limit, offset])
  const markRead = async (ids: string[] | null) => {
    await supabase().rpc('mark_notifications_read', { p_ids: ids })
    cloud?.bump()
  }
  return { items, unread, total, markRead }
}

export function NotificationBell() {
  const [open, setOpen] = useState(false)
  const { items, unread, markRead } = useNotifications(8)
  const navigate = useNavigate()
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !ref.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', close)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', close)
    }
  }, [open])

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'}
        aria-expanded={open}
        className="relative grid size-9 place-items-center rounded-full border border-pill-border bg-pill text-[#c4c2c3] hover:text-white"
      >
        <Bell size={15} aria-hidden />
        {unread > 0 ? <span className="absolute -right-1 -top-1 grid min-w-5 place-items-center rounded-full bg-status-overdue px-1 text-[10px] font-semibold text-black">{unread > 99 ? '99+' : unread}</span> : null}
      </button>
      {open ? (
        <div className="absolute right-0 top-11 z-30 w-[min(92vw,360px)] overflow-hidden rounded-[22px] border border-surface-border bg-[#0b0b0d]/95 shadow-[0_20px_60px_rgba(0,0,0,0.6)] backdrop-blur-xl">
          <div className="flex items-center justify-between border-b border-surface-border px-4 py-3">
            <p className="text-sm font-semibold">Notifications</p>
            {unread > 0 ? (
              <button type="button" className="text-xs text-accent hover:underline" onClick={() => void markRead(null)}>
                Mark all read
              </button>
            ) : null}
          </div>
          {items.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-text-muted">Nothing new.</p>
          ) : (
            <ul className="max-h-96 overflow-y-auto">
              {items.map((n) => (
                <li key={n.id}>
                  <button
                    type="button"
                    className={clsx('flex w-full flex-col gap-0.5 px-4 py-3 text-left hover:bg-white/[0.05]', !n.read_at && 'bg-white/[0.03]')}
                    onClick={() => {
                      void markRead([n.id])
                      setOpen(false)
                      if (n.link) navigate(n.link)
                    }}
                  >
                    <span className="flex items-center gap-2 text-sm font-medium">
                      {!n.read_at ? <span className="size-1.5 shrink-0 rounded-full bg-accent" aria-label="Unread" /> : null}
                      {n.title}
                    </span>
                    {n.body ? <span className="line-clamp-2 text-xs text-text-muted">{n.body}</span> : null}
                    <span className="text-[11px] text-text-faint">{new Date(n.created_at).toLocaleString()}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <Link to="/notifications" onClick={() => setOpen(false)} className="block border-t border-surface-border px-4 py-2.5 text-center text-xs text-text-muted hover:text-white">
            View all
          </Link>
        </div>
      ) : null}
    </div>
  )
}
