# Track B status — frontend and UI/UX

Last updated: 17 Oct 2026, Phase 0 (branch `ui-b-p0`)

## Phase 0 — kickoff and baseline

Status: **DONE**

### B-0.1 Repository baseline

- GitHub repo `shivv-14/followthru`. Default branch verified as `main` via `git remote show origin` (not assumed).
- `main` has a single commit, `f07fbcd Initial commit`, containing only `README.md` (`# followthru`).
- No `package.json`, no `src/`, no routes, no styling system, no components, no assets, no tests exist on `main` or anywhere in this repo yet.
- `git status --short` before branching showed only the untracked `docs/` folder (planning docx files and the track B prompt), which was left as is.
- Local working folder: `D:\followthru`, freshly initialised against `origin` this session (`git init` + `git remote add origin`).
- Commit identity confirmed clean: `zohaib <mohammedzohaib049@gmail.com>` (existing local git config, unchanged).

### B-0.2 Framework and dependencies

- No dependencies are installed anywhere in this repo — there is no `package.json` to install from.
- Locally available tooling: Node v25.3.0, npm 11.6.2. Sufficient to scaffold Vite/React/TypeScript when Phase 1 starts.
- Do not assume Vite/React/Tailwind/Framer Motion/R3F are present — confirmed absent. They will need to be scaffolded fresh in Phase 1 per the stack listed in the track B prompt (React 18 + Vite + TypeScript, Tailwind v4, Framer Motion, Lenis, @react-three/fiber + drei + postprocessing, Vitest + Testing Library, Playwright, vite-plugin-pwa).

### Note on the "earlier random prompt" scaffold

Track A's Phase 0 notes (`docs/track-a-status.md` on `back-a-p0`, read via `git show`, not checked out or edited) record that an earlier local scaffold exists at `C:\Users\shiva\projects\followthru` on a different machine. It has a working Vite + React + TS setup matching the planned stack, with empty `src/pages`, `src/components`, `src/three`, `src/styles` barrels.

That scaffold:
- is **not on GitHub** (its own `origin/main` points at a different, orphaned commit history),
- is **not present on this machine** (`D:\followthru`), so it cannot be inspected or reused directly from here,
- is flagged by Track A as risk R2: whoever brings it onto a branch needs owner approval, since `src/pages`, `src/components`, `src/three`, `src/styles` are Track B's owned folders.

Decision for Phase 0: do not attempt to bring that scaffold in blindly. It lives outside this repo and this machine, so there's nothing concrete to reuse yet. Flagged to the owner below — if that scaffold should be the base for Phase 1, it needs to be pushed to a branch first so Track B can inspect it with `git fetch` + `git show` like any other dependency.

### B-0.3 Branch

- Verified base branch is `main` (not assumed).
- Created `ui-b-p0` from `main`, pushed with upstream tracking: `git push -u origin ui-b-p0`.
- Owned folders (`src/pages/`, `src/components/`, `src/three/`, `src/styles/`, frontend adapters, `src/mocks/`) do not exist yet — nothing to confirm preserved, nothing to accidentally overwrite.

### B-0.4 Screen inventory, navigation and interaction patterns (from the solution blueprint)

Source: `docs/Hackathon_Complete_Solution_Blueprint.docx`, section 10.

**Screens**

| Screen | Purpose | Key elements | States |
|---|---|---|---|
| Landing (`/`) | Explain value in 30s | 3D scroll story: chaos → scan → sort by status → queue; live counts; CTA | WebGL fallback, reduced motion |
| Setup | First run | Name, timezone, load Fynd data, validation summary | Errors block import |
| Profile picker | Choose role | Coordinator and member cards, optional PIN | — |
| Dashboard | What needs attention now | KPIs, attention list, 3D status ring, 7-day deadline strip, team health, engine chip | Loading skeletons, empty |
| Commitments | All items | Table/cards, filters in URL, bulk export | No results |
| Commitment detail | Explain and decide | Why? panel, evidence timeline, time-travel slider, draft card, actions | needsReview banner |
| Queue | Review drafts | Lanes, recipient review, freshness chip, keyboard nav, before/after toggle | Approve disabled with reason |
| Flows | Automation | Step builder, live preview, validation | Defaults locked |
| Team / Me | Assign and do work | Assign sheet, submissions inbox, blockers; my tasks, submit with files | Celebration on approval |
| Evidence / Data / Audit | Proof and control | Scorecard, runs, uploads with hashes, import/export, audit diff | Validation table |

**Navigation and responsiveness**
- Desktop: collapsible glass sidebar + top bar (search, evaluation-clock chip, Rules/AI mode chip, profile switcher).
- Mobile: bottom tab bar, cards instead of tables, bottom sheets instead of modals, safe-area insets.
- Command palette: Ctrl/Cmd+K.

