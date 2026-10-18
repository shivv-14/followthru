import { NavLink } from 'react-router-dom'
import clsx from 'clsx'
import { useEngine } from '../../store'
import { isSnoozed } from '../../engine/drafts'
import { navFor } from './nav'

export function BottomTabBar() {
  const { user, result, now } = useEngine()
  const pending = result.drafts.filter((d) => d.state === 'pending_review' && !isSnoozed(d, now)).length
  // At most five tabs; the mobile sheet lists everything
  const items = navFor(user?.role).filter((i) => i.to !== '/flows').slice(0, 5)

  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-3 bottom-[max(12px,env(safe-area-inset-bottom))] z-20 flex rounded-full border border-surface-border bg-[#0b0b0d]/85 p-1 shadow-[0_10px_30px_rgba(0,0,0,0.5)] backdrop-blur-xl md:hidden"
    >
      {items.map(({ to, short, icon: Icon, badge }) => (
        <NavLink
          key={to}
          to={to}
          className={({ isActive }) =>
            clsx(
              'relative flex flex-1 flex-col items-center gap-0.5 rounded-full py-1.5 text-[11px] font-medium transition-colors duration-200',
              isActive ? 'bg-white text-black' : 'text-text-muted',
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
