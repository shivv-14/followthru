import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import clsx from 'clsx'
import { CommitmentStatus } from '../parts'
import { shortTime } from '../view'
import { REACTIONS, type Reaction } from '../../../lib/chat'
import type { Commitment, Person } from '../../../engine/types'
import type { ChatLine } from '../../../store/chat'

interface Props {
  line: ChatLine
  me: string | null
  now: string
  people: Map<string, Person>
  commitment?: Commitment
  /** Shown above the text when the parent is not visible next to this line */
  parent?: ChatLine
  compact?: boolean
  busy?: boolean
  onReply: () => void
  onReact: (emoji: Reaction, on: boolean) => void
  children?: ReactNode
}

/** One chat line with its commitment link, emoji reactions and reply action. */
export function ChatBubble({ line, me, now, people, commitment: c, parent, compact, busy, onReply, onReact, children }: Props) {
  const mine = line.authorId === me
  return (
    <div
      data-testid="chat-line"
      data-line-id={line.id}
      className={clsx(
        'rounded-2xl p-3',
        compact ? 'w-full' : 'max-w-[85%]',
        mine ? (compact ? 'bg-surface-hover' : 'ml-auto bg-surface-hover') : compact ? 'border border-surface-border' : 'mr-auto border border-surface-border',
      )}
    >
      <p className="mb-1 text-xs text-text-faint">
        <span className="font-semibold text-text-primary">{line.authorName}</span> · {shortTime(line.sentAt)}
      </p>
      {parent ? (
        <p className="mb-1 border-l-2 border-surface-border pl-2 text-xs text-text-faint">
          ↪ {parent.authorName}: {parent.text.slice(0, 80)}
        </p>
      ) : null}
      <p className="whitespace-pre-wrap break-words text-sm text-text-primary">{line.text}</p>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
        {c ? (
          <Link to={`/commitments/${c.id}`} className="inline-flex items-center gap-1.5 rounded-full border border-surface-border px-2 py-0.5 text-text-muted hover:text-accent">
            {c.sourceMessageId === line.id ? 'Commitment' : 'Update to'}: {c.title} <CommitmentStatus c={c} now={now} />
          </Link>
        ) : null}
        <span className="inline-flex flex-wrap gap-1" role="group" aria-label="Reactions">
          {REACTIONS.map((emoji) => {
            const who = line.reactions?.[emoji] ?? []
            const pressed = !!me && who.includes(me)
            const names = who.map((id) => people.get(id)?.name ?? id).join(', ')
            return (
              <button
                key={emoji}
                type="button"
                disabled={busy || !me}
                aria-pressed={pressed}
                aria-label={`React with ${emoji}${who.length ? ` (${who.length})` : ''}`}
                title={names || `React with ${emoji}`}
                onClick={() => onReact(emoji, !pressed)}
                className={clsx(
                  'rounded-full border px-1.5 py-0.5 leading-none transition-colors',
                  pressed ? 'border-accent bg-accent/15 text-text-primary' : 'border-surface-border text-text-muted hover:text-text-primary',
                  who.length === 0 && 'opacity-60 hover:opacity-100',
                )}
              >
                {emoji}
                {who.length ? <span className="ml-1">{who.length}</span> : null}
              </button>
            )
          })}
        </span>
        <button type="button" className="text-accent hover:underline" onClick={onReply}>
          Reply
        </button>
      </div>
      {children}
    </div>
  )
}
