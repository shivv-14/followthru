import { LayoutDashboard, ListChecks, Inbox, Workflow, Users, FileCheck2 } from 'lucide-react'
import { Dialog, NavItem } from '../ui'

const items = [
  { to: '/dashboard', label: 'Dashboard', icon: <LayoutDashboard size={18} /> },
  { to: '/commitments', label: 'Commitments', icon: <ListChecks size={18} /> },
  { to: '/queue', label: 'Queue', icon: <Inbox size={18} /> },
  { to: '/flows', label: 'Flows', icon: <Workflow size={18} /> },
  { to: '/team', label: 'Team / Me', icon: <Users size={18} /> },
  { to: '/evidence', label: 'Evidence', icon: <FileCheck2 size={18} /> },
]

export interface MobileNavSheetProps {
  open: boolean
  onClose: () => void
}

export function MobileNavSheet({ open, onClose }: MobileNavSheetProps) {
  return (
    <Dialog open={open} onClose={onClose} title="Navigate" variant="sheet">
      <nav aria-label="All sections" className="flex flex-col gap-1" onClick={onClose}>
        {items.map((item) => (
          <NavItem key={item.to} to={item.to} label={item.label} icon={item.icon} />
        ))}
      </nav>
    </Dialog>
  )
}
