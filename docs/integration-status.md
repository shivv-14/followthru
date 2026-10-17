# Integration status

Last updated: 17 Oct 2026. Branch `full-integration`.

Parallel development has stopped. The project is now built and maintained from one laptop, in this repository.

## What was combined

| Source | State found | What happened |
|---|---|---|
| Backend `back-a-p1` (`4ab10b9`) | Pushed. Contract, validation, CSV/JSON, deadlines | Integration branch created from it |
| Frontend `ui-b-p1` (`3e1847f`) | Already merged to `main` via PR #4 | `main` merged in with a merge commit (`00f2493`). Every `ui-b-p1` commit is in this branch |
| Frontend `ui-b-p0` | Merged via PRs #2 and #3 | Included through `main` |

Conflicts on merge:
- `src/App.tsx`, `src/main.tsx`, `tests/app.test.tsx`: the frontend versions were kept. The backend side had only scaffold placeholders.
- `package-lock.json`: the frontend lockfile was out of sync with `package.json` (`npm ci` failed on missing `@emnapi/*` entries). The backend lockfile was kept; `package.json` was identical on both sides.

Recovered frontend work: design tokens and global styles, UI primitives (Button, Input, Card, StatusChip, Tabs, Dialog, states, SkipLink, NavItem), the app shell (sidebar, top bar, bottom tabs, mobile sheet), the lazy 3D stage with a 2D fallback, the style guide, the landing, setup and profile pages, the route tree, and the demo-mode flag.

Removed as superseded: `src/mocks/engineResult.ts` (a static fake result, unused) and `src/pages/RouteSkeleton.tsx` (placeholders, now real screens).

**Not recoverable from here:** anything uncommitted on Zohaib's laptop. Everything his status doc lists is committed. His notes mention running on port 5180, which no committed config sets, so there may be local-only changes. If anything is missing, he needs to commit and push it to a branch.

## What now works end to end

- Setup loads the challenge fixture (when present), a JSON or CSV import, or the synthetic demo. Validation errors block loading.
- Profiles come from the loaded data. Coordinators and members get different permissions, enforced in the engine and in actions.
- The engine replays the full history: requests, promises, acceptance, delegation (owner moves only on acceptance), completion in another thread, cancel, defer, deadline changes, tentative deadlines, and unauthorised completion claims sent to review.
- Draft queue: one draft per commitment, versioned updates, follow-up flow steps, stale suppression, recipient warnings and confirmation, and a freshness check right before approval.
- Coordinator decisions (done, cancel, defer, reopen, reassign, re-date, resolve review), manual task assignment to a person or a team, member progress, blockers, and submissions with files. Every write is audit-logged.
- Evidence: the scorecard for the three official checks, CSV/JSON exports, file uploads with SHA-256, saved runs, the audit log, and `npm run evidence`.
- API: `/api/health` and `/api/process` (Vercel functions, also served by `npm run dev`).
- Offline PWA build.

## Contract changes during integration (additive only)

`src/engine/types.ts` gained optional `Commitment` fields (`source`, `teamId`, `progress`, `blockers`, `submissions`, `linkedMessageIds`) and optional `Draft` fields (`flowId`, `step`, `approvedBy`, `approvedAt`). It also gained new types: `Flow`, `FlowStep`, `HumanDecision`, `ManualTask`, `EngineInput`, `TaskProgress`, `Blocker` and `Submission`, plus a new review reason `unauthorised_status_claim`. No existing field changed.

Later additive changes:
- `CommitmentEventType` gained `progress`, `not_done` and `blocker` (owner updates recorded as evidence; they never change status).
- `Draft` gained optional `subject`, `recipientRole` and `replyState`; `DraftVersion` gained optional `subject`; `FlowStep` gained optional `recipient` (`owner`, `requester`, `coordinator`); new types `RecipientRole` and `ReplyState`. New exports `composeSubject`, `expectedRecipient`, `replyState`. A change in the owner's reply state is a new draft version with cause `reply_changed`. `checkBeforeApproval` takes an optional `people` map.
- `DraftState` gained `rejected`; `Draft` gained optional `rejectedBy`, `rejectedAt`, `rejectReason`, `editedBody`, `editedBy`, `editedAt`. New exports `rejectDraft`, `editDraft`, `draftText`, `MAX_DRAFT_BODY`. Rejections and edits survive engine runs until a new version is written.
- `DecisionType` gained `request_extension` and `decline_extension`; `CommitmentEventType` gained `extension_requested`; `Commitment` gained optional `extensionRequest` (new type `ExtensionRequest`); `HumanDecision` gained optional `recordedAt`, used to order decisions made at the same evaluation time. A pending extension request never changes the deadline; approving it is a coordinator `change_deadline`.
- New engine exports `rulesExtractor` and type `Extractor` (src/engine/extractor.ts). `runEngine` and `resolveCommitments` take an optional extractor that defaults to the rules.

No engine contract change came with the explain and replay tools: `src/components/domain/explain.ts` and `timeTravel.ts` only read engine output, and replay re-runs `runEngine` on a filtered copy of the data.

## Tooling fixes

- Windows drive letter: opening the repo as `d:ollowthru` (lower case) made Vitest load setup files twice and fail. `npm test` now goes through `scripts/vitest.cjs`, which upper-cases the drive letter before starting Vitest. `npm run test:drive-case` checks both spellings.
- Accessibility: `e2e/a11y.spec.ts` runs axe (WCAG 2 A and AA, serious and critical only) on the landing and seven app pages, checks for horizontal scroll at 360, 390, 768, 1024 and 1440 px, and checks the reduced-motion landing. The first run found faint-text contrast (3.4:1), white on accent buttons (4.3:1), landing nav links (2.9:1), queue tabs overflowing at phone width and a date input overflowing at 1024 px. All are fixed; the text-faint token is now 58% white and solid buttons use `accent-strong`.

## Still incomplete

| Item | Why |
|---|---|
| Scoring the 10 labelled commitments | `Starter_Data/C14/fixture.json` is not in the repo or on this laptop. Accuracy has not been measured, and the app shows "Not scored" |
| Mapping the real fixture | Its field names are unknown. If they differ from the canonical format, a small adapter is needed |
| AI extraction | No provider or key is configured. The flag exists and is labelled "Rules (fallback)" |
| Real sending | Out of scope by design (shadow mode) |
| Growth experiment and MBA deliverables | Not software. Not started here |
| Landing media | The hero, scroll story and footer videos stream from a third-party CDN. Offline, the landing shows the poster or a plain background; the app itself works offline |
