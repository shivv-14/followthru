import { Search, Menu, Clock, LogOut } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Button, Dialog } from '../ui'
import { useActions, useEngine, type ClockMode } from '../../store'
import { shortTime } from '../domain/view'
import { InstallButton } from './InstallButton'

export interface TopBarProps {
  onOpenMobileNav?: () => void
}

const clockLabel: Record<ClockMode, string> = { dataset: 'Data clock', live: 'Live clock', custom: 'Chosen time' }

function toLocalInput(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function TopBar({ onOpenMobileNav }: TopBarProps) {
  const navigate = useNavigate()
  const location = useLocation()
  const { now, settings, result, dataset, user } = useEngine()
  const actions = useActions()
  const [query, setQuery] = useState('')
  const [clockOpen, setClockOpen] = useState(false)
  const [custom, setCustom] = useState(() => toLocalInput(now))

  function onSearch(event: FormEvent) {
    event.preventDefault()
    navigate(query.trim() ? `/commitments?q=${encodeURIComponent(query.trim())}` : '/commitments')
  }

  async function signOut() {
    await actions.updateSettings({ profileId: null })
    // Signing back in, as anyone, returns to this page
    navigate('/login', { state: { from: location.pathname + location.search } })
  }

  async function setClock(mode: ClockMode) {
    await actions.updateSettings(mode === 'custom' ? { clockMode: mode, customNow: new Date(custom).toISOString() } : { clockMode: mode })
    setClockOpen(false)
  }

  return (
    <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-surface-border bg-black/50 px-3 backdrop-blur-xl sm:px-6">
      <button
        type="button"
        onClick={onOpenMobileNav}
        aria-label="Open navigation"
        className="grid size-10 place-items-center rounded-full bg-pill text-white md:hidden"
      >
        <Menu size={18} />
      </button>

      <form onSubmit={onSearch} role="search" className="hidden h-10 min-w-0 max-w-xl flex-1 items-center gap-2 rounded-full bg-white px-4 text-black shadow-[0_4px_14px_rgba(0,0,0,0.16)] sm:flex">
        <Search size={15} className="shrink-0 text-[#636363]" aria-hidden />
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          aria-label="Search commitments"
          placeholder="Search commitments, owners, messages"
          className="w-full bg-transparent text-sm text-[#2e2e2e] placeholder:text-[#636363] focus-visible:outline-none"
        />
      </form>

      <div className="ml-auto flex items-center gap-2">
        <InstallButton className="hidden sm:inline-flex" label="Install" />
        <button
          type="button"
          onClick={() => {
            setCustom(toLocalInput(now))
            setClockOpen(true)
          }}
          className="inline-flex h-9 items-center gap-1.5 rounded-full border border-pill-border bg-pill px-3 text-xs text-[#c4c2c3] hover:text-white"
          title="Evaluation clock: the time used for overdue checks"
        >
          <Clock size={12} aria-hidden />
          <span className="hidden sm:inline">{clockLabel[settings.clockMode]}:</span> {shortTime(now)}
        </button>
        <span className="hidden h-9 items-center rounded-full border border-pill-border bg-pill px-3 text-xs text-[#c4c2c3] lg:inline-flex" title="Extraction mode">
          {result.mode}
        </span>
        <span className="flex h-9 items-center gap-2 rounded-full bg-white py-1 pl-1 pr-1 text-xs text-black shadow-[0_4px_14px_rgba(0,0,0,0.16)]">
          <span className="grid size-7 place-items-center rounded-full bg-black text-[11px] font-semibold text-white" aria-hidden>
            {(user?.name ?? '?').split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase()}
          </span>
          <span className="hidden font-medium sm:inline">
            {user?.name.split(/\s+/)[0]} · {user?.role ?? 'member'}
          </span>
          <button
            type="button"
            onClick={signOut}
            aria-label="Sign out"
            title="Sign out"
            className="grid size-7 place-items-center rounded-full bg-pill text-pill-text hover:bg-black hover:text-white"
          >
            <LogOut size={13} aria-hidden />
          </button>
        </span>
      </div>

      <Dialog open={clockOpen} onClose={() => setClockOpen(false)} title="Evaluation clock">
        <p className="mb-4 text-sm text-text-muted">
          Overdue checks, reminders and the stale window use this time. The data clock uses the dataset's reference time so results are repeatable.
        </p>
        <div className="flex flex-col gap-2">
          <Button variant={settings.clockMode === 'dataset' ? 'primary' : 'secondary'} onClick={() => setClock('dataset')}>
            Data clock{dataset?.data.referenceTime ? ` (${shortTime(dataset.data.referenceTime)})` : ' (latest message)'}
          </Button>
          <Button variant={settings.clockMode === 'live' ? 'primary' : 'secondary'} onClick={() => setClock('live')}>
            Live clock
          </Button>
          <div className="mt-2 flex items-end gap-2">
            <label className="flex flex-1 flex-col gap-1 text-sm text-text-primary">
              Chosen time (your timezone)
              <input
                type="datetime-local"
                value={custom}
                onChange={(event) => setCustom(event.target.value)}
                className="h-10 rounded-md border border-surface-border bg-surface px-3 text-sm text-text-primary [color-scheme:dark]"
              />
            </label>
            <Button variant={settings.clockMode === 'custom' ? 'primary' : 'secondary'} onClick={() => setClock('custom')} disabled={!custom}>
              Use
            </Button>
          </div>
        </div>
      </Dialog>
    </header>
  )
}
