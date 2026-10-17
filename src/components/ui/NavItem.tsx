import type { ReactNode } from 'react'
import { NavLink } from 'react-router-dom'
import clsx from 'clsx'

export interface NavItemProps {
  to: string
  label: string
  icon: ReactNode
  /** Hides the text label and shows only the icon, e.g. collapsed desktop sidebar. */
  iconOnly?: boolean
}

export function NavItem({ to, label, icon, iconOnly }: NavItemProps) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        clsx(
          'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors duration-200',
          isActive ? 'bg-accent-muted text-text-primary' : 'text-text-muted hover:bg-surface hover:text-text-primary',
        )
      }
    >
      <span aria-hidden className="shrink-0">
        {icon}
      </span>
      <span className={clsx(iconOnly && 'sr-only')}>{label}</span>
    </NavLink>
  )
}
