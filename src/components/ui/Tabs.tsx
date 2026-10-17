import { type KeyboardEvent, useId, useState } from 'react'
import clsx from 'clsx'

export interface TabItem {
  value: string
  label: string
  content: React.ReactNode
}

export interface TabsProps {
  items: TabItem[]
  defaultValue?: string
  className?: string
}

export function Tabs({ items, defaultValue, className }: TabsProps) {
  const baseId = useId()
  const [active, setActive] = useState(defaultValue ?? items[0]?.value)
  const activeIndex = items.findIndex((item) => item.value === active)

  function focusTab(index: number) {
    const wrapped = (index + items.length) % items.length
    const next = items[wrapped]
    setActive(next.value)
    document.getElementById(`${baseId}-tab-${next.value}`)?.focus()
  }

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === 'ArrowRight') {
      event.preventDefault()
      focusTab(activeIndex + 1)
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault()
      focusTab(activeIndex - 1)
    } else if (event.key === 'Home') {
      event.preventDefault()
      focusTab(0)
    } else if (event.key === 'End') {
      event.preventDefault()
      focusTab(items.length - 1)
    }
  }

  return (
    <div className={className}>
      <div role="tablist" className="flex gap-1 overflow-x-auto border-b border-surface-border [scrollbar-width:thin]">
        {items.map((item) => {
          const selected = item.value === active
          return (
            <button
              key={item.value}
              id={`${baseId}-tab-${item.value}`}
              role="tab"
              type="button"
              aria-selected={selected}
              aria-controls={`${baseId}-panel-${item.value}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => setActive(item.value)}
              onKeyDown={onKeyDown}
              className={clsx(
                'shrink-0 whitespace-nowrap px-3 py-2 text-sm font-medium transition-colors duration-200',
                selected
                  ? 'border-b-2 border-accent text-text-primary'
                  : 'border-b-2 border-transparent text-text-muted hover:text-text-primary',
              )}
            >
              {item.label}
            </button>
          )
        })}
      </div>
      {items.map((item) => (
        <div
          key={item.value}
          id={`${baseId}-panel-${item.value}`}
          role="tabpanel"
          aria-labelledby={`${baseId}-tab-${item.value}`}
          hidden={item.value !== active}
          className="pt-4"
        >
          {item.value === active ? item.content : null}
        </div>
      ))}
    </div>
  )
}
