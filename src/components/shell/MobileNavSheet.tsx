import { Dialog, NavItem } from '../ui'
import { useEngine } from '../../store'
import { navFor } from './nav'

export interface MobileNavSheetProps {
  open: boolean
  onClose: () => void
}

export function MobileNavSheet({ open, onClose }: MobileNavSheetProps) {
  const { user } = useEngine()
  return (
    <Dialog open={open} onClose={onClose} title="Navigate" variant="sheet">
      <nav aria-label="All sections" className="flex flex-col gap-1" onClick={onClose}>
        {navFor(user?.role).map(({ to, label, icon: Icon }) => (
          <NavItem key={to} to={to} label={label} icon={<Icon size={18} />} />
        ))}
      </nav>
    </Dialog>
  )
}
