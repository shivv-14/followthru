import { Link } from 'react-router-dom'
import { shortTime } from '../view'
import type { ChatSearchHit } from '../../../store/chat'

/** Hits from every chat the person may open, newest first, each linking to its chat. */
export function ChatSearchResults({ query, results, onClose }: { query: string; results: ChatSearchHit[]; onClose: () => void }) {
  return (
    <section aria-label="Search results from all chats" className="mb-3 rounded-xl border border-surface-border p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-sm text-text-primary">
          {results.length} {results.length === 1 ? 'message' : 'messages'} matching “{query}” in all your chats
        </p>
        <button type="button" className="text-xs text-accent hover:underline" onClick={onClose}>
          Close results
        </button>
      </div>
      {results.length === 0 ? (
        <p className="text-sm text-text-muted">Nothing found.</p>
      ) : (
        <ul className="flex max-h-60 flex-col gap-2 overflow-y-auto">
          {results.map((r) => (
            <li key={r.id} className="rounded-lg border border-surface-border p-2 text-sm">
              <p className="text-xs text-text-faint">
                <Link to={`/chat/${encodeURIComponent(r.teamId)}`} className="text-accent hover:underline" onClick={onClose}>
                  {r.chatTitle}
                </Link>{' '}
                · {r.authorName} · {shortTime(r.sentAt)}
              </p>
              <p className="break-words text-text-primary">{r.text}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
