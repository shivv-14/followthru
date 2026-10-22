import { type ReactNode, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import clsx from 'clsx'

export interface DialogProps {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  /** Bottom sheet on small screens, centered dialog from sm breakpoint up. */
  variant?: 'auto' | 'sheet' | 'modal'
}

const FOCUSABLE = 'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])'

export function Dialog({ open, onClose, title, children, variant = 'auto' }: DialogProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<Element | null>(null)
  const reducedMotion = useReducedMotion()

  useEffect(() => {
    if (!open) return
    triggerRef.current = document.activeElement
    const panel = panelRef.current
    const first = panel?.querySelector<HTMLElement>(FOCUSABLE)
    first?.focus()

    function onKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === 'Escape') {
        onClose()
        return
      }
      if (event.key !== 'Tab' || !panel) return
      const focusable = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE))
      if (focusable.length === 0) return
      const firstEl = focusable[0]
      const lastEl = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === firstEl) {
        event.preventDefault()
        lastEl.focus()
      } else if (!event.shiftKey && document.activeElement === lastEl) {
        event.preventDefault()
        firstEl.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      if (triggerRef.current instanceof HTMLElement) triggerRef.current.focus()
    }
  }, [open, onClose])

  const sheet = variant === 'sheet' || variant === 'auto'
  const transition = reducedMotion
    ? { duration: 0 }
    : ({ type: 'spring', stiffness: 320, damping: 32 } as const)

  return createPortal(
    <AnimatePresence>
      {open ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
          <motion.div
            className="absolute inset-0 bg-black/70 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reducedMotion ? 0 : 0.2 }}
            onClick={onClose}
            aria-hidden
          />
          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="dialog-title"
            initial={sheet ? { y: '100%' } : { opacity: 0, scale: 0.96 }}
            animate={sheet ? { y: 0 } : { opacity: 1, scale: 1 }}
            exit={sheet ? { y: '100%' } : { opacity: 0, scale: 0.96 }}
            transition={transition}
            className={clsx(
              'relative z-10 w-full max-h-[85dvh] overflow-y-auto border border-surface-border bg-[#0b0b0d]/95 p-5 shadow-[0_20px_60px_rgba(0,0,0,0.6)] backdrop-blur-xl',
              'pb-[calc(1.25rem+env(safe-area-inset-bottom))]',
              sheet
                ? 'rounded-t-[28px] sm:max-w-md sm:rounded-[28px] sm:mb-0'
                : 'max-w-md rounded-[28px]',
            )}
          >
            <div className="mb-4 flex items-center justify-between gap-2">
              <h2 id="dialog-title" className="font-display text-lg font-semibold text-text-primary">
                {title}
              </h2>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close dialog"
                className="grid size-8 place-items-center rounded-full bg-pill text-pill-text hover:bg-[#323234] hover:text-white"
              >
                ✕
              </button>
            </div>
            {children}
          </motion.div>
        </div>
      ) : null}
    </AnimatePresence>,
    document.body,
  )
}
