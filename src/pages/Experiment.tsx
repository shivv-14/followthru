import { useCallback, useEffect, useState } from 'react'
import { Button, Card, Input, LoadingState, Select, Textarea } from '../components/ui'
import { Notice, PageHeader } from '../components/domain/parts'
import { callApi } from '../cloud/api'
import { useEngine } from '../store'
import type { ActionResult } from '../store'

interface Row {
  slot: number
  commitment_key: string | null
  intended_recipient: string | null
  person_approached: string | null
  approached_at: string | null
  reminder_text: string | null
  decision: 'pending' | 'approved' | 'rejected'
  delivery: 'not_sent' | 'shown_in_app' | 'sent'
  response: string | null
  response_at: string | null
  useful: boolean | null
  progressed: boolean | null
  minutes_saved: number | null
  false_reminder: boolean | null
  notes: string | null
}

const EMPTY = (slot: number): Row => ({ slot, commitment_key: null, intended_recipient: null, person_approached: null, approached_at: null, reminder_text: null, decision: 'pending', delivery: 'not_sent', response: null, response_at: null, useful: null, progressed: null, minutes_saved: null, false_reminder: null, notes: null })
const toLocal = (iso: string | null) => (iso ? new Date(new Date(iso).getTime() - new Date(iso).getTimezoneOffset() * 60_000).toISOString().slice(0, 16) : '')
const yesNo = (v: boolean | null) => (v === null ? '' : v ? 'yes' : 'no')
const fromYesNo = (v: string) => (v === '' ? null : v === 'yes')

/** The C14 growth experiment: ten overdue commitments, recorded only as they really happen. */
export default function Experiment() {
  const { result, people } = useEngine()
  const [rows, setRows] = useState<Row[] | null>(null)
  const [open, setOpen] = useState(1)
  const [notice, setNotice] = useState<ActionResult | null>(null)
  const overdue = result.commitments.filter((c) => c.status === 'open' && c.deadline.dueAt && c.deadline.certainty === 'firm')

  const load = useCallback(async () => {
    const res = await callApi<{ rows: Row[] }>('experiments/list')
    if (!res.ok) return setNotice({ ok: false, message: res.error.message })
    setRows(Array.from({ length: 10 }, (_, i) => res.data.rows.find((r) => r.slot === i + 1) ?? EMPTY(i + 1)))
  }, [])
  useEffect(() => {
    void load()
  }, [load])

  if (!rows) return <LoadingState label="Loading experiment" />
  const done = rows.filter((r) => r.response || r.decision !== 'pending')
  const useful = rows.filter((r) => r.useful === true).length

  async function save(r: Row) {
    const res = await callApi<{ message: string }>('experiments/save', { slot: r.slot, values: { ...r, approached_at: r.approached_at, response_at: r.response_at } })
    setNotice(res.ok ? { ok: true, message: res.data.message } : { ok: false, message: res.error.message })
    if (res.ok) await load()
  }
  const update = (slot: number, patch: Partial<Row>) => setRows((all) => all!.map((r) => (r.slot === slot ? { ...r, ...patch } : r)))

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="Growth experiment" description="Ten overdue commitments: was each reminder correct, useful and acted on? Record only what really happened; untouched rows stay pending." />
      <Card className="mb-4">
        <p className="text-sm text-text-muted">
          Recorded: <b className="text-white">{done.length} of 10</b> · useful: <b className="text-white">{useful}</b> · pending: <b className="text-white">{10 - done.length}</b>. Results are summarised only from rows you fill in; nothing is filled in for you.
        </p>
      </Card>
      <div className="mb-3">
        <Notice result={notice} />
      </div>
      <div className="flex flex-col gap-3">
        {rows.map((r) => (
          <Card key={r.slot}>
            <button type="button" className="flex w-full items-center justify-between text-left" onClick={() => setOpen(open === r.slot ? 0 : r.slot)} aria-expanded={open === r.slot}>
              <span className="font-semibold">
                {r.slot}. {result.commitments.find((c) => c.id === r.commitment_key)?.title ?? (r.commitment_key || 'Choose an overdue commitment')}
              </span>
              <span className="text-xs text-text-faint">{r.response || r.decision !== 'pending' ? 'recorded' : 'pending'}</span>
            </button>
            {open === r.slot ? (
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <Select
                  label="Overdue commitment"
                  value={r.commitment_key ?? ''}
                  onChange={(e) => {
                    const c = result.commitments.find((x) => x.id === e.target.value)
                    update(r.slot, { commitment_key: e.target.value || null, intended_recipient: c?.ownerId ? (people.get(c.ownerId)?.name ?? c.ownerId) : r.intended_recipient })
                  }}
                >
                  <option value="">Choose…</option>
                  {overdue.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.title}
                    </option>
                  ))}
                </Select>
                <Input label="Intended recipient" value={r.intended_recipient ?? ''} onChange={(e) => update(r.slot, { intended_recipient: e.target.value })} />
                <Input label="Person approached" value={r.person_approached ?? ''} onChange={(e) => update(r.slot, { person_approached: e.target.value })} />
                <Input label="Approached at" type="datetime-local" value={toLocal(r.approached_at)} onChange={(e) => update(r.slot, { approached_at: e.target.value ? new Date(e.target.value).toISOString() : null })} />
                <div className="sm:col-span-2">
                  <Textarea label="Reminder text" value={r.reminder_text ?? ''} onChange={(e) => update(r.slot, { reminder_text: e.target.value })} />
                </div>
                <Select label="Coordinator decision" value={r.decision} onChange={(e) => update(r.slot, { decision: e.target.value as Row['decision'] })}>
                  <option value="pending">Pending</option>
                  <option value="approved">Approved</option>
                  <option value="rejected">Rejected</option>
                </Select>
                <Select label="Delivery" value={r.delivery} onChange={(e) => update(r.slot, { delivery: e.target.value as Row['delivery'] })}>
                  <option value="not_sent">Not sent</option>
                  <option value="shown_in_app">Shown in the app</option>
                  <option value="sent">Actually sent</option>
                </Select>
                <div className="sm:col-span-2">
                  <Textarea label="Response received" value={r.response ?? ''} onChange={(e) => update(r.slot, { response: e.target.value })} />
                </div>
                <Input label="Response at" type="datetime-local" value={toLocal(r.response_at)} onChange={(e) => update(r.slot, { response_at: e.target.value ? new Date(e.target.value).toISOString() : null })} />
                <Input label="Minutes saved (if measured)" type="number" min={0} value={r.minutes_saved ?? ''} onChange={(e) => update(r.slot, { minutes_saved: e.target.value === '' ? null : Number(e.target.value) })} />
                {(['useful', 'progressed', 'false_reminder'] as const).map((k) => (
                  <Select key={k} label={{ useful: 'Was the reminder useful?', progressed: 'Did the task move forward?', false_reminder: 'False reminder or wrong person?' }[k]} value={yesNo(r[k])} onChange={(e) => update(r.slot, { [k]: fromYesNo(e.target.value) })}>
                    <option value="">Not known yet</option>
                    <option value="yes">Yes</option>
                    <option value="no">No</option>
                  </Select>
                ))}
                <div className="sm:col-span-2">
                  <Textarea label="Notes (interview feedback, pricing, adoption concerns)" value={r.notes ?? ''} onChange={(e) => update(r.slot, { notes: e.target.value })} />
                </div>
                <Button className="sm:col-span-2" onClick={() => void save(r)}>
                  Save row {r.slot}
                </Button>
              </div>
            ) : null}
          </Card>
        ))}
      </div>
    </div>
  )
}
