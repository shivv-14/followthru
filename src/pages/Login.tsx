import { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { ArrowRight, Database, ShieldCheck } from 'lucide-react'
import clsx from 'clsx'
import { Button } from '../components/ui'
import { Notice, useActionNotice } from '../components/domain/parts'
import { AuthLayout } from '../components/shell/AuthLayout'
import { isMockModeEnabled } from '../config/demoMode'
import { validateDataset } from '../schema/validate'
import type { Person, Role } from '../engine/types'
import { useActions, useEngine } from '../store'
import demoDataset from '../mocks/demoDataset.json'

const ROLE_TEXT: Record<Role, string> = {
  coordinator: 'Reviews drafts, confirms recipients, approves in shadow mode, assigns work.',
  member: 'Sees their own tasks, updates progress, reports blockers, submits work.',
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()
}

/** Local sign-in: pick who you are from the loaded people. No password and no server; all data stays in this browser. */
export default function Login() {
  const navigate = useNavigate()
  const location = useLocation()
  const { dataset, ready, user, result } = useEngine()
  const actions = useActions()
  const notice = useActionNotice()
  const [role, setRole] = useState<Role>('coordinator')
  const from = (location.state as { from?: string } | null)?.from ?? '/dashboard'

  const people = [...(dataset?.data.people ?? [])].sort((a, b) => a.name.localeCompare(b.name))
  const counts = { coordinator: people.filter((p) => p.role === 'coordinator').length, member: people.filter((p) => p.role !== 'coordinator').length }
  const shown = people.filter((p) => (role === 'coordinator' ? p.role === 'coordinator' : p.role !== 'coordinator'))

  async function signIn(p: Person) {
    await actions.updateSettings({ profileId: p.id })
    navigate(from === '/login' ? '/dashboard' : from, { replace: true })
  }

  function loadDemo() {
    void notice.run(() => actions.loadDataset('Synthetic demo data', 'demo', validateDataset(demoDataset)))
  }

  return (
    <AuthLayout
      aside={
        <Link to="/setup" className="rounded-full bg-pill px-5 py-2.5 text-sm font-medium text-pill-text shadow-[0_4px_14px_rgba(0,0,0,0.16)] hover:bg-[#323234] hover:text-white">
          {dataset ? 'Change data' : 'Upload data'}
        </Link>
      }
    >
      <div className="mb-8 text-center">
        <p className="mx-auto mb-5 inline-flex items-center gap-2 rounded-full border border-pill-border bg-pill/90 px-4 py-1.5 text-xs font-medium text-[#c4c2c3]">
          <ShieldCheck size={14} aria-hidden /> Local sign-in · no password · nothing leaves this browser
        </p>
        <h1 className="font-dot text-5xl leading-tight text-white sm:text-6xl">Sign in</h1>
        <p className="mx-auto mt-3 max-w-md text-[15px] leading-relaxed text-white/75">
          Choose who you are from the people in the loaded data. Your work is saved in this browser and is still here next time.
        </p>
      </div>

      {ready && !dataset ? (
        <section className="glass-surface rounded-[28px] p-6 text-center" aria-labelledby="no-data">
          <Database className="mx-auto mb-3 text-white/70" aria-hidden />
          <h2 id="no-data" className="text-lg font-semibold">
            No data loaded yet
          </h2>
          <p className="mx-auto mt-1 max-w-sm text-sm text-white/70">Load the demo team to try FollowThru, or upload your own conversations.</p>
          <div className="mt-5 flex flex-wrap justify-center gap-3">
            {isMockModeEnabled() ? <Button onClick={loadDemo}>Use synthetic demo data</Button> : null}
            <Button variant="secondary" onClick={() => navigate('/setup')}>
              Upload a file
            </Button>
          </div>
          <div className="mt-4">
            <Notice result={notice.result} />
          </div>
        </section>
      ) : (
        <section className="glass-surface rounded-[28px] p-4 sm:p-6" aria-label="Choose your profile">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div role="radiogroup" aria-label="Role" className="inline-flex rounded-full border border-surface-border bg-white/[0.04] p-1">
              {(['coordinator', 'member'] as const).map((r) => (
                <button
                  key={r}
                  type="button"
                  role="radio"
                  aria-checked={role === r}
                  onClick={() => setRole(r)}
                  className={clsx('rounded-full px-4 py-1.5 text-sm font-medium capitalize transition-colors', role === r ? 'bg-white text-black' : 'text-white/70 hover:text-white')}
                >
                  {r} ({counts[r]})
                </button>
              ))}
            </div>
            <p className="text-xs text-white/60">
              {dataset?.name} · {result.commitments.length} commitments
            </p>
          </div>
          <p className="mb-3 text-sm text-white/70">{ROLE_TEXT[role]}</p>
          {shown.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-surface-border p-4 text-sm text-status-tentative">
              No one in this data has the {role} role{role === 'coordinator' ? ', so drafts cannot be approved' : ''}.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {shown.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => signIn(p)}
                    aria-label={`Sign in as ${p.name}`}
                    className={clsx(
                      'group flex w-full items-center gap-3 rounded-2xl border px-3 py-3 text-left transition-[background-color,border-color,transform] duration-200 hover:-translate-y-px hover:bg-white/[0.07]',
                      user?.id === p.id ? 'border-white/50 bg-white/[0.06]' : 'border-surface-border',
                    )}
                  >
                    <span className="grid size-10 shrink-0 place-items-center rounded-full bg-white text-sm font-semibold text-black" aria-hidden>
                      {initials(p.name)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium text-white">{p.name}</span>
                      <span className="block truncate text-xs text-white/60">
                        {p.role ?? 'member'} · {p.timezone}
                        {user?.id === p.id ? ' · signed in last' : ''}
                      </span>
                    </span>
                    <span className="grid size-9 place-items-center rounded-full bg-pill text-pill-text transition-colors group-hover:bg-white group-hover:text-black" aria-hidden>
                      <ArrowRight size={16} />
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
      <p className="mt-6 text-center text-xs text-white/55">Demo sign-in for the hackathon build. Real accounts are out of scope; shadow mode means nothing is ever sent.</p>
    </AuthLayout>
  )
}
