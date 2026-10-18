import { type FormEvent, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams, useNavigate } from 'react-router-dom'
import { Button, Card, CardHeader, CardTitle, EmptyState, Textarea } from '../components/ui'
import { CommitmentStatus, Notice, PageHeader, useActionNotice } from '../components/domain/parts'
import { shortTime } from '../components/domain/view'
import { useEngine } from '../store'
import { useChatTeams, useTeamChat } from '../store/chat'
import type { Commitment } from '../engine/types'

export default function TeamChat() {
  const { teamId: routeTeam } = useParams()
  const navigate = useNavigate()
  const teams = useChatTeams()
  const teamId = routeTeam ?? teams[0]?.id ?? null
  const { lines, post, error, me } = useTeamChat(teamId)
  const { result, now, dataset } = useEngine()
  const notice = useActionNotice()
  const [text, setText] = useState('')
  const [replyTo, setReplyTo] = useState<string | null>(null)
  const end = useRef<HTMLDivElement>(null)

  // Which commitment each chat line opened or updated
  const byLine = useMemo(() => {
    const map = new Map<string, Commitment>()
    for (const c of result.commitments) {
      if (c.sourceMessageId) map.set(c.sourceMessageId, c)
      for (const id of c.linkedMessageIds ?? []) if (!map.has(id)) map.set(id, c)
    }
    return map
  }, [result.commitments])

  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' })
  }, [lines.length])

  async function send(event: FormEvent) {
    event.preventDefault()
    await notice.run(async () => {
      const res = await post(text, replyTo ?? undefined)
      if (res.ok) {
        setText('')
        setReplyTo(null)
      }
      return res
    })
  }

  const replying = replyTo ? lines.find((l) => l.id === replyTo) : undefined

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="Team chat"
        description="Talk with your team here. FollowThru reads the whole conversation to keep each commitment's owner, deadline and status up to date. Messages stay inside the app."
      />
      {!dataset && teams.length === 0 ? (
        <EmptyState title="No data yet" description="A coordinator needs to import data or create the workspace teams first." />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[220px_1fr]">
          <Card>
            <CardHeader>
              <CardTitle>Chats</CardTitle>
            </CardHeader>
            <ul className="flex flex-row flex-wrap gap-2 lg:flex-col">
              {teams.map((t) => (
                <li key={t.id}>
                  <button
                    type="button"
                    onClick={() => navigate(`/chat/${encodeURIComponent(t.id)}`)}
                    aria-current={t.id === teamId ? 'page' : undefined}
                    className={
                      t.id === teamId
                        ? 'w-full rounded-full bg-white px-4 py-2 text-left text-sm font-semibold text-black'
                        : 'w-full rounded-full border border-pill-border bg-pill px-4 py-2 text-left text-sm text-pill-text hover:text-white'
                    }
                  >
                    {t.title}
                  </button>
                </li>
              ))}
            </ul>
          </Card>

          <Card className="flex min-h-[420px] flex-col">
            <CardHeader>
              <CardTitle>{teams.find((t) => t.id === teamId)?.title ?? 'Choose a chat'}</CardTitle>
              <span className="text-xs text-text-faint">{lines.length} messages</span>
            </CardHeader>
            {error ? <p className="mb-2 text-sm text-status-overdue">{error}</p> : null}
            <div className="mb-3 flex max-h-[55vh] flex-1 flex-col gap-3 overflow-y-auto pr-1" aria-live="polite">
              {lines.length === 0 ? (
                <p className="text-sm text-text-muted">No messages yet. Try: “Asha, please send the pricing sheet by Friday 5pm.”</p>
              ) : (
                lines.map((l) => {
                  const c = byLine.get(l.id)
                  const parent = l.replyToId ? lines.find((x) => x.id === l.replyToId) : undefined
                  return (
                    <div key={l.id} className={l.authorId === me ? 'ml-auto max-w-[85%] rounded-2xl bg-surface-hover p-3' : 'mr-auto max-w-[85%] rounded-2xl border border-surface-border p-3'}>
                      <p className="mb-1 text-xs text-text-faint">
                        <span className="font-semibold text-text-primary">{l.authorName}</span> · {shortTime(l.sentAt)}
                      </p>
                      {parent ? <p className="mb-1 border-l-2 border-surface-border pl-2 text-xs text-text-faint">↪ {parent.authorName}: {parent.text.slice(0, 80)}</p> : null}
                      <p className="whitespace-pre-wrap break-words text-sm text-text-primary">{l.text}</p>
                      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                        {c ? (
                          <Link to={`/commitments/${c.id}`} className="inline-flex items-center gap-1.5 rounded-full border border-surface-border px-2 py-0.5 text-text-muted hover:text-accent">
                            {c.sourceMessageId === l.id ? 'Commitment' : 'Update to'}: {c.title} <CommitmentStatus c={c} now={now} />
                          </Link>
                        ) : null}
                        <button type="button" className="text-accent hover:underline" onClick={() => setReplyTo(l.id)}>
                          Reply
                        </button>
                      </div>
                    </div>
                  )
                })
              )}
              <div ref={end} />
            </div>
            <form onSubmit={send} className="flex flex-col gap-2" noValidate>
              {replying ? (
                <p className="text-xs text-text-muted">
                  Replying to {replying.authorName}: “{replying.text.slice(0, 60)}”{' '}
                  <button type="button" className="text-accent hover:underline" onClick={() => setReplyTo(null)}>
                    Cancel
                  </button>
                </p>
              ) : null}
              <Textarea label="Message" value={text} onChange={(e) => setText(e.target.value)} rows={2} placeholder="I'll finish the login page by Friday" maxLength={2000} />
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-text-faint">Silence never closes work. Only the owner, the requester or a coordinator can change a status.</span>
                <Button type="submit" disabled={notice.busy || !teamId || teams.length === 0 || !text.trim()}>
                  Send
                </Button>
              </div>
            </form>
            <Notice result={notice.result} />
          </Card>
        </div>
      )}
    </div>
  )
}
