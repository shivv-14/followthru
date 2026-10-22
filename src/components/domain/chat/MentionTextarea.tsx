import { useId, useRef, useState, type KeyboardEvent } from 'react'
import clsx from 'clsx'
import { Textarea } from '../../ui'
import { mentionQuery } from '../../../lib/chat'
import type { Person } from '../../../engine/types'

interface Props {
  label: string
  value: string
  onChange: (value: string) => void
  people: Person[]
  placeholder?: string
  maxLength?: number
}

const MAX_SUGGESTIONS = 6

/** Message box that suggests workspace people after "@" and inserts "@Full Name". */
export function MentionTextarea({ label, value, onChange, people, placeholder, maxLength }: Props) {
  const ref = useRef<HTMLTextAreaElement>(null)
  const listId = useId()
  const [caret, setCaret] = useState(0)
  const [active, setActive] = useState(0)
  const [dismissed, setDismissed] = useState(false)
  const token = mentionQuery(value, caret)
  const q = token?.query.toLowerCase() ?? ''
  const matches = token && !dismissed ? people.filter((p) => p.name.toLowerCase().split(/\s+/).some((part) => part.startsWith(q)) || p.name.toLowerCase().startsWith(q)).slice(0, MAX_SUGGESTIONS) : []
  const open = matches.length > 0

  function pick(p: Person) {
    if (!token) return
    const insert = `@${p.name} `
    const next = value.slice(0, token.start) + insert + value.slice(caret)
    const pos = token.start + insert.length
    onChange(next)
    setCaret(pos)
    setActive(0)
    requestAnimationFrame(() => {
      ref.current?.focus()
      ref.current?.setSelectionRange(pos, pos)
    })
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (!open) return
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => (i + (e.key === 'ArrowDown' ? 1 : matches.length - 1)) % matches.length)
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault()
      pick(matches[Math.min(active, matches.length - 1)])
    } else if (e.key === 'Escape') {
      e.preventDefault()
      setDismissed(true)
    }
  }

  return (
    <div className="relative">
      <Textarea
        ref={ref}
        label={label}
        value={value}
        rows={2}
        placeholder={placeholder}
        maxLength={maxLength}
        aria-controls={open ? listId : undefined}
        aria-autocomplete="list"
        aria-activedescendant={open ? `${listId}-${Math.min(active, matches.length - 1)}` : undefined}
        onChange={(e) => {
          onChange(e.target.value)
          setCaret(e.target.selectionStart ?? e.target.value.length)
          setDismissed(false)
          setActive(0)
        }}
        onSelect={(e) => setCaret(e.currentTarget.selectionStart ?? 0)}
        onKeyDown={onKeyDown}
      />
      {open ? (
        <ul id={listId} role="listbox" aria-label="People to mention" className="absolute bottom-full left-0 z-10 mb-1 max-h-56 w-64 overflow-y-auto rounded-xl border border-surface-border bg-bg p-1 shadow-lg">
          {matches.map((p, i) => (
            <li
              key={p.id}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => {
                e.preventDefault()
                pick(p)
              }}
              className={clsx('cursor-pointer rounded-lg px-3 py-1.5 text-sm', i === active ? 'bg-surface-hover text-text-primary' : 'text-text-muted')}
            >
              {p.name}
              {p.teamId ? <span className="ml-2 text-xs text-text-faint">Team {p.teamId}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
