import type { ReactNode } from 'react'
import { Button } from './Button'

export interface EmptyStateProps {
  title: string
  description?: string
  action?: { label: string; onClick: () => void }
  icon?: ReactNode
}

export function EmptyState({ title, description, action, icon }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-surface-border px-6 py-12 text-center">
      {icon}
      <p className="font-display text-base font-semibold text-text-primary">{title}</p>
      {description ? <p className="max-w-sm text-sm text-text-muted">{description}</p> : null}
      {action ? (
        <Button size="sm" variant="secondary" onClick={action.onClick} className="mt-2">
          {action.label}
        </Button>
      ) : null}
    </div>
  )
}

export interface LoadingStateProps {
  label?: string
  rows?: number
}

export function LoadingState({ label = 'Loading', rows = 3 }: LoadingStateProps) {
  return (
    <div role="status" aria-label={label} className="flex flex-col gap-2">
      {Array.from({ length: rows }).map((_, index) => (
        <div
          key={index}
          className="h-14 animate-pulse rounded-lg bg-surface motion-reduce:animate-none"
        />
      ))}
      <span className="sr-only">{label}</span>
    </div>
  )
}

export interface ErrorStateProps {
  title?: string
  description?: string
  onRetry?: () => void
}

export function ErrorState({ title = 'Something went wrong', description, onRetry }: ErrorStateProps) {
  return (
    <div
      role="alert"
      className="flex flex-col items-center gap-2 rounded-lg border border-status-overdue/40 bg-status-overdue/10 px-6 py-10 text-center"
    >
      <p className="font-display text-base font-semibold text-status-overdue">{title}</p>
      {description ? <p className="max-w-sm text-sm text-text-muted">{description}</p> : null}
      {onRetry ? (
        <Button size="sm" variant="secondary" onClick={onRetry} className="mt-2">
          Retry
        </Button>
      ) : null}
    </div>
  )
}
