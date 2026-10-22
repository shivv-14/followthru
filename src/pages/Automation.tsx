import { type FormEvent, useCallback, useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Button, Card, CardHeader, CardTitle, EmptyState, Input, Select, Textarea } from '../components/ui'
import { Notice, PageHeader, Stat, useActionNotice } from '../components/domain/parts'
import { SlackCard, type SlackStatus } from '../components/domain/SlackCard'
import { shortTime } from '../components/domain/view'
import { callApi } from '../cloud/api'
import { useEngine } from '../store'

interface Account {
  id: string
  email: string
  status: string
  last_sync_at: string | null
  last_error: string | null
  messages_seen: number
  initial_days: number
}
interface EventRow {
  id: string
  kind: string
  message: string
  task_key: string | null
  created_at: string
}
interface Step {
  kind: string
  reason?: string
  taskKey?: string | null
  item?: { title: string; assignee_name: string | null; deadline_text: string | null } | null
  suggestedOwnerId?: string | null
}
interface ReviewRow {
  id: string
  source: string
  subject: string | null
  from_email: string | null
  from_name: string | null
  sent_at: string
  status: string
  classification: string | null
  confidence: number | null
  ai_mode: string | null
  body_text: string
  last_error: string | null
  ai_result: { summary?: string; reasoning_summary?: string; items?: { title: string; assignee_name: string | null; deadline_text: string | null }[] } | null
  decision: { steps?: Step[] } | null
  link: string | null
}
interface RecentRow {
  id: string
  source: string
  subject: string | null
  from_email: string | null
  from_name: string | null
  sent_at: string
  status: string
  classification: string | null
  confidence: number | null
  ai_mode: string | null
  task_keys: string[]
  link: string | null
}
interface MinutesRow {
  id: string
  subject: string | null
  sentAt: string
  from: string | null
  minutes: { title: string; decisions: string[]; discussion: string[]; open_questions: string[] } | null
  taskKeys: string[]
}
interface Overview {
  google: { configured: boolean }
  slack?: SlackStatus
  ai: { mode: 'ai' | 'rules'; provider: string | null; model: string }
  minConfidence: number
  accounts: Account[]
  stats: Record<'total' | 'processed' | 'ignored' | 'review' | 'failed' | 'pending' | 'actionable' | 'created' | 'updated', number>
  events: EventRow[]
  review: ReviewRow[]
  recent: RecentRow[]
  minutes: MinutesRow[]
}

const STATUS_TONE: Record<string, string> = { processed: 'text-status-done', review: 'text-status-tentative', failed: 'text-status-overdue', ignored: 'text-text-faint', pending: 'text-text-muted', processing: 'text-text-muted' }

