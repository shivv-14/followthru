# FollowThru scorecard (fixture)

- Generated: 2026-10-18T07:05:16.901Z
- Dataset: D:\followthru\data\fixture.json
- Evaluation clock: 2026-10-24T03:30:00.000Z
- Engine mode: Rules (official evidence always runs the rules)
- Stale suppression and recipient review: ON
- Git commit: d88c70b
- Validation: 1 warnings
- Commitments: 10, drafts: 6
- Re-run with previous drafts identical: yes
- Test suite: passed (test-report.txt)

## Official checks

| Check | Result | Points | Detail |
|---|---|---|---|
| owner_deadline_status | PASS | 10 | 10 of 10 labelled commitments have the correct owner, deadline and status |
| zero_wrong_reminders | PASS | 10 | 0 active reminders for 4 completed, cancelled or deferred commitments |
| one_action_one_draft | PASS | 5 | 6 drafts for 6 commitments, no duplicates |

## Labelled commitments

| Action | Source message | Expected owner / due / status | Actual | OK | Reminder eligibility | Active draft | Evidence |
|---|---|---|---|---|---|---|---|
| A1 | M01 | dev / 2026-10-21 / open | dev / 2026-10-21T18:29:00.000Z / open | owner, deadline, status | eligible: agrees | pending_review v2 | M01, M11 |
| A2 | M02 | asha / 2026-10-17 / done | asha / 2026-10-17T18:29:00.000Z / done | owner, deadline, status | not eligible: agrees | none | M02 |
| A3 | M03 | mina / 2026-10-18 / open | mina / 2026-10-18T18:29:00.000Z / open | owner, deadline, status | eligible: agrees | pending_review v1 | M03 |
| A4 | M04 | omar / 2026-10-19 / open | omar / 2026-10-19T18:29:00.000Z / open | owner, deadline, status | eligible: agrees | pending_review v1 | M04 |
| A5 | M05 | ria / 2026-10-19 / cancelled | ria / 2026-10-19T18:29:00.000Z / cancelled | owner, deadline, status | not eligible: agrees | none | M05 |
| A6 | M06 | dev / 2026-10-21 / deferred | dev / 2026-10-21T18:29:00.000Z / deferred | owner, deadline, status | not eligible: agrees | none | M06 |
| A7 | M07 | asha / 2026-10-18 / done | asha / 2026-10-18T18:29:00.000Z / done | owner, deadline, status | not eligible: agrees | none | M07 |
| A8 | M08 | mina / 2026-10-20 / open | mina / 2026-10-20T18:29:00.000Z / open | owner, deadline, status | eligible: agrees | pending_review v1 | M08 |
| A9 | M09 | omar / 2026-10-22 / open | omar / 2026-10-22T18:29:00.000Z / open | owner, deadline, status | eligible: agrees | pending_review v1 | M09 |
| A10 | M10 | ria / 2026-10-23 / open | ria / 2026-10-23T18:29:00.000Z / open | owner, deadline, status | eligible: agrees | pending_review v1 | M10 |

## Suppressed or closed work

- c_M02 done: Export catalogue (evidence M02)
- c_M05 cancelled: Prepare paid campaign (evidence M05)
- c_M06 deferred: Enable live payment (evidence M06)
- c_M07 done: Check test data (evidence M07)
