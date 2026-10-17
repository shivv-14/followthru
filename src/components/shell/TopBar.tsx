import { Search, Menu, Clock } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { useNavigate } from 'react-router-dom'
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
  const { now, settings, result, dataset, user } = useEngine()
  const actions = useActions()
  const [query, setQuery] = useState('')
  const [clockOpen, setClockOpen] = useState(false)
  const [custom, setCustom] = useState(() => toLocalInput(now))

  function onSearch(event: FormEvent) {
    event.preventDefault()
    navigate(query.trim() ? `/commitments?q=${encodeURIComponent(query.trim())}` : '/commitments')
  }

  async function setClock(mode: ClockMode) {
    await actions.updateSettings(mode === 'custom' ? { clockMode: mode, customNow: new Date(custom).toISOString() } : { clockMode: mode })
    setClockOpen(false)
  }

  return (
    <header className="glass-surface sticky top-0 z-20 flex h-14 items-center gap-3 rounded-none border-x-0 border-t-0 px-3 sm:px-4">
      <button
        type="button"
        onClick={onOpenMobileNav}
        aria-label="Open navigation"
        className="rounded-md p-2 text-text-muted hover:bg-surface-hover hover:text-text-primary md:hidden"
      >
        <Menu size={18} />
      </button>

      <form onSubmit={onSearch} role="search" className="hidden min-w-0 flex-1 items-center gap-2 rounded-md border border-surface-border bg-surface px-3 py-1.5 sm:flex">
        <Search size={15} className="shrink-0 text-text-faint" aria-hidden />
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          aria-label="Search commitments"
          placeholder="Search commitments, owners, messages"
          className="w-full bg-transparent text-sm text-text-primary placeholder:text-text-faint focus-visible:outline-none"
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
          className="inline-flex items-center gap-1.5 rounded-full border border-surface-border bg-surface px-2.5 py-1 text-xs text-text-muted hover:text-text-primary"
          title="Evaluation clock: the time used for overdue checks"
        >
          <Clock size={12} aria-hidden />
          <span className="hidden sm:inline">{clockLabel[settings.clockMode]}:</span> {shortTime(now)}
        </button>
        <span className="hidden rounded-full border border-surface-border bg-surface px-2.5 py-1 text-xs text-text-muted lg:inline-flex" title="Extraction mode">
          {result.mode}
        </span>
        <label className="sr-only" htmlFor="demo-profile">
          Profile
        </label>
        <select
          id="demo-profile"
          value={user?.id ?? ''}
          onChange={(event) => actions.updateSettings({ profileId: event.target.value })}
          className="max-w-36 rounded-md border border-surface-border bg-surface px-2 py-1.5 text-xs text-text-primary focus-visible:outline-none [&>option]:bg-bg"
        >
          {(dataset?.data.people ?? []).map((p) => (
            <option key={p.id} value={p.id}>
              {p.name.split(/\s+/)[0]} · {p.role ?? 'member'}
            </option>
          ))}
        </select>
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
