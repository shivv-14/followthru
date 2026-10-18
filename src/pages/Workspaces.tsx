import { useCallback, useEffect, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { Button, LoadingState, StatusChip } from '../components/ui'
import { Notice } from '../components/domain/parts'
import { AuthLayout } from '../components/shell/AuthLayout'
import { callApi } from '../cloud/api'
import { useCloud } from '../cloud/session'
import type { ActionResult } from '../store'

interface Workspace {
  id: string
  name: string
  description: string | null
  coordinators: string[]
  status: 'none' | 'pending' | 'approved' | 'rejected' | 'member'
  requestedAt: string | null
  decidedAt: string | null
  reason: string | null
}

/** Team members find their team's workspace and ask to join. The coordinator approves; this page shows the answer. */
export default function Workspaces() {
  const cloud = useCloud()!
  const navigate = useNavigate()
  const [list, setList] = useState<Workspace[] | null>(null)
  const [notice, setNotice] = useState<ActionResult | null>(null)
  const [busy, setBusy] = useState('')

  const load = useCallback(async () => {
    const res = await callApi<{ workspaces: Workspace[] }>('workspaces/list')
    if (res.ok) setList(res.data.workspaces)
    else setNotice({ ok: false, message: res.error.message })
  }, [])

  useEffect(() => {
    if (cloud.status !== 'signed_in') return
    void load()
    // A coordinator may approve while this page is open
    const id = window.setInterval(() => void load().then(() => cloud.refreshMe()), 15_000)
    return () => window.clearInterval(id)
  }, [cloud.status, load, cloud])

  if (cloud.status === 'signed_out') return <Navigate to="/login" replace />
  if (cloud.me?.profile.mustChangePassword) return <Navigate to="/change-password" replace />

  async function request(w: Workspace) {
    setBusy(w.id)
    const res = await callApi<{ message: string }>('workspaces/request', { orgId: w.id })
    setBusy('')
    setNotice(res.ok ? { ok: true, message: res.data.message } : { ok: false, message: res.error.message })
    await load()
  }

  return (
    <AuthLayout
      aside={
        <button type="button" onClick={() => void cloud.signOut().then(() => navigate('/login'))} className="rounded-full bg-pill px-5 py-2.5 text-sm font-medium text-pill-text hover:bg-[#323234] hover:text-white">
          Sign out
        </button>
      }
    >
      <div className="mb-6 text-center">
        <h1 className="font-dot text-4xl leading-tight text-white sm:text-5xl">Workspaces</h1>
        <p className="mx-auto mt-3 max-w-md text-[15px] text-white/75">
          Hi {cloud.me?.profile.fullName.split(/\s+/)[0]}. Find your team and ask to join. You can open the workspace as soon as the Coordinator / Team Lead approves.
        </p>
      </div>
      <div className="mb-4">
        <Notice result={notice} />
      </div>
      {!list ? (
        <LoadingState label="Loading workspaces" />
      ) : list.length === 0 ? (
        <p className="glass-surface rounded-[22px] p-6 text-center text-sm text-white/70">No workspaces yet. Ask your Coordinator / Team Lead to create one.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {list.map((w) => (
            <li key={w.id} className="glass-surface flex flex-wrap items-center justify-between gap-3 rounded-[22px] p-4">
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-white">{w.name}</p>
                {w.description ? <p className="text-sm text-white/70">{w.description}</p> : null}
                <p className="text-xs text-white/55">Coordinator / Team Lead: {w.coordinators.join(', ') || 'not set'}</p>
                {w.status === 'pending' && w.requestedAt ? <p className="text-xs text-white/55">Requested {new Date(w.requestedAt).toLocaleString()}</p> : null}
                {w.status === 'rejected' ? (
                  <p className="text-xs text-status-overdue">
                    Not approved{w.decidedAt ? ` on ${new Date(w.decidedAt).toLocaleString()}` : ''}
                    {w.reason ? `: ${w.reason}` : ''}
                  </p>
                ) : null}
              </div>
              {w.status === 'member' ? (
                <Button onClick={() => navigate('/dashboard')}>Open workspace</Button>
              ) : w.status === 'pending' ? (
                <StatusChip status="tentative" label="Request pending" />
              ) : (
                <Button variant="secondary" disabled={busy === w.id || !!cloud.me?.org} onClick={() => void request(w)}>
                  {w.status === 'rejected' ? 'Ask again' : 'Request to join'}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </AuthLayout>
  )
}
