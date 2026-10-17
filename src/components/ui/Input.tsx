import { type InputHTMLAttributes, forwardRef, useId } from 'react'
import clsx from 'clsx'

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string
  error?: string
  hint?: string
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, error, hint, className, id, ...props },
  ref,
) {
  const generatedId = useId()
  const inputId = id ?? generatedId
  const hintId = hint ? `${inputId}-hint` : undefined
  const errorId = error ? `${inputId}-error` : undefined

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={inputId} className="text-sm font-medium text-text-primary">
        {label}
      </label>
      <input
        ref={ref}
        id={inputId}
        aria-invalid={Boolean(error)}
        aria-describedby={clsx(hintId, errorId) || undefined}
        className={clsx(
          'h-10 rounded-xl border bg-white/[0.04] px-3.5 text-sm text-text-primary placeholder:text-text-faint',
          'transition-colors duration-200 hover:border-white/20 focus-visible:border-white/60 focus-visible:outline-none',
          error ? 'border-status-overdue' : 'border-surface-border',
          className,
        )}
        {...props}
      />
      {hint && !error ? (
        <span id={hintId} className="text-xs text-text-muted">
          {hint}
        </span>
      ) : null}
      {error ? (
        <span id={errorId} role="alert" className="text-xs text-status-overdue">
          {error}
        </span>
      ) : null}
    </div>
  )
})
