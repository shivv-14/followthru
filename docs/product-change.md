# Product change: stale-message suppression and recipient review

## Starting state

See `evidence/starting_state/README.md` (synthetic demo data until the
challenge fixture is available). Without the change, a reminder written before
the work was reported done stays in the queue and can still be approved, and
nobody checks that the reminder goes to the right person.

## The problem

**Stale drafts.** A reminder is drafted while work is overdue. Later the owner
reports it done, the requester cancels it, the deadline moves or the owner
changes, often in another thread. A queue that never revisits its drafts sends
reminders for work that is already handled.

**Wrong recipients.** Ownership moves through delegation, and people work in
different timezones. A reminder that goes to the previous owner, or lands in
the middle of someone's night, damages trust in the tool.

## Negotiated scope

In scope:

1. A freshness check right before approval: the draft is re-checked against the
   latest commitment state (status, deadline, owner, age).
2. Automatic suppression or update with a visible reason: closed work
   suppresses the draft with the evidence message; a changed deadline, owner,
   flow step or owner reply updates the same draft as a new version.
3. Staleness: an unapproved draft older than `staleAfterHours` (default 24) is
   marked stale and must be reviewed again.
4. Recipient review: the recipient follows the current owner (or the flow
   step's escalation recipient), warnings are shown (delegation, not in the
   thread, outside working hours, weekend), and approval needs the
   coordinator to confirm the recipient.
5. Both features have flags (`staleSuppression`, `recipientReview`) so the
   before and after can be compared.

Out of scope (later): real sending, Slack or email integration, ML ranking of
reminders, drafts with several recipients.

## Acceptance criteria and the tests that prove them

| # | Criterion | Test |
|---|---|---|
| 1 | A draft written before a completion is suppressed with reason `completed` and the evidence message | tests/engine.test.ts › product change flags › with stale suppression the same draft is suppressed with the completion evidence |
| 2 | Without the flag the same draft stays pending (baseline reproduced) | tests/engine.test.ts › product change flags › without stale suppression a draft written before the completion stays pending |
| 3 | Approval re-checks freshness and suppresses instead of approving when the work closed | tests/engine.test.ts › approval checks › re-checks freshness; tests/store.test.ts › suppresses with a visible reason when the work was closed before approval |
| 4 | A changed deadline or owner after drafting blocks approval as stale | tests/engine.test.ts › approval checks › blocks a draft whose deadline or owner changed after it was written |
| 5 | Unapproved drafts become stale after the stale window | tests/engine.test.ts › draft queue › marks unapproved drafts stale after the stale window |
| 6 | Approval is blocked until the recipient is confirmed | tests/engine.test.ts › approval checks › blocks approval until the recipient is confirmed; tests/ui.test.tsx › blocks approval until the recipient is confirmed, then approves in shadow mode |
| 7 | Recipient warnings for working hours and missing thread participation | tests/engine.test.ts › approval checks › warns about recipients outside working hours or after delegation |
| 8 | Without recipient review, approval does not need confirmation | tests/engine.test.ts › product change flags › without recipient review approval does not need a confirmed recipient |
| 9 | A deadline update changes the same draft with a new version, never a duplicate | tests/engine.test.ts › draft queue › a later deadline update changes the same draft with a new version |
| 10 | Escalation to the coordinator keeps one draft and is approvable after confirmation | tests/engine.test.ts › draft wording, subjects and escalation › escalates to the coordinator as a new version of the same draft |

## Final evidence

- `evidence/starting_state/` — flags off: 1 outdated draft still approvable,
  check 2 FAIL.
- `evidence/final/` — flags on: the same draft suppressed with evidence `m_10`,
  0 outdated drafts approvable, check 2 PASS.
- Both folders hold the scorecard, stale report, CSVs, test report and a
  SHA-256 manifest with the git commit. Both use **synthetic data**; re-run the
  two commands in their READMEs with the challenge fixture when it arrives.
