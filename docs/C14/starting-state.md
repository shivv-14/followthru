# Starting state (before this change request)

Recorded 2026-10-18T05:59Z, from the live app (https://followthru-ruby.vercel.app) and the code on branch `full-integration` at commit `754081e`.

## What already worked

- Supabase is the database (project `mxtcgulucnmbclmwtxfa`), with RLS on every table, server API routes (`api/_lib/cloud`) and atomic writes (`public.apply_ops`). Data survives reloads and sign-outs.
- Real accounts (Supabase Auth): sign-up, username or email login, temporary passwords that must be changed, disable/enable, roles.
- The C14 engine (`src/engine`): extracts commitments from whole threads, resolves owner, deadline and status changes, tentative deadlines ("maybe Friday"), timezones, delegation, completion in another thread, silence never closes work, one versioned draft per commitment, stale suppression and recipient review. Covered by unit tests.
- Draft queue with approve, edit, reject, recipient confirmation; in-app delivery only (nothing emailed).
- Audit log, notifications, comments, file uploads with hash checks.

## Problems found

| Problem | Where |
|---|---|
| Two ways to create a workspace: a "Create a workspace" link plus a "New workspace" link, and a Coordinator / Team lead choice on sign-up | `src/pages/CloudLogin.tsx`, `src/pages/Signup.tsx` |
| No way for a team member to sign up and ask to join a workspace; only coordinators could create member accounts | missing |
| Coordinator-created accounts got a random temporary password | `api/_lib/cloud/routes/accounts.ts` |
| Assign task form had a single optional "Deadline"; no start date, description or priority | `src/pages/Team.tsx` |
| Team members saw an empty Audit log (RLS allowed coordinators only) | `supabase/migrations/...002_security.sql` |
| Approve button read "Approve (shadow, not sent)" | `src/pages/Queue.tsx` |
| Import offered JSON to normal users; no PDF import | `src/pages/Setup.tsx` |
| A reminder approved during quiet hours would still appear after the task closed | `api/_lib/cloud/sync.ts` |
| No growth experiment tracker | missing |
| No "Start Draft" text exists in the code; read as the missing start/end dates on task assignment | — |

## Official fixture

`Starter_Data/C14/fixture.json` is not in the repository and was not found anywhere on this laptop (searched the drives to depth 6 on 2026-10-18). The ten labelled commitments therefore cannot be scored yet; the app shows "Not scored" for that check.
