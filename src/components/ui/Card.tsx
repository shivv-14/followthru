import type { HTMLAttributes } from 'react'
import clsx from 'clsx'

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={clsx(
        'glass-surface rounded-[22px] p-5',
        className,
      )}
      {...props}
    />
  )
}

export function CardHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={clsx('mb-3 flex items-center justify-between gap-2', className)} {...props} />
}

export function CardTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={clsx('font-display text-base font-semibold tracking-tight text-text-primary', className)} {...props} />
}
