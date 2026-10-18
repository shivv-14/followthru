import { useState } from 'react'
import { Button, Dialog, Input } from '../ui'
import { shortTime } from './view'
import type { ActionResult } from '../../store/actions'

const DAY = 86_400_000
type Choice = '1d' | '3d' | 'custom'

/** Wake-up time for a snooze choice, measured from the evaluation clock. */
export function snoozeUntil(choice: Choice, now: string, custom: string): string | null {
  if (choice === '1d') return new Date(Date.parse(now) + DAY).toISOString()
  if (choice === '3d') return new Date(Date.parse(now) + 3 * DAY).toISOString()
  const ms = Date.parse(custom)
  return Number.isNaN(ms) ? null : new Date(ms).toISOString()
}

interface Props {
  open: boolean
  onClose: () => void
  now: string
  busy: boolean
  onSnooze: (until: string, reason: string) => Promise<ActionResult>
}

export function SnoozeDialog({ open, onClose, now, busy, onSnooze }: Props) {
  const [choice, setChoice] = useState<Choice>('1d')
  const [custom, setCustom] = useState('')
  const [reason, setReason] = useState('')
  const until = snoozeUntil(choice, now, custom)

  return (
    <Dialog open={open} onClose={onClose} title="Snooze this draft" variant="modal">
      <div className="flex flex-col gap-3">
        <p className="text-sm text-text-muted">The draft leaves the review list and cannot be approved until it wakes up. If the work is finished or cancelled meanwhile, it is suppressed as usual.</p>
        <fieldset className="flex flex-wrap gap-3 text-sm text-text-primary">
          <legend className="mb-1 text-sm font-medium">Wake up</legend>
          {(
            [
              ['1d', 'In 1 day'],
              ['3d', 'In 3 days'],
              ['custom', 'Pick a time'],
            ] as const
          ).map(([value, label]) => (
            <label key={value} className="flex items-center gap-2">
              <input type="radio" name="snooze-choice" value={value} checked={choice === value} onChange={() => setChoice(value)} className="accent-[var(--color-accent)]" />
              {label}
            </label>
          ))}
        </fieldset>
        {choice === 'custom' ? <Input label="Wake-up time (your time)" type="datetime-local" value={custom} onChange={(e) => setCustom(e.target.value)} /> : null}
        <Input label="Reason (optional)" value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} placeholder="For example: owner is on leave until Thursday" />
        <p className="text-xs text-text-faint">{until ? `Wakes up ${shortTime(until)} (evaluation clock)` : 'Choose a wake-up time'}</p>
        <div className="flex gap-2">
          <Button
            disabled={!until || busy}
            onClick={async () => {
              if (!until) return
              const res = await onSnooze(until, reason)
              if (res.ok) {
                setReason('')
                onClose()
              }
            }}
          >
            Snooze draft
          </Button>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
