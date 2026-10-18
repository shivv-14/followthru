import { ChevronsLeft, ChevronsRight } from 'lucide-react'
import { Link } from 'react-router-dom'
import clsx from 'clsx'
import { NavItem } from '../ui'
import { useEngine } from '../../store'
import { isSnoozed } from '../../engine/drafts'
import { navFor } from './nav'

export interface SidebarProps {
  collapsed: boolean
  onToggle: () => void
}

export function Sidebar({ collapsed, onToggle }: SidebarProps) {
  const { user, result, now } = useEngine()
  const pending = result.drafts.filter((d) => d.state === 'pending_review' && !isSnoozed(d, now)).length

  return (
    <aside
      className={clsx(
        'sticky top-0 hidden h-dvh flex-col gap-1 border-r border-surface-border bg-black/40 p-3 backdrop-blur-xl transition-[width] duration-200 md:flex',
        collapsed ? 'w-[76px]' : 'w-60',
      )}
    >
      <div className={clsx('mb-4 flex items-center gap-2 px-1', collapsed ? 'flex-col' : 'justify-between')}>
        <Link to="/" className="flex items-center gap-2.5" aria-label="FollowThru home">
          <span className="grid size-10 shrink-0 place-items-center rounded-full bg-white shadow-[0_4px_14px_rgba(0,0,0,0.25)]">
            <img src="/logo.svg" alt="" width={28} height={28} className="rounded-[22%]" />
          </span>
          {!collapsed && <span className="text-sm font-semibold tracking-tight text-text-primary">FollowThru</span>}
        </Link>
        <button
          type="button"
          onClick={onToggle}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-expanded={!collapsed}
          className="grid size-8 place-items-center rounded-full text-text-muted hover:bg-surface-hover hover:text-text-primary"
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
