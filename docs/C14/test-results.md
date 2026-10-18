# Test results

Run on 2026-10-18 (UTC) after the change request, on branch `full-integration`.

| Suite | Command | Result |
|---|---|---|
| Unit, engine, store, UI, server helpers, CSV/PDF import | `npm test` | **295 passed, 0 failed** |
| Database migrations and RLS in a local Postgres (included above) | `npm run test:db` | 19 passed |
| Browser tests (demo mode) incl. accessibility and screen widths | `npx playwright test` | **22 passed** |
| Live API checks against the deployed site and the real Supabase project | `SMOKE_BASE=https://followthru-ruby.vercel.app npm run cloud:smoke` | **58 of 58 passed** (throwaway workspace created and deleted) |
| Type check and production build | `npm run typecheck`, `npm run build` | passed |

## Official ten labelled commitments

**Not run.** `Starter_Data/C14/fixture.json` is not available on this machine or in the repository. Copy it to `data/fixture.json` (or import it through the internal fixture button on the import page) and run `npm run evidence` to score owner, deadline and status for the ten labels. No replacement data has been presented as the official fixture.

## Scorecard on the synthetic demo (not the official fixture)

`npm run evidence -- --demo` → `evidence/demo-runs/2026-10-18_06-04-07_run/` (commitments.csv, drafts.csv, suppressions.csv, scorecard.md):

- owner / deadline / status: not scored (the demo has no labels)
- zero wrong reminders: PASS, 0 active reminders for 4 completed, cancelled or deferred commitments
- one action, one draft: PASS, 3 drafts for 3 commitments, no duplicates

## Mandatory edge cases (supplemental, synthetic)

| # | Case | Where it is tested |
|---|---|---|
| 1 | "Maybe Friday" stays tentative | `tests/deadline.test.ts`, `tests/engine.test.ts` |
| 2 | Timezone conversion and overdue | `tests/deadline.test.ts`, `tests/time.test.ts`, `tests/cloud.test.ts` (quiet hours) |
| 3 | Delegated owner | `tests/engine.test.ts` |
| 4 | Completion in another thread suppresses | `tests/engine.test.ts` |
| 5 | No response keeps status | `tests/engine.test.ts` |
| 6–8 | Completed, cancelled, deferred: zero active reminders | `tests/engine.test.ts`, live check "no active reminder for closed work" |
| 9 | Deadline update changes the same draft | `tests/engine.test.ts` |
| 10 | Repeated processing is idempotent | live check "repeated engine runs change nothing and duplicate nothing" |
| 11 | Completion after draft creation suppresses | `tests/engine.test.ts`, live check "approval suppresses the reminder" |
| 12 | Completion after approval, before delivery: blocked | `tests/cloud.test.ts` "cancels a held in-app reminder" |
| 13 | Missing owner → review | `tests/engine.test.ts` (unclear owner) |
| 14 | Invalid deadline / timestamp → validation | `tests/validate.test.ts`, `tests/simpleCsv.test.ts` |
| 15 | Duplicate delivery → one state change | live checks "same import twice is refused", "join request saved once" |

## New features checked live (in the 58)

Team member sign-up without a workspace; workspace list; join request saved once; coordinator notification; members cannot approve; approval makes the member part of the workspace; member sees their own audit history and approval notification; end before start refused; task saved with start, end, description and priority and visible to the member; first password = username + 1 and must be changed.