function ReviewItem({ r, onDone }: { r: ReviewRow; onDone: () => void }) {
  const { people } = useEngine()
  const notice = useActionNotice()
  const items = r.ai_result?.items ?? []
  const firstReviewItem = (r.decision?.steps ?? []).find((s) => s.kind === 'review')
  const [index, setIndex] = useState(0)
  const [owner, setOwner] = useState(firstReviewItem?.suggestedOwnerId ?? '')
  const [due, setDue] = useState('')
  const [title, setTitle] = useState(items[0]?.title ?? r.subject ?? '')
  const [reason, setReason] = useState('')

  return (
    <li className="py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-semibold text-text-primary">
          {r.subject ?? '(no subject)'} {r.source === 'test' ? <span className="text-xs text-status-tentative">test email</span> : null}
        </p>
        <span className="text-xs text-text-faint">
          {r.from_name ?? r.from_email} · {shortTime(r.sent_at)} · {r.classification ?? 'not read'} {r.confidence !== null ? `· ${Number(r.confidence).toFixed(2)}` : ''} · {r.ai_mode === 'ai' ? 'AI' : r.ai_mode === 'rules' ? 'rules' : ''}
        </span>
      </div>
      {r.last_error ? <p className="text-xs text-status-overdue">{r.last_error}</p> : null}
      <ul className="mt-1 list-disc pl-5 text-xs text-status-tentative">
        {(r.decision?.steps ?? []).filter((s) => s.kind === 'review').map((s, i) => (
          <li key={i}>{s.reason}</li>
        ))}
      </ul>
      {r.ai_result?.reasoning_summary ? <p className="mt-1 text-xs text-text-muted">Why: {r.ai_result.reasoning_summary}</p> : null}
      <details className="mt-1 text-xs text-text-muted">
        <summary className="cursor-pointer text-accent">Email text</summary>
        <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap rounded-md border border-surface-border p-2">{r.body_text}</pre>
        {r.link ? (
          <a href={r.link} target="_blank" rel="noreferrer" className="text-accent hover:underline">
            Open in Gmail
          </a>
        ) : null}
      </details>
      <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_180px_180px]">
        {items.length > 1 ? (
          <Select label="Action item" value={String(index)} onChange={(e) => { setIndex(Number(e.target.value)); setTitle(items[Number(e.target.value)]?.title ?? '') }}>
            {items.map((it, i) => (
              <option key={i} value={i}>
                {it.title}
              </option>
            ))}
          </Select>
        ) : (
          <Input label="Ticket title" value={title} onChange={(e) => setTitle(e.target.value)} />
        )}
        <Select label="Owner" value={owner} onChange={(e) => setOwner(e.target.value)}>
          <option value="">Choose…</option>
          {[...people.values()].map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
        <Input label="Deadline (optional)" type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} />
      </div>
      <div className="mt-2 flex flex-wrap items-end gap-2">
        <Button
          size="sm"
          disabled={!owner || notice.busy}
          onClick={() =>
            notice.run(async () => {
              const res = await callApi<{ message: string }>('automation/review-create', { emailId: r.id, itemIndex: index, ownerId: owner, title, dueAt: due ? new Date(due).toISOString() : null })
              if (res.ok) onDone()
              return res.ok ? { ok: true, message: res.data.message } : { ok: false, message: res.error.message }
            })
          }
        >
          Create ticket
        </Button>
        <Button size="sm" variant="secondary" disabled={notice.busy} onClick={() => notice.run(async () => { const res = await callApi<{ message: string }>('automation/retry', { emailId: r.id }); if (res.ok) onDone(); return res.ok ? { ok: true, message: res.data.message } : { ok: false, message: res.error.message } })}>
          Process again
        </Button>
        <Input label="Reason to dismiss" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Not a task" />
        <Button size="sm" variant="ghost" disabled={!reason.trim() || notice.busy} onClick={() => notice.run(async () => { const res = await callApi<{ message: string }>('automation/dismiss', { emailId: r.id, reason }); if (res.ok) onDone(); return res.ok ? { ok: true, message: res.data.message } : { ok: false, message: res.error.message } })}>
          Dismiss
        </Button>
      </div>
      <Notice result={notice.result} />
    </li>
  )
}

function TestEmailForm({ onDone }: { onDone: () => void }) {
  const notice = useActionNotice()
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [threadId, setThreadId] = useState('')

  async function submit(e: FormEvent) {
    e.preventDefault()
    await notice.run(async () => {
      const res = await callApi<{ message: string; threadId: string }>('automation/test-email', { from, to, subject, body, threadId: threadId || undefined })
      if (!res.ok) return { ok: false, message: res.error.message }
      setThreadId(res.data.threadId)
      setBody('')
      onDone()
      return { ok: true, message: `${res.data.message}. Reply in the same thread by sending another test email (thread kept).` }
    })
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-2" noValidate>
      <div className="grid gap-2 sm:grid-cols-2">
        <Input label="From (email)" value={from} onChange={(e) => setFrom(e.target.value)} placeholder="shivaganesh1430@gmail.com" />
        <Input label="To (emails, comma separated)" value={to} onChange={(e) => setTo(e.target.value)} placeholder="bshivaganesh14@gmail.com" />
      </div>
      <Input label="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="MoM: sprint planning" />
      <Textarea label="Body" rows={6} value={body} onChange={(e) => setBody(e.target.value)} placeholder={'Action items:\n- Ganesh: prepare the revised pricing deck by Wednesday\n- Chhavi: finalize the API documentation by 2026-10-24'} />
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" disabled={notice.busy || !from || !body.trim()}>
          Process test email
        </Button>
        {threadId ? (
          <span className="text-xs text-text-faint">
            Thread: {threadId}{' '}
            <button type="button" className="text-accent hover:underline" onClick={() => setThreadId('')}>
              start a new thread
            </button>
          </span>
        ) : null}
      </div>
      <Notice result={notice.result} />
    </form>
  )
}

