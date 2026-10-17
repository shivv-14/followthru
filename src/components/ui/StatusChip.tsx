import clsx from 'clsx'
import type { StatusColorKey } from '../../styles/tokens'

export interface StatusChipProps {
  status: StatusColorKey
  label: string
  className?: string
}

const dotClass: Record<StatusColorKey, string> = {
  done: 'bg-status-done',
  overdue: 'bg-status-overdue',
  tentative: 'bg-status-tentative',
  deferred: 'bg-status-deferred',
  cancelled: 'bg-status-cancelled',
}

const textClass: Record<StatusColorKey, string> = {
  done: 'text-status-done',
  overdue: 'text-status-overdue',
  tentative: 'text-status-tentative',
  deferred: 'text-status-deferred',
  cancelled: 'text-status-cancelled',
}

export function StatusChip({ status, label, className }: StatusChipProps) {
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1.5 rounded-full border border-surface-border bg-surface px-2.5 py-1 text-xs font-medium',
        textClass[status],
        className,
      )}
    >
      <span aria-hidden className={clsx('size-1.5 rounded-full', dotClass[status])} />
      {label}
    </span>
  )
}
