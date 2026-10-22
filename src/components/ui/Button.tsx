import { type ButtonHTMLAttributes, forwardRef } from 'react'
import clsx from 'clsx'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
export type ButtonSize = 'sm' | 'md' | 'lg'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
}

const variantClass: Record<ButtonVariant, string> = {
  // Same pills as the landing: glowing white for the main action, dark for the rest
  primary: 'pill-glow bg-white text-black font-semibold hover:-translate-y-px active:translate-y-0',
  secondary: 'bg-pill text-pill-text border border-pill-border hover:bg-[#323234] hover:text-white',
  ghost: 'bg-transparent text-text-primary hover:bg-surface-hover',
  danger: 'bg-[#ff5d6c] text-black font-semibold hover:bg-[#ff7480]',
}

const sizeClass: Record<ButtonSize, string> = {
  sm: 'h-8 px-3.5 text-sm gap-1.5',
  md: 'h-10 px-5 text-sm gap-2',
  lg: 'h-12 px-7 text-base gap-2',
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', className, disabled, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={props.type ?? 'button'}
      disabled={disabled}
      aria-disabled={disabled}
      className={clsx(
        'inline-flex items-center justify-center rounded-full font-medium transition-[color,background-color,box-shadow,transform] duration-200',
        'disabled:cursor-not-allowed disabled:opacity-40',
        variantClass[variant],
        sizeClass[size],
        className,
      )}
      {...props}
    />
  )
})