export default function Automation() {
  const [data, setData] = useState<Overview | null>(null)
  const [error, setError] = useState('')
  const [params] = useSearchParams()
  const notice = useActionNotice()
  const [days, setDays] = useState('7')

  const load = useCallback(async () => {
    const res = await callApi<Overview>('automation/overview', {})
    if (res.ok) {
      setData(res.data)
      setError('')
    } else setError(res.error.message)
  }, [])

  useEffect(() => {
    void load()
    const t = window.setInterval(() => void load(), 15_000)
    return () => window.clearInterval(t)
  }, [load])

  const gmailFlag = params.get('gmail')
  const slackFlag = params.get('slack')
  const s = data?.stats

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title="Email automation" description="Gmail → AI reading → tickets. New mail is fetched every two minutes while a coordinator has the app open (and daily by the server). Nothing is ever sent from your mailbox." />
      {gmailFlag === 'connected' ? <p className="mb-3 rounded-md border border-status-done/40 p-2 text-sm text-status-done">Gmail connected. The first sync starts within two minutes, or press Sync now.</p> : null}
      {gmailFlag === 'error' ? <p className="mb-3 rounded-md border border-status-overdue/40 p-2 text-sm text-status-overdue">Gmail was not connected: {params.get('reason')}</p> : null}
      {slackFlag === 'connected' ? <p className="mb-3 rounded-md border border-status-done/40 p-2 text-sm text-status-done">Slack connected. Choose the channels to import below; nothing is read until a channel is enabled.</p> : null}
      {slackFlag === 'error' ? <p className="mb-3 rounded-md border border-status-overdue/40 p-2 text-sm text-status-overdue">Slack was not connected: {params.get('reason')}</p> : null}
      {error ? <p className="mb-3 text-sm text-status-overdue">{error}</p> : null}

      <div className="mb-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Gmail</CardTitle>
            <span className="text-xs text-text-faint">Read-only access</span>
          </CardHeader>
          {!data ? (
            <p className="text-sm text-text-muted">Loading…</p>
          ) : (
            <div className="flex flex-col gap-3">
              {data.accounts.length === 0 ? <p className="text-sm text-text-muted">No mailbox connected.</p> : null}
              {data.accounts.map((a) => (
                <div key={a.id} className="rounded-md border border-surface-border p-2 text-sm">
                  <p className="font-semibold text-text-primary">{a.email}</p>
                  <p className={a.status === 'connected' ? 'text-xs text-status-done' : 'text-xs text-status-overdue'}>
                    {a.status === 'connected' ? 'Connected' : a.status === 'revoked' ? 'Access revoked: connect again' : 'Sync error'} · last sync {a.last_sync_at ? shortTime(a.last_sync_at) : 'not yet'} · {a.messages_seen} emails fetched
                  </p>
                  {a.last_error ? <p className="text-xs text-status-overdue">{a.last_error}</p> : null}
                  <Button
                    size="sm"
                    variant="ghost"
                    className="mt-1"
                    onClick={() => notice.run(async () => { const r = await callApi<{ message: string }>('gmail/disconnect', { accountId: a.id }); await load(); return r.ok ? { ok: true, message: r.data.message } : { ok: false, message: r.error.message } })}
                  >
                    Disconnect
                  </Button>
                </div>
              ))}
              {data.google.configured ? (
                <div className="flex flex-wrap items-end gap-2">
                  <Select label="First sync reads the last" value={days} onChange={(e) => setDays(e.target.value)}>
                    {['1', '3', '7', '14', '30'].map((d) => (
                      <option key={d} value={d}>
                        {d} days
                      </option>
                    ))}
                  </Select>
                  <Button
                    onClick={() =>
                      notice.run(async () => {
                        const r = await callApi<{ url: string }>('gmail/connect', { initialDays: Number(days) })
                        if (!r.ok) return { ok: false, message: r.error.message }
                        window.location.href = r.data.url
                        return { ok: true, message: 'Opening Google…' }
                      })
                    }
                  >
                    Connect Gmail
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() => notice.run(async () => { const r = await callApi<{ message: string }>('automation/tick', { force: true }); await load(); return r.ok ? { ok: true, message: r.data.message } : { ok: false, message: r.error.message } })}
                  >
                    Sync now
                  </Button>
                </div>
              ) : (
                <p className="rounded-md border border-status-tentative/40 p-2 text-xs text-status-tentative">
                  Gmail is not configured on the server yet (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI). Until then, use "Try it with a test email" below: it runs the same pipeline.
                </p>
              )}
              <p className="text-xs text-text-faint">
                Reader: {data.ai.mode === 'ai' ? `AI (${data.ai.provider}, ${data.ai.model})` : 'rules (no AI key configured on the server; results are labelled "rules")'} · auto-apply above confidence {data.minConfidence}
              </p>
              <Notice result={notice.result} />
            </div>
          )}
        </Card>

        <SlackCard slack={data ? (data.slack ?? { configured: false, workspaces: [], channels: [] }) : undefined} onChange={load} />

        <Card>
          <CardHeader>
            <CardTitle>Try it with a test email</CardTitle>
            <span className="text-xs text-text-faint">Not from Gmail · labelled test</span>
          </CardHeader>
          <TestEmailForm onDone={() => void load()} />
        </Card>
      </div>

      {s ? (
        <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
          <Stat label="Emails processed" value={s.total} />
          <Stat label="Actionable" value={s.actionable} />
          <Stat label="Tickets created" value={s.created} tone="done" />
          <Stat label="Tickets updated" value={s.updated} />
          <Stat label="Ignored" value={s.ignored} tone="deferred" />
          <Stat label="Needs review" value={s.review} tone="tentative" />
          <Stat label="Failed / retry" value={s.failed + s.pending} tone="overdue" />
          <Stat label="Processed OK" value={s.processed} tone="done" />
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Needs review</CardTitle>
            <span className="text-xs text-text-faint">Uncertain owner, date, match or confidence</span>
          </CardHeader>
          {!data || data.review.length === 0 ? (
            <EmptyState title="Nothing waiting" description="Emails the automation is not sure about appear here." />
          ) : (
            <ul className="divide-y divide-surface-border">
              {data.review.map((r) => (
                <ReviewItem key={r.id} r={r} onDone={() => void load()} />
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Activity</CardTitle>
          </CardHeader>
          {!data || data.events.length === 0 ? (
            <p className="text-sm text-text-muted">No automation events yet.</p>
          ) : (
            <ul className="flex max-h-[520px] flex-col gap-2 overflow-y-auto pr-1 text-sm">
              {data.events.map((e) => (
                <li key={e.id} className="border-l-2 border-surface-border pl-2">
                  <p className="text-text-primary">{e.message}</p>
                  <p className="text-xs text-text-faint">
                    {shortTime(e.created_at)}
                    {e.task_key ? (
                      <>
                        {' · '}
                        <Link to={`/commitments/${e.task_key}`} className="text-accent hover:underline">
                          open ticket
                        </Link>
                      </>
                    ) : null}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Recent emails</CardTitle>
          </CardHeader>
          {!data || data.recent.length === 0 ? (
            <p className="text-sm text-text-muted">No emails yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="text-text-faint">
                  <tr>
                    <th className="p-1.5">Email</th>
                    <th className="p-1.5">Reading</th>
                    <th className="p-1.5">Result</th>
                    <th className="p-1.5">Tickets</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recent.map((r) => (
                    <tr key={r.id} className="border-t border-surface-border align-top">
                      <td className="p-1.5">
                        <span className="text-text-primary">{r.subject ?? '(no subject)'}</span>
                        <span className="block text-text-faint">
                          {r.from_name ?? r.from_email} · {shortTime(r.sent_at)} {r.source === 'test' ? '· test' : ''}
                        </span>
                        {r.link ? (
                          <a href={r.link} target="_blank" rel="noreferrer" className="text-accent hover:underline">
                            Gmail
                          </a>
                        ) : null}
                      </td>
                      <td className="p-1.5 text-text-muted">
                        {r.classification ?? '—'} {r.confidence !== null ? Number(r.confidence).toFixed(2) : ''} {r.ai_mode ? `(${r.ai_mode})` : ''}
                      </td>
                      <td className={`p-1.5 ${STATUS_TONE[r.status] ?? ''}`}>{r.status}</td>
                      <td className="p-1.5">
                        {r.task_keys.map((k) => (
                          <Link key={k} to={`/commitments/${k}`} className="mr-1 text-accent hover:underline">
                            {k}
                          </Link>
                        ))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Meeting minutes</CardTitle>
          </CardHeader>
          {!data || data.minutes.length === 0 ? (
            <p className="text-sm text-text-muted">Minutes found in emails appear here with their decisions and action items.</p>
          ) : (
            <ul className="flex flex-col gap-3 text-sm">
              {data.minutes.map((m) => (
                <li key={m.id}>
                  <p className="font-semibold text-text-primary">{m.minutes?.title ?? m.subject}</p>
                  <p className="text-xs text-text-faint">
                    {m.from} · {shortTime(m.sentAt)} · {m.taskKeys.length} tickets
                  </p>
                  {m.minutes?.decisions.length ? (
                    <ul className="mt-1 list-disc pl-5 text-xs text-text-muted">
                      {m.minutes.decisions.map((d, i) => (
                        <li key={i}>Decision: {d}</li>
                      ))}
                    </ul>
                  ) : null}
                  {m.minutes?.open_questions.length ? (
                    <ul className="mt-1 list-disc pl-5 text-xs text-status-tentative">
                      {m.minutes.open_questions.map((d, i) => (
                        <li key={i}>Open: {d}</li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  )
}