**Core journeys (from blueprint section on UX flows)**
- First run: landing → Open app → setup (name, timezone) → load data → validation summary → choose profile → dashboard.
- Daily triage: dashboard → "Needs your attention" → open commitment → Why? panel → Queue → confirm recipient → approve (shadow mode, no real send).
- Evidence: Evidence page → scorecard → download CSV/JSON → upload screenshot → audit shows the upload with timestamp and hash.

**Visual direction (confirmed against the track B prompt, consistent in both sources)**
- Dark background `#07060D`, glass surfaces, violet accent `#7C5CFF`.
- One colour per status: done mint `#3EE6B0`, overdue coral `#FF5D6C`, tentative amber `#FFB547`, deferred sky `#5CC8FF`, cancelled grey `#8A8799`.
- Space Grotesk for display, Inter for body, both self-hosted for offline use.
- Spring animations, Lenis smooth scroll on landing only, full `prefers-reduced-motion` support.

**Missing assets / blockers identified**
- No design files, icon set, or font files exist in the repo yet — self-hosted Space Grotesk and Inter weights need to be sourced in Phase 1.
- `src/engine/types.ts` is not published yet (Track A's `back-a-p0` has docs only, no engine code) — Phase 1's B-1.6/B-1.7 (typed mocks against the real contract) are blocked until Track A publishes it and shares the branch/commit hash. Phase 1 can proceed with tokens, primitives, shell and styleguide in the meantime, same as the written contingency.
- No evaluation fixture (`data/fixture.json`) is in the repo, so dashboard/queue counts and the "ten labelled commitments" cannot be grounded in real data until Track A supplies it — not a Track B blocker for Phase 0-2, but relevant for Phase 3.

### B-0.5 Motion and 3D mood notes (no copying)

Working from the mood described in the blueprint and track B prompt (not from inspecting any reference site layout):

- **Landing scroll story**: a single continuous scroll-driven sequence, not discrete slides — particles/message chips start scattered and "noisy" (chaos), then visibly settle into sorted groups as the user scrolls (scanning/understanding), then resolve into status-coloured orbits, then collapse into one organised queue list. Motion should read as *sorting*, not decoration.
- **Restraint over spectacle**: the 3D layer stays a thin accent behind glass-surface UI, not a full-screen hero that competes with text. Keep polycount and particle counts low; this is a dashboard product demo, not a games showcase.
- **Spring, not linear, easing**: all transitions (hover, panel open, status change) use spring physics for a slightly bouncy, physical feel rather than ease-in-out curves.
- **Status colour as the primary motion cue**: colour transitions (coral → mint, etc.) are the main way state change is communicated, reinforced by subtle motion, never colour alone.
- **Reduced motion is a first-class path**, not an afterthought: every scroll/3D sequence needs a static, still-informative equivalent — the chaos-to-order story should also work as a simple before/after pair of images or a static diagram for `prefers-reduced-motion` or no-WebGL.

### B-0.6 Deliverables

- `docs/track-b-status.md` (this file).
- Verified branch (`ui-b-p0`) and frontend baseline (confirmed empty — no existing UI to preserve).
- Reusable UI components: **none exist yet.**

## Existing screens / reusable components

None. This repo has no frontend code yet.

## Dependencies and run status

- Dependencies installed: none (no `package.json` in this repo).
- Run status: **not applicable — there is nothing to run.** This is the exact state, recorded per the acceptance gate rather than assumed.

## What's needed from Track A

- `src/engine/types.ts`, published on a `back-a-*` branch with a commit hash, before Phase 1 tasks B-1.6/B-1.7 (typed mocks) can start.
- Confirmation on whether the local-only scaffold at `C:\Users\shiva\projects\followthru` (noted in Track A's `docs/track-a-status.md`) should be pushed to a branch for Track B to inspect, or whether Track B scaffolds `src/pages`, `src/components`, `src/three`, `src/styles` fresh in Phase 1. Track A flagged this as risk R2 (folder ownership conflict) — needs an owner decision, not a Track B decision.

## Acceptance gate

- Current project runs or the exact failure is recorded — **met.** There is no project to run yet; that absence is recorded above rather than assumed.
- Existing UI work is preserved unless a change is justified — **met (trivially).** No existing UI work exists in this repo to preserve.
- Branch and owned folders are confirmed — **met.** Branch `ui-b-p0` created from verified `main` and pushed. Owned folders (`src/pages/`, `src/components/`, `src/three/`, `src/styles/`, `src/mocks/`) do not exist yet, so there is nothing to confirm beyond their intended location.
- No new screens built this phase — **met.**

## Next task

Start Phase 1 (`ui-b-p1`): scaffold the frontend (React 18 + Vite + TypeScript + Tailwind v4, matching the stack above) since no scaffold exists in this repo, then build design tokens, UI primitives, the `/styleguide` route, and the reusable 3D `Stage` wrapper with 2D fallback. B-1.6/B-1.7 (typed mocks against Track A's contract) stay blocked until Track A publishes `src/engine/types.ts` and shares the branch/commit hash.
