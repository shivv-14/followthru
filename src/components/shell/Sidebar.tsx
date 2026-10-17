import { LayoutDashboard, ListChecks, Inbox, Workflow, Users, FileCheck2, ChevronsLeft, ChevronsRight } from 'lucide-react'
import clsx from 'clsx'
import { NavItem } from '../ui'

const items = [
  { to: '/dashboard', label: 'Dashboard', icon: <LayoutDashboard size={18} /> },
  { to: '/commitments', label: 'Commitments', icon: <ListChecks size={18} /> },
  { to: '/queue', label: 'Queue', icon: <Inbox size={18} /> },
  { to: '/flows', label: 'Flows', icon: <Workflow size={18} /> },
  { to: '/team', label: 'Team / Me', icon: <Users size={18} /> },
  { to: '/evidence', label: 'Evidence', icon: <FileCheck2 size={18} /> },
]

export interface SidebarProps {
  collapsed: boolean
  onToggle: () => void
}

export function Sidebar({ collapsed, onToggle }: SidebarProps) {
  return (
    <aside
      className={clsx(
        'glass-surface sticky top-0 hidden h-dvh flex-col gap-1 rounded-none border-y-0 border-l-0 p-3 transition-[width] duration-200 md:flex',
        collapsed ? 'w-[72px]' : 'w-60',
      )}
    >
      <div className="mb-2 flex items-center justify-between px-1">
        {!collapsed && <span className="font-display text-sm font-semibold text-text-primary">FollowThru</span>}
        <button
          type="button"
          onClick={onToggle}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-expanded={!collapsed}
          className="rounded-md p-1.5 text-text-muted hover:bg-surface-hover hover:text-text-primary"
        >
          {collapsed ? <ChevronsRight size={16} /> : <ChevronsLeft size={16} />}
        </button>
      </div>
      <nav aria-label="Primary" className="flex flex-col gap-1">
        {items.map((item) => (
          <NavItem key={item.to} to={item.to} label={item.label} icon={item.icon} iconOnly={collapsed} />
        ))}
      </nav>
    </aside>
  )
}
