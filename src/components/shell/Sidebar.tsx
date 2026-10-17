import { ChevronsLeft, ChevronsRight } from 'lucide-react'
import clsx from 'clsx'
import { NavItem } from '../ui'
import { useEngine } from '../../store'
import { navFor } from './nav'

export interface SidebarProps {
  collapsed: boolean
  onToggle: () => void
}

export function Sidebar({ collapsed, onToggle }: SidebarProps) {
  const { user, result } = useEngine()
  const pending = result.drafts.filter((d) => d.state === 'pending_review').length

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
        {navFor(user?.role).map(({ to, label, icon: Icon, badge }) => (
          <NavItem
            key={to}
            to={to}
            label={badge === 'pending_drafts' && pending > 0 ? `${label} (${pending})` : label}
            icon={<Icon size={18} />}
            iconOnly={collapsed}
          />
        ))}
      </nav>
    </aside>
  )
}
