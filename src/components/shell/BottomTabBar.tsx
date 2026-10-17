import { LayoutDashboard, ListChecks, Inbox, Users, FileCheck2 } from 'lucide-react'
import { NavLink } from 'react-router-dom'
import clsx from 'clsx'

const items = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/commitments', label: 'Items', icon: ListChecks },
  { to: '/queue', label: 'Queue', icon: Inbox },
  { to: '/team', label: 'Team', icon: Users },
  { to: '/evidence', label: 'Evidence', icon: FileCheck2 },
]

export function BottomTabBar() {
  return (
    <nav
      aria-label="Primary"
      className="glass-surface fixed inset-x-0 bottom-0 z-20 flex rounded-none border-x-0 border-b-0 pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      {items.map(({ to, label, icon: Icon }) => (
        <NavLink
          key={to}
          to={to}
          className={({ isActive }) =>
            clsx(
              'flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] font-medium transition-colors duration-200',
              isActive ? 'text-accent' : 'text-text-muted',
            )
          }
        >
          <Icon size={18} aria-hidden />
          {label}
        </NavLink>
      ))}
    </nav>
  )
}
