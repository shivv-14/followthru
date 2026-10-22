# Implementation notes

## Database (migration `supabase/migrations/20261018000005_workspaces_and_join.sql`, applied to the live project 2026-10-18)

- `profiles.org_id` may be null (team member before approval). RLS hides all workspace data from such accounts.
- `organizations.description`, `organizations.discoverable`.
- `join_requests` with a partial unique index (one pending request per person per workspace).
- `tasks.start_at` with check `due_at >= start_at`.
- `notifications.cancelled_at`; the read policy hides cancelled notifications.
- `audit_log.subject_profile_id` and policy `audit_member_read`.
- `growth_experiments` (ten rows per workspace, unique `(org_id, slot)`).
- `apply_ops` allows the two new tables.

## Server routes (`api/_lib/cloud`)

- `auth/signup` creates a workspace whose creator is always `coordinator`; `auth/signup-member` creates a workspace-less member.
- `workspaces/list`, `workspaces/request`, `workspaces/requests`, `workspaces/decide` (approval inserts the person, sets the profile's workspace and notifies, in one transaction).
- `accounts/create` uses username + 1; `accounts/link-person` removes the placeholder person.
- `tasks/create` accepts `startAt`, `description`, `priority`.
- `experiments/list`, `experiments/save`.
- `sync.ts` cancels held reminder notifications when an approved draft becomes suppressed or stale.

## C14 rules and where they live

| Rule | Implementation | Tests |
|---|---|---|
| A owner, delegation | `src/engine/history.ts` | `tests/engine.test.ts` |
| B deadline, history | `src/engine/history.ts`, `deadline.ts` | `tests/engine.test.ts`, `tests/deadline.test.ts` |
| C overdue | `deadlineState` in `src/engine/deadline.ts` | `tests/deadline.test.ts` |
| D completion, other thread, uncertain link → review | `src/engine/history.ts` | `tests/engine.test.ts` |
| E/F cancelled, deferred | `src/engine/drafts.ts` suppression | `tests/engine.test.ts` |
| G silence | `responseState: pending`, status unchanged | `tests/engine.test.ts` |
| H uncertain deadline | tentative certainty, clarify draft | `tests/deadline.test.ts` |
| I/L one draft, no duplicates | draft id `d_<commitment>`, unique `(org_id, task_key)` in `reminder_drafts`, idempotent sync | `tests/engine.test.ts`, `tests/db/rls.test.ts`, live check "repeated engine runs change nothing" |
| J stale suppression | `checkBeforeApproval`, sync suppression, held notification cancel | `tests/engine.test.ts`, `tests/cloud.test.ts` |
| K recipient review | recipient confirmation required before approval | `tests/engine.test.ts`, `tests/store.test.ts` |
