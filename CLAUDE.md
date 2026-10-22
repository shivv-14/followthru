# FollowThru - project memory

## What we are building
FollowThru is an automated chaser draft queue for project coordinators
(Fynd Hackathon 2026, challenge C14). It reads team conversations, finds
commitments, keeps owner, deadline and status correct across the whole
history, and drafts reminders only for overdue, still-open work. It never
chases completed, cancelled or deferred work. A coordinator reviews every
draft and its recipient. Shadow mode only: nothing is ever sent.
Tagline: "Chase what's late. Never what's done."

Two roles, as local demo profiles taken from the loaded data (no real login):
- Coordinator: dashboard, assign tasks to people or teams, deadlines,
  follow-up flows, review drafts, approve submissions, evidence.
- Member: own tasks, progress, blockers, submit work.

## Scoring from the brief
- 10 points: correct owner, deadline and status for the ten labelled
  commitments, with evidence (message ids).
- 10 points: zero reminders for completed, cancelled or deferred work.
- 5 points: one action creates one draft; a later deadline update changes
  the same draft (new version), never a duplicate.
- Edge cases: "maybe Friday" (tentative), timezones, delegated owner,
  completion in another thread, no response versus not completed.
- Product change: stale-message suppression and recipient review. Keep the
  starting state, the negotiated scope and the final evidence.

## Golden engine rules
1. Silence never changes status. No reply means responseState "pending".
2. Only the owner, the requester, a coordinator, or an authorised human
   decision can change status.
3. Weak or ambiguous evidence sets needsReview. Never a silent change and
   never a chase while a possible completion is unresolved.
4. "now" is always passed in (EngineConfig.now). Never call Date.now() or
   new Date() inside src/engine.
5. Times are stored as UTC ISO strings. Relative phrases are read in the
   timezone of the person who said them.
6. Every decision keeps evidence: message id, thread id, time, short quote
   and the rule name that fired.
7. Never hardcode answers from fixture labels into the engine. Labels are
   read only by evaluate.ts, tests and the evidence script.
8. One commitment, at most one draft (id d_<commitmentId>). Drafts update in
   place with a version number and history.

## Workflow (single laptop)
- One developer, one branch: full-integration. Push with
  git push origin full-integration.
- main changes only after the exact phrase "merge into main".
- No force push, reset --hard, clean, checkout -- ., rebase of pushed
  branches, or branch deletion. Never stash or discard work you did not make.
- Run commands from D:\followthru (uppercase drive letter).
- docs/TRACK_A_BACKEND_PROMPT.md and docs/FollowThru_Solo_Master_Prompt.pdf
  are the owner's untracked files: leave them alone.

## Architecture
- src/engine/types.ts: the single domain contract
- src/engine/time.ts: timezone helpers, DST-safe wall time to UTC
- src/engine/deadline.ts: deadline phrases, tentative hedges, overdue checks
- src/engine/signals.ts: message signals, keywords, titles
- src/engine/history.ts: commitments, linking, history replay, decisions
- src/engine/drafts.ts: one versioned draft per commitment, suppression
- src/engine/approval.ts: freshness and recipient checks before approval
- src/engine/flows.ts: follow-up flows and steps
- src/engine/permissions.ts: role rules
- src/engine/evaluate.ts: scorecard for the three official checks
- src/engine/run.ts: runEngine entry point, config, mode label
- src/schema/input.ts, validate.ts, io.ts: Zod input, validation, CSV/JSON
- src/store/db.ts, repo.ts: Dexie tables and the audited write layer
- src/store/EngineProvider.tsx, actions.ts, hooks.ts: the only way the UI
  reads data and performs actions
- src/pages/*.tsx: routes; src/components/{ui,shell,domain}: UI parts
- src/three, src/styles: 3D stage with 2D fallback, design tokens
- src/config/demoMode.ts, src/mocks/demoDataset.json: synthetic demo data
- api/_lib/handlers.ts, api/health.ts, api/process.ts: Vercel functions
- scripts/evidence.ts: hashed evidence runs
- tests/: Vitest; e2e/: Playwright with the installed Chrome
- vite.config.ts: app, dev API plugin, PWA; vercel.json: deploy settings

## Commands
- npm run dev: app and API on http://localhost:5173
- npm run build: typecheck and production build
- npm run preview: serve the build
- npm test: Vitest once
- npm run test:watch: Vitest in watch mode
- npm run typecheck: TypeScript check
- npm run evidence: scorecard and hashed outputs (add -- --demo for synthetic)
- npm run e2e: Playwright browser tests

## Data
- Challenge fixture is data/fixture.json (copied unchanged on 18 Oct 2026).
  src/schema/fixtureC14.ts maps its shape; notes in docs/fixture-notes.md.
  npm run evidence:fixture writes the scored evidence run.
- src/mocks/demoDataset.json is synthetic, has no labels and is never scored.
  The demo option shows in dev or when VITE_DEMO_MODE=true.

## Contract rules
- Change src/engine/types.ts additively only (optional fields, new union
  members, new types) unless the owner approves a breaking change.
- tests/contract.test.ts locks the public exports. Update it on purpose and
  log every contract change in docs/integration-status.md.

## Code rules
- Small files, clear names, no dead code, no console.log.
- Tests for every changed business rule.
- npm test, npm run typecheck and npm run build pass before every commit.
- Stage files by explicit path.

## Commit style
- All lowercase, 3 to 8 words, plain English, no symbols or prefixes,
  one line. No co-author trailers and no tool mentions.

## Honesty
- Never invent results, URLs, scores, labels or experiment rows. Placeholders
  such as LIVE_URL stay until real values exist. Synthetic data is always
  labelled synthetic.
