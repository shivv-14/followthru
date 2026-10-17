import { useState } from 'react'
import { Button, Card, CardHeader, CardTitle, Input, Select } from '../components/ui'
import { Notice, PageHeader, useActionNotice } from '../components/domain/parts'
import { DEFAULT_FLOW, elapsedHours, flowFor, stepFor, validateFlow } from '../engine/flows'
import { deadlineState } from '../engine/deadline'
import { expectedRecipient } from '../engine/drafts'
import type { Flow, FlowStep, FlowTone, RecipientRole } from '../engine/types'
import { useActions, useEngine } from '../store'

const TONES: FlowTone[] = ['gentle', 'firm', 'escalate']

function FlowEditor({ initial, onDone }: { initial: Flow; onDone: () => void }) {
  const actions = useActions()
  const notice = useActionNotice()
  const { result } = useEngine()
  const [flow, setFlow] = useState<Flow>(initial)
  const teams = [...new Set(result.commitments.map((c) => c.teamId).filter(Boolean))] as string[]
  const errors = validateFlow(flow)

  const setStep = (i: number, patch: Partial<FlowStep>) => setFlow({ ...flow, steps: flow.steps.map((s, j) => (j === i ? { ...s, ...patch } : s)) })

  return (
    <Card>
      <CardHeader>
        <CardTitle>{initial.name ? `Edit ${initial.name}` : 'New flow'}</CardTitle>
      </CardHeader>
      <div className="flex flex-col gap-3">
        <Input label="Name" value={flow.name} onChange={(e) => setFlow({ ...flow, name: e.target.value })} />
        <Select label="Applies to" value={flow.appliesTo} onChange={(e) => setFlow({ ...flow, appliesTo: e.target.value })}>
          <option value="all">Everyone (overrides the default)</option>
          {teams.map((t) => (
            <option key={t} value={t}>
              Team {t}
            </option>
          ))}
          <option value="none">Nobody (saved, not active)</option>
        </Select>
        <label className="flex items-center gap-2 text-sm text-text-primary">
          <input type="checkbox" checked={flow.skipWeekends} onChange={(e) => setFlow({ ...flow, skipWeekends: e.target.checked })} className="size-4" />
          Count working days only (skip weekends in the owner's timezone)
        </label>
        <div className="flex flex-col gap-2">
          {flow.steps.map((s, i) => (
            <div key={i} className="flex items-end gap-2">
              <Input label={`Step ${i + 1}: hours after deadline`} type="number" min={0} value={s.afterHours} onChange={(e) => setStep(i, { afterHours: Number(e.target.value) })} />
              <Select label="To" value={s.recipient ?? 'owner'} onChange={(e) => setStep(i, { recipient: e.target.value as RecipientRole })}>
                <option value="owner">Owner</option>
                <option value="requester">Requester (or coordinator)</option>
                <option value="coordinator">Coordinator</option>
              </Select>
              <Select label="Tone" value={s.tone} onChange={(e) => setStep(i, { tone: e.target.value as FlowTone })}>
                {TONES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </Select>
              <Button size="sm" variant="ghost" aria-label={`Remove step ${i + 1}`} onClick={() => setFlow({ ...flow, steps: flow.steps.filter((_, j) => j !== i) })}>
                ✕
              </Button>
            </div>
          ))}
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setFlow({ ...flow, steps: [...flow.steps, { afterHours: (flow.steps.at(-1)?.afterHours ?? -24) + 24, tone: 'firm' }] })}
          >
            Add step
          </Button>
        </div>
        {errors.length > 0 ? <p className="text-xs text-status-overdue">{errors.join('. ')}</p> : null}
        <div className="flex gap-2">
          <Button
            disabled={errors.length > 0}
            onClick={() =>
              notice.run(async () => {
                const res = await actions.saveFlow(flow)
                if (res.ok) onDone()
                return res
              })
            }
          >
            Save flow
          </Button>
          <Button variant="ghost" onClick={onDone}>
            Cancel
          </Button>
        </div>
        <Notice result={notice.result} />
      </div>
    </Card>
  )
}

export default function Flows() {
  const { flows, result, now, user, people } = useEngine()
  const actions = useActions()
  const notice = useActionNotice()
  const [editing, setEditing] = useState<Flow | null>(null)
  const isCoordinator = user?.role === 'coordinator'
  const list = flows.length > 0 ? flows : [DEFAULT_FLOW]
  const overdue = result.commitments.filter((c) => c.status === 'open' && deadlineState(c.deadline, now) === 'overdue')

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="Follow-up flows"
        description="When reminders are drafted after a deadline, and in what tone. A team flow wins over a flow for everyone, which wins over the default. Each new step updates the same draft as a new version."
        actions={
          isCoordinator ? (
            <Button onClick={() => setEditing({ id: `flow_${Date.now().toString(36)}`, name: '', isDefault: false, appliesTo: 'all', steps: [{ afterHours: 0, tone: 'gentle' }], skipWeekends: false })}>
              New flow
            </Button>
          ) : null
        }
      />
      {editing ? (
        <div className="mb-4">
          <FlowEditor initial={editing} onDone={() => setEditing(null)} />
        </div>
      ) : null}
      <div className="grid gap-3 md:grid-cols-2">
        {list.map((f) => (
          <Card key={f.id}>
            <CardHeader>
              <CardTitle>{f.name}</CardTitle>
              <span className="text-xs text-text-faint">{f.isDefault ? 'Default · locked' : f.appliesTo === 'all' ? 'Everyone' : f.appliesTo === 'none' ? 'Inactive' : `Team ${f.appliesTo}`}</span>
            </CardHeader>
            <ol className="mb-3 flex flex-col gap-1 text-sm text-text-muted">
              {f.steps.map((s, i) => (
                <li key={i}>
                  Step {i + 1}: {s.afterHours === 0 ? 'as soon as overdue' : `${s.afterHours} h after the deadline`} · {s.tone}
                </li>
              ))}
            </ol>
            <p className="mb-3 text-xs text-text-faint">{f.skipWeekends ? 'Working days only' : 'Counts every hour'}</p>
            {isCoordinator ? (
              <div className="flex gap-2">
                <Button size="sm" variant="secondary" onClick={() => setEditing({ ...f, id: `flow_${Date.now().toString(36)}`, name: `${f.name} (copy)`, isDefault: false, appliesTo: 'none' })}>
                  Duplicate
                </Button>
                {!f.isDefault ? (
                  <>
                    <Button size="sm" variant="secondary" onClick={() => setEditing(f)}>
                      Edit
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => notice.run(() => actions.deleteFlow(f.id))}>
                      Delete
                    </Button>
                  </>
                ) : null}
              </div>
            ) : null}
          </Card>
        ))}
      </div>
      <Notice result={notice.result} />

      <Card className="mt-4">
        <CardHeader>
          <CardTitle>Live preview at the evaluation time</CardTitle>
        </CardHeader>
        {overdue.length === 0 ? (
          <p className="text-sm text-text-muted">Nothing is overdue right now.</p>
        ) : (
          <ul className="flex flex-col gap-1 text-sm">
            {overdue.map((c) => {
              const flow = flowFor(c, list)
              const hours = elapsedHours(Date.parse(c.deadline.dueAt!), Date.parse(now), flow.skipWeekends, people.get(c.ownerId ?? '')?.timezone ?? 'UTC')
              const step = stepFor(flow, hours)
              return (
                <li key={c.id} className="flex flex-wrap justify-between gap-2 border-b border-surface-border py-1">
                  <span>
                    {c.title} <span className="text-text-faint">· {people.get(c.ownerId ?? '')?.name}</span>
                  </span>
                  <span className="text-text-muted">
                    {flow.name}: {step < 0 ? `waiting until ${flow.steps[0].afterHours} h` : `step ${step + 1} (${flow.steps[step].tone}, to ${people.get(expectedRecipient(c, flow.steps[step].recipient, people) ?? '')?.name ?? 'nobody'})`}
                    {step >= 0 && flow.steps[step].recipient === 'requester' && !c.requesterId ? ' · no requester, goes to the coordinator' : ''} · {Math.floor(hours)} h overdue{flow.skipWeekends ? ' (working hours)' : ''}
                  </span>
                </li>
              )
            })}
          </ul>
        )}
      </Card>
    </div>
  )
}
