import { NavLink } from 'react-router-dom'
import clsx from 'clsx'
import { useEngine } from '../../store'
import { navFor } from './nav'

export function BottomTabBar() {
  const { user, result } = useEngine()
  const pending = result.drafts.filter((d) => d.state === 'pending_review').length
  // At most five tabs; the mobile sheet lists everything
  const items = navFor(user?.role).filter((i) => i.to !== '/flows').slice(0, 5)

  return (
    <nav
      aria-label="Primary"
      className="glass-surface fixed inset-x-0 bottom-0 z-20 flex rounded-none border-x-0 border-b-0 pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      {items.map(({ to, short, icon: Icon, badge }) => (
        <NavLink
          key={to}
          to={to}
          className={({ isActive }) =>
            clsx(
              'relative flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] font-medium transition-colors duration-200',
              isActive ? 'text-accent' : 'text-text-muted',
            )
          }
        >
          <Icon size={18} aria-hidden />
          {short}
          {badge === 'pending_drafts' && pending > 0 ? (
            <span className="absolute right-1/4 top-1 rounded-full bg-status-overdue px-1 text-[9px] text-white" aria-label={`${pending} drafts to review`}>
              {pending}
            </span>
          ) : null}
        </NavLink>
      ))}
    </nav>
  )
}
