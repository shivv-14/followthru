import { type SelectHTMLAttributes, type TextareaHTMLAttributes, forwardRef, useId } from 'react'
import clsx from 'clsx'

const control =
  'rounded-md border border-surface-border bg-surface px-3 text-sm text-text-primary placeholder:text-text-faint transition-colors duration-200 focus-visible:outline-none'

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label: string
  hint?: string
  hideLabel?: boolean
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select({ label, hint, hideLabel, className, id, children, ...props }, ref) {
  const generated = useId()
  const selectId = id ?? generated
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={selectId} className={clsx('text-sm font-medium text-text-primary', hideLabel && 'sr-only')}>
        {label}
      </label>
      <select ref={ref} id={selectId} className={clsx(control, 'h-10 [&>option]:bg-bg', className)} {...props}>
        {children}
      </select>
      {hint ? <span className="text-xs text-text-muted">{hint}</span> : null}
    </div>
  )
})

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: string
  hint?: string
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea({ label, hint, className, id, ...props }, ref) {
  const generated = useId()
  const areaId = id ?? generated
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={areaId} className="text-sm font-medium text-text-primary">
        {label}
      </label>
      <textarea ref={ref} id={areaId} className={clsx(control, 'min-h-20 py-2', className)} {...props} />
      {hint ? <span className="text-xs text-text-muted">{hint}</span> : null}
    </div>
  )
})
