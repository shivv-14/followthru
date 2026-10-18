import type { Commitment, CommitmentLabel, Draft, IsoUtc, LabelCheck, ScoreCheck, Scorecard } from './types'

const ACTIVE: Draft['state'][] = ['pending_review', 'approved']
const DEADLINE_TOLERANCE_MS = 60_000

function sameInstant(a: IsoUtc | null, b: IsoUtc | null): boolean {
  if (a === null || b === null) return a === b
  return Math.abs(Date.parse(a) - Date.parse(b)) <= DEADLINE_TOLERANCE_MS
}

/** Calendar day of an instant in a timezone, as YYYY-MM-DD. */
function localDay(iso: IsoUtc, tz: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso))
}

function deadlineMatches(actual: IsoUtc | null, label: CommitmentLabel): boolean {
  if (label.dueDate) return actual !== null && localDay(actual, label.timezone ?? 'UTC') === label.dueDate
  return sameInstant(actual, label.dueAt)
}

function findCommitment(label: CommitmentLabel, commitments: Commitment[]): Commitment | undefined {
  return (
    commitments.find((c) => c.sourceMessageId === label.sourceMessageId) ??
    commitments.find((c) => c.linkedMessageIds?.includes(label.sourceMessageId))
  )
}

function evidenceIds(c: Commitment): string[] {
  return [...new Set([c.sourceMessageId, ...c.events.map((e) => e.evidence?.messageId ?? '')].filter(Boolean))]
}

/**
 * Compares engine output with the dataset's labels and runs the three
 * official checks. Labels are read here only, never by the engine rules.
 */
export function evaluate(commitments: Commitment[], drafts: Draft[], labels: CommitmentLabel[], runAt: IsoUtc): Scorecard {
  const activeDraft = (commitmentId: string) => drafts.some((d) => d.commitmentId === commitmentId && ACTIVE.includes(d.state))
  const labelChecks: LabelCheck[] = labels.map((label) => {
    const c = findCommitment(label, commitments)
    const actual = c ? { ownerId: c.ownerId, dueAt: c.deadline.dueAt, status: c.status } : null
    // Eligible means open work the queue may chase; ineligible work must never hold an active draft
    const reminderOk =
      label.reminderEligible === undefined || !c
        ? undefined
        : label.reminderEligible
          ? c.status === 'open'
          : c.status !== 'open' && !activeDraft(c.id)
    return {
      sourceMessageId: label.sourceMessageId,
      expected: label,
      actual,
      ownerOk: actual?.ownerId === label.ownerId,
      deadlineOk: actual ? deadlineMatches(actual.dueAt, label) : false,
      statusOk: actual?.status === label.status,
      evidenceMessageIds: c ? evidenceIds(c) : [],
      ...(reminderOk === undefined ? {} : { reminderOk }),
    }
  })
  const correct = labelChecks.filter((l) => l.ownerOk && l.deadlineOk && l.statusOk).length

  const byId = new Map(commitments.map((c) => [c.id, c]))
  const terminalIds = new Set(commitments.filter((c) => c.status !== 'open').map((c) => c.id))
  for (const l of labels) {
    if (l.status !== 'open') {
      const c = findCommitment(l, commitments)
      if (c) terminalIds.add(c.id)
    }
  }
  const wrong = drafts.filter((d) => ACTIVE.includes(d.state) && terminalIds.has(d.commitmentId))

  const perCommitment = new Map<string, number>()
  for (const d of drafts) perCommitment.set(d.commitmentId, (perCommitment.get(d.commitmentId) ?? 0) + 1)
  const duplicates = [...perCommitment.entries()].filter(([, n]) => n > 1)
  const orphanKeys = drafts.filter((d) => d.idempotencyKey !== d.commitmentId || !byId.has(d.commitmentId))

  const checks: ScoreCheck[] = [
    labels.length === 0
      ? { name: 'owner_deadline_status', points: 0, pass: false, detail: 'No labelled commitments in this dataset; load the challenge fixture to score this check' }
      : {
          name: 'owner_deadline_status',
          points: Math.round((10 * correct) / labels.length * 10) / 10,
          pass: correct === labels.length,
          detail: `${correct} of ${labels.length} labelled commitments have the correct owner, deadline and status`,
        },
    {
      name: 'zero_wrong_reminders',
      points: wrong.length === 0 ? 10 : 0,
      pass: wrong.length === 0,
      detail: wrong.length === 0 ? `0 active reminders for ${terminalIds.size} completed, cancelled or deferred commitments` : `${wrong.length} active reminders on closed work: ${wrong.map((d) => d.commitmentId).join(', ')}`,
    },
    {
      name: 'one_action_one_draft',
      points: duplicates.length === 0 && orphanKeys.length === 0 ? 5 : 0,
      pass: duplicates.length === 0 && orphanKeys.length === 0,
      detail:
        duplicates.length === 0
          ? `${drafts.length} drafts for ${perCommitment.size} commitments, no duplicates${orphanKeys.length ? `; ${orphanKeys.length} drafts have no matching commitment` : ''}`
          : `Duplicate drafts for ${duplicates.map(([id]) => id).join(', ')}`,
    },
  ]
  return { runAt, labelChecks, checks }
}
