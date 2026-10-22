import { type FormEvent, type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Button, Card, CardHeader, CardTitle, EmptyState, Input } from '../components/ui'
import { Notice, PageHeader, useActionNotice } from '../components/domain/parts'
import { ChatBubble } from '../components/domain/chat/ChatBubble'
import { ChatSearchResults } from '../components/domain/chat/ChatSearchResults'
import { MentionTextarea } from '../components/domain/chat/MentionTextarea'
import { useEngine } from '../store'
import { useChatSearch, useChatTeams, useTeamChat, type ChatLine, type ChatSearchHit } from '../store/chat'
import { groupThreads, matchesSearch, threadRoot, type Reaction } from '../lib/chat'
import type { Commitment } from '../engine/types'

export default function TeamChat() {
  const { teamId: routeTeam } = useParams()
  const navigate = useNavigate()
  const teams = useChatTeams()
  const teamId = routeTeam ?? teams[0]?.id ?? null
  const { lines, post, react, error, me } = useTeamChat(teamId)
  const searchAll = useChatSearch(teams)
  const { result, now, dataset, people } = useEngine()
  const notice = useActionNotice()
  const [text, setText] = useState('')
  const [replyTo, setReplyTo] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [found, setFound] = useState<{ query: string; results: ChatSearchHit[] } | null>(null)
  const [sideError, setSideError] = useState('')
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
  const byId = useMemo(() => new Map(lines.map((l) => [l.id, l])), [lines])
  const { roots, replies } = useMemo(() => groupThreads(lines), [lines])
  const searching = query.trim().length > 0
  const matches = searching ? lines.filter((l) => matchesSearch(l, query)) : []

  useEffect(() => {
    setReplyTo(null)
    setQuery('')
    setExpanded(new Set())
  }, [teamId])

  useEffect(() => {
    if (!searching) end.current?.scrollIntoView({ block: 'end' })
  }, [lines.length, searching])

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

  function startReply(l: ChatLine) {
    setReplyTo(l.id)
    // Open the thread so the reply shows up in place once it is posted
    const root = threadRoot(l, byId)
    setExpanded((cur) => new Set(cur).add(root))
  }

  async function onReact(id: string, emoji: Reaction, on: boolean) {
    const res = await react(id, emoji, on)
    setSideError(res.ok ? '' : res.message)
  }

  async function onSearchAll() {
    const res = await searchAll(query)
    setSideError(res.ok ? '' : res.message)
    if (res.ok) setFound({ query: query.trim(), results: res.results })
  }

  const toggle = (id: string) =>
    setExpanded((cur) => {
      const next = new Set(cur)
      if (!next.delete(id)) next.add(id)
      return next
    })

  const bubble = (l: ChatLine, opts: { parent?: ChatLine; compact?: boolean; children?: ReactNode } = {}) => (
    <ChatBubble key={l.id} line={l} me={me} now={now} people={people} commitment={byLine.get(l.id)} parent={opts.parent} compact={opts.compact} onReply={() => startReply(l)} onReact={(e, on) => void onReact(l.id, e, on)}>
      {opts.children}
    </ChatBubble>
  )

  const threadOf = (root: ChatLine) => {
    const thread = replies.get(root.id) ?? []
    if (thread.length === 0) return null
    const open = expanded.has(root.id)
    return (
      <div className="mt-2">
        <button type="button" aria-expanded={open} className="text-xs font-medium text-accent hover:underline" onClick={() => toggle(root.id)}>
          {open ? 'Hide replies' : `${thread.length} ${thread.length === 1 ? 'reply' : 'replies'}`}
        </button>
        {open ? (
          <div className="mt-2 flex flex-col gap-2 border-l-2 border-surface-border pl-3" aria-label={`Thread of ${root.authorName}`}>
            {thread.map((r) => bubble(r, { compact: true, parent: r.replyToId && r.replyToId !== root.id ? byId.get(r.replyToId) : undefined }))}
          </div>
        ) : null}
      </div>
    )
  }

  const replying = replyTo ? byId.get(replyTo) : undefined

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="Team chat"
        description="Talk with your team here. FollowThru reads the whole conversation to keep each commitment's owner, deadline and status up to date. Messages stay inside the app; reactions are never read as commitments."
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
              <span className="text-xs text-text-faint">{searching ? `${matches.length} of ${lines.length} messages` : `${lines.length} messages`}</span>
            </CardHeader>
            <div className="mb-3 flex flex-wrap items-end gap-2">
              <div className="min-w-0 flex-1">
                <Input label="Search this chat" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Words or a name" />
              </div>
              <Button variant="secondary" disabled={query.trim().length < 2} onClick={() => void onSearchAll()}>
                Search all my chats
              </Button>
            </div>
            {found ? <ChatSearchResults query={found.query} results={found.results} onClose={() => setFound(null)} /> : null}
            {error || sideError ? <p className="mb-2 text-sm text-status-overdue">{error || sideError}</p> : null}
            <div className="mb-3 flex max-h-[55vh] flex-1 flex-col gap-3 overflow-y-auto pr-1" aria-live="polite">
              {lines.length === 0 ? (
                <p className="text-sm text-text-muted">No messages yet. Try: “Asha, please send the pricing sheet by Friday 5pm.”</p>
              ) : searching ? (
                matches.length === 0 ? (
                  <p className="text-sm text-text-muted">No messages in this chat match “{query.trim()}”.</p>
                ) : (
                  matches.map((l) => bubble(l, { parent: l.replyToId ? byId.get(l.replyToId) : undefined }))
                )
              ) : (
                roots.map((l) => bubble(l, { children: threadOf(l) }))
              )}
              <div ref={end} />
            </div>
            <form onSubmit={send} className="flex flex-col gap-2" noValidate>
              {replying ? (
                <p className="text-xs text-text-muted">
                  Replying in thread to {replying.authorName}: “{replying.text.slice(0, 60)}”{' '}
                  <button type="button" className="text-accent hover:underline" onClick={() => setReplyTo(null)}>
                    Cancel
                  </button>
                </p>
              ) : null}
              <MentionTextarea label="Message" value={text} onChange={setText} people={[...people.values()]} placeholder="I'll finish the login page by Friday. Type @ to mention someone." maxLength={2000} />
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
