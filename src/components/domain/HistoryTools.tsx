import { useMemo, useState } from 'react'
import clsx from 'clsx'
import { Button, Card, CardHeader, CardTitle, Dialog, StatusChip } from '../ui'
import type { Commitment, Draft } from '../../engine/types'
import { useEngine } from '../../store'
import { explainCommitment } from './explain'
import { replayAt, replayPoints } from './timeTravel'
import { draftStateView, personName, shortTime, statusView } from './view'

/** "Why?" in sentences, above the raw evidence timeline. */
export function PlainWhy({ c, draft, tz }: { c: Commitment; draft?: Draft; tz?: string }) {
  const { people, now } = useEngine()
  const lines = explainCommitment(c, draft, people, now, tz)
  return (
    <Card>
      <CardHeader>
        <CardTitle>In plain English</CardTitle>
      </CardHeader>
      <ul className="flex flex-col gap-2 text-sm text-text-muted" data-testid="plain-why">
        {lines.map((l) => (
          <li key={l}>{l}</li>
        ))}
      </ul>
    </Card>
  )
}

/** Slide back through the commitment's history and see what the engine thought at each moment. */
export function ReplaySlider({ c, tz }: { c: Commitment; tz?: string }) {
  const { dataset, decisions, tasks, now, config, people } = useEngine()
  const points = useMemo(() => replayPoints(c, now), [c, now])
  const [index, setIndex] = useState(points.length - 1)
  const i = Math.min(index, points.length - 1)
  const point = points[i]
  const frame = useMemo(
    () => (dataset && point ? replayAt(c.id, point.at, { dataset: dataset.data, decisions, manualTasks: tasks }, { flags: config.flags, staleAfterHours: config.staleAfterHours, flows: config.flows }) : undefined),
    [c.id, point, dataset, decisions, tasks, config],
  )
  if (!point || points.length < 2) return null
  const fc = frame?.commitment
  const status = fc ? statusView(fc, point.at) : undefined

  return (
    <Card>
      <CardHeader>
        <CardTitle>Replay history</CardTitle>
      </CardHeader>
      <label className="block text-xs text-text-faint" htmlFor={`replay-${c.id}`}>
        Step {i + 1} of {points.length}: {point.label} · {shortTime(point.at, tz)}
      </label>
      <input
        id={`replay-${c.id}`}
        type="range"
        min={0}
        max={points.length - 1}
        step={1}
        value={i}
        onChange={(e) => setIndex(Number(e.target.value))}
        className="mt-2 w-full accent-[var(--color-accent)]"
        aria-valuetext={`${point.label}, ${shortTime(point.at, tz)}`}
      />
      <div className="mt-3 grid gap-2 text-sm sm:grid-cols-3" aria-live="polite" data-testid="replay-frame">
        <div>
          <p className="text-xs text-text-faint">Status then</p>
          {status ? <StatusChip status={status.key} label={status.label} /> : <p className="text-text-muted">Not known yet</p>}
        </div>
        <div>
          <p className="text-xs text-text-faint">Owner then</p>
          <p>{fc ? personName(people, fc.ownerId) : '—'}</p>
        </div>
        <div>
          <p className="text-xs text-text-faint">Draft then</p>
          {frame?.draft ? <StatusChip status={draftStateView(frame.draft).key} label={draftStateView(frame.draft).label} /> : <p className="text-text-muted">None</p>}
        </div>
      </div>
      <p className="mt-2 text-xs text-text-faint">Re-run from only the messages and decisions known at that moment. Nothing here changes stored data.</p>
    </Card>
  )
}

/** Every message in the commitment's threads, with the ones that shaped it highlighted. */
export function ThreadSheet({ c }: { c: Commitment }) {
  const { dataset, people } = useEngine()
  const [open, setOpen] = useState(false)
  const linked = new Set<string>([c.sourceMessageId, ...(c.linkedMessageIds ?? []), ...c.events.flatMap((e) => (e.evidence?.messageId ? [e.evidence.messageId] : []))])
  const threads = (dataset?.data.threads ?? []).filter((t) => c.threadIds.includes(t.id))
  if (threads.length === 0) return null
  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        View thread{threads.length > 1 ? 's' : ''}
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title={threads.length > 1 ? `${threads.length} threads` : (threads[0].title ?? threads[0].id)} variant="sheet">
        <div className="flex max-h-[70vh] flex-col gap-5 overflow-y-auto">
          {threads.map((t) => (
            <section key={t.id} aria-label={t.title ?? t.id}>
              {threads.length > 1 ? <h3 className="mb-2 text-sm font-semibold">{t.title ?? t.id}</h3> : null}
              <ol className="flex flex-col gap-2">
                {(dataset?.data.messages ?? [])
                  .filter((m) => m.threadId === t.id)
                  .sort((a, b) => a.sentAt.localeCompare(b.sentAt))
                  .map((m) => (
                    <li key={m.id} className={clsx('rounded-md border p-2 text-sm', linked.has(m.id) ? 'border-accent/60 bg-accent/10' : 'border-surface-border')}>
                      <p className="text-xs text-text-faint">
                        {personName(people, m.authorId)} · {shortTime(m.sentAt, people.get(m.authorId)?.timezone)} their time{linked.has(m.id) ? ' · used as evidence' : ''}
                      </p>
                      <p className="text-text-muted">{m.text}</p>
                    </li>
                  ))}
              </ol>
            </section>
          ))}
        </div>
      </Dialog>
    </>
  )
}
