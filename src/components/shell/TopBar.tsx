import { Search, Menu } from 'lucide-react'
import { useEffect, useState } from 'react'

export interface TopBarProps {
  onOpenMobileNav?: () => void
}

function useClock() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000)
    return () => window.clearInterval(id)
  }, [])
  return now
}

const demoProfiles = ['Priya — Coordinator', 'Dev — Member'] as const

export function TopBar({ onOpenMobileNav }: TopBarProps) {
  const now = useClock()
  const [profile, setProfile] = useState<string>(demoProfiles[0])
  const clockLabel = now.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })

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

      <div className="hidden min-w-0 flex-1 items-center gap-2 rounded-md border border-surface-border bg-surface px-3 py-1.5 sm:flex">
        <Search size={15} className="shrink-0 text-text-faint" aria-hidden />
        <input
          type="search"
          disabled
          aria-label="Search commitments, coming once there is data to search"
          placeholder="Search — wired in Phase 3"
          className="w-full bg-transparent text-sm text-text-primary placeholder:text-text-faint focus-visible:outline-none disabled:cursor-not-allowed"
        />
        <kbd className="rounded border border-surface-border px-1.5 py-0.5 text-[10px] text-text-faint">⌘K</kbd>
      </div>

      <div className="ml-auto flex items-center gap-2">
        <span
          className="hidden rounded-full border border-surface-border bg-surface px-2.5 py-1 text-xs text-text-muted sm:inline-flex"
          title="Evaluation clock — the current time used for overdue checks"
        >
          {clockLabel}
        </span>
        <span className="hidden rounded-full border border-surface-border bg-surface px-2.5 py-1 text-xs text-text-muted sm:inline-flex">
          Rules
        </span>
        <label className="sr-only" htmlFor="demo-profile">
          Demo profile
        </label>
        <select
          id="demo-profile"
          value={profile}
          onChange={(event) => setProfile(event.target.value)}
          className="rounded-md border border-surface-border bg-surface px-2 py-1.5 text-xs text-text-primary focus-visible:outline-none"
        >
          {demoProfiles.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      </div>
    </header>
  )
}
