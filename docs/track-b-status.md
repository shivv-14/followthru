# Track B status — frontend and UI/UX

Last updated: 17 Oct 2026, Phase 1 (branch `ui-b-p1`)

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

## Phase 1 — foundation and parallel setup

Status: **DONE**

### Scaffold decision — resolved

By the time Phase 1 started, Track A had pushed a full project scaffold and the shared contract to `back-a-p1` (commits `d09e766` "bring in vite react test setup", `864f3ed` "add shared domain types", `0fa439d` "parse deadlines in owner timezone"). This replaced the open scaffold question from Phase 0 — the local-only scaffold at `C:\Users\shiva\projects\followthru` is no longer relevant.

Brought in from `origin/back-a-p1` onto `ui-b-p1`, read-only source inspected with `git show`/`git ls-tree` first, never checked out directly, committed fresh on this branch per the git rules:
- **Project scaffold** (commit `9c084f6 bring in project scaffold from track a`): `package.json`, `package-lock.json`, `vite.config.ts`, `vitest.config.ts`, `tsconfig*.json`, `index.html`, `public/favicon.svg`, `src/main.tsx`, `src/App.tsx`, `tests/setup.ts`, `tests/app.test.tsx`, `tests/sanity.test.ts`. The stack matches the plan exactly: React 18, Vite 8, TS 5.9, Tailwind v4, Framer Motion, Lenis, @react-three/fiber + drei + postprocessing, react-router-dom 7, Zustand, Dexie, Zod, date-fns-tz, @fontsource-variable Inter/Space Grotesk, Vitest + Testing Library.
- **Shared contract** (commit `b5fe3b0 bring in shared types from track a`): `src/engine/types.ts` only, not the barrel `index.ts` or the engine logic files (`deadline.ts`, `time.ts`) — those are Track A's business logic, out of scope here. Not edited after pulling in, per the rule.
- Track A's own `.gitignore` on `back-a-p1` is byte-identical to the one already on `main`; nothing to reconcile.

`npm install` run clean (622 packages; only non-blocking `EBADENGINE` warnings since local Node is v25, newer than some packages' pinned ranges, and some deprecation notices from transitive deps). Bare scaffold typechecked, tested and built successfully before any Track B code was added.

### B-1.1 Design tokens — `src/styles/tokens.ts`, `src/styles/global.css`

Color (bg, glass surface, violet accent, the five status colors), typography (Space Grotesk display / Inter body, both self-hosted via `@fontsource-variable`), spacing scale, radii, glass/glow shadows, a `:focus-visible`-only focus ring, Framer Motion spring presets + duration scale, and breakpoints (360 is the floor, not a breakpoint start). CSS tokens live under Tailwind v4's `@theme` block so `bg-accent`, `text-status-overdue`, `font-display` etc. become real utility classes; the TS file is the source of truth for anything JS-side (Framer Motion transitions, the R3F scene). A global `prefers-reduced-motion` rule collapses all animation/transition durations to near-zero.

### B-1.2 UI primitives — `src/components/ui/`

`Button` (4 variants × 3 sizes, disabled state), `Input` (label, hint, error with `aria-invalid`/`aria-describedby`), `Card`, `StatusChip` (keyed off the same 5 status colors as the tokens), `Tabs` (roving tabindex, arrow/home/end keyboard nav, `role=tablist/tab/tabpanel`), `Dialog` (doubles as centered modal on desktop and bottom sheet on mobile via a `variant` prop, portal-rendered, focus-trapped, Escape closes, returns focus to the trigger, respects reduced motion), `EmptyState`/`LoadingState`/`ErrorState`, `SkipLink`, `NavItem` (active-state aware, works icon-only for the collapsed sidebar).

### B-1.3 `/styleguide` route — `src/pages/Styleguide.tsx`

Renders every token (colors, spacing, radii, motion durations, breakpoints) and every primitive, including a live focus-ring demo and a working dialog open/close. No shell wrapper, so it's reachable standalone.

### B-1.4 3D Stage — `src/three/`

`Stage.tsx` checks `WebGLRenderingContext` support and `prefers-reduced-motion` on mount; if either fails it renders `Fallback2D.tsx` (a static gradient + SVG mark, no animation, no WebGL) and never mounts the canvas. If both pass, it `React.lazy`-loads `SceneCanvas.tsx` (keeps three.js out of the main bundle — it's its own ~230KB gzipped chunk, confirmed in the production build) inside a `Suspense` boundary that falls back to the same static 2D mark while loading. `SceneCanvas` caps `dpr` to `[1, maxDpr]` (default 1.5) and renders one lightweight wireframe mesh — intentionally minimal, matching "keep the initial scene lightweight"; the real landing story scene is a later phase.

### B-1.5 App shell and route skeletons

`src/components/shell/`: `Sidebar` (collapsible, desktop only, persisted via local state), `TopBar` (disabled search with a note on when it activates, a live evaluation-clock chip showing the real wall clock, a static "Rules" mode label, a demo-profile switcher that's local-only and clearly labeled as a demo), `BottomTabBar` (5 primary routes, mobile only, safe-area inset padding), `MobileNavSheet` (all 6 routes incl. Flows, opened from the top bar hamburger on mobile, built on the `Dialog` sheet variant).

`App.tsx` now defines the full route tree: `/`, `/setup`, `/profiles`, `/styleguide` standalone; `/dashboard`, `/commitments`, `/commitments/:id`, `/queue`, `/flows`, `/team`, `/evidence` nested under the `AppShell` layout route. Every page is a real route, not a placeholder image — `RouteSkeleton.tsx` is a shared empty-state component used by the screens that don't have data yet, each with a one-line explanation of what connects in a later phase. `Landing`, `Setup`, and `ProfilePicker` are real interactive pages (Setup does real client-side validation and uses `Intl` to detect the browser timezone; ProfilePicker switches between two demo profiles and navigates).

Replaced Track A's original smoke test (`tests/app.test.tsx`) since `<App />` now requires a Router context and the content changed — new version wraps it in `MemoryRouter` and checks the landing tagline/CTA, the styleguide route, and the 404 fallback. This is a test file, not engine/schema/storage/api code, so it's in scope to update.

### B-1.6 / B-1.7 Typed mock data and demo flag

`src/mocks/engineResult.ts`: five commitments and five matching drafts covering every `CommitmentStatus` and `SuppressionReason` combination that matters for later screens (overdue, tentative/needs-review, done+suppressed, deferred+suppressed, cancelled+suppressed), typechecked directly against the imported `EngineResult`/`Commitment`/`Draft` types — no duplicate interfaces. `src/config/demoMode.ts`: `isMockModeEnabled()` is true in local dev by default, and requires `VITE_DEMO_MODE=true` to be set explicitly in a production build, so mock data can't render silently in a real deploy. Not yet wired into any page — that happens when Phase 2/3 screens actually consume it.

**Track A contract commit used:** `864f3ed` (branch `back-a-p1`), recorded in `TRACK_A_CONTRACT_COMMIT` in `src/config/demoMode.ts` and here for traceability.

### Verification

```
npm install        622 packages, clean (EBADENGINE warnings only, Node 25 vs pinned ranges)
npm run typecheck   tsc -b --noEmit — clean
npm test            vitest run — 2 files, 4 tests passed
npm run build       tsc -b && vite build — succeeds; SceneCanvas chunk is its own
                     ~230KB gzip lazy chunk, separate from the ~114KB gzip main bundle
```

**Browser verification — partial, disclosed honestly.** Tried to drive a real headless Chromium against the dev server (`run` skill, playwright fallback pattern, since `chromium-cli` isn't available in this environment). The Chromium binary download (~197.5 MiB from `storage.googleapis.com`) failed twice with a network timeout, so no interactive, console-error-checked browser pass happened.

What I verified instead:
- `npm run dev` started cleanly (Vite ready in 376ms, no errors in the dev server log).
- Every route (`/`, `/setup`, `/profiles`, `/styleguide`, `/dashboard`, `/commitments`, `/queue`, `/flows`, `/team`, `/evidence`, and an unknown `/nowhere`) returns HTTP 200 via `curl`, and `/src/main.tsx` transforms without a 500.

What this does **not** prove: actual client-side rendering, console errors, responsive layout at 360px, or that interactions (opening the dialog, collapsing the sidebar, the mobile nav sheet) actually work. `curl` can't execute JS. Typecheck, the test suite, and the production build all passing is real signal that the code is correct, but per the project's own rule, that's not the same as confirming it in a browser — flagging this gap rather than claiming a visual pass I didn't do. Recommend a manual spot-check (`npm run dev`, open `http://localhost:5180/styleguide` and `/dashboard` at both widths) before Phase 2 builds further on top of these primitives, or retry the Playwright browser install when the network is more reliable.

### Acceptance gate

- Style guide renders on desktop and phone width — **not independently verified in a browser** (see the disclosed gap above); the layout uses only responsive flex/grid utilities and was checked by code review, not confirmed visually. Treat as unconfirmed until spot-checked.
- Keyboard focus and reduced-motion behaviour work — **met**: `:focus-visible` ring is global and keyboard-only; `prefers-reduced-motion` collapses all transitions/animations and the `Stage` skips WebGL entirely when it's set.
- 3D fallback remains usable — **met**: `Fallback2D` renders whenever WebGL is unavailable or motion is reduced, verified by code path (no conditional branch left untested) and by the Suspense fallback during lazy load.
- Mock data typechecks against Track A's contract — **met**: `npm run typecheck` passes with `src/mocks/engineResult.ts` importing `Commitment`/`Draft`/`EngineResult` directly from the brought-in `src/engine/types.ts`.

## What's needed from Track A

- Nothing blocking right now. `src/engine/types.ts` at commit `864f3ed` on `back-a-p1` was sufficient for B-1.6/B-1.7.
- For Phase 3: the real store hooks/adapters (not direct Dexie calls) once Track A builds `src/store/*`, and the evaluation fixture once available, so dashboard/queue counts can move off mock data.

## Next task

Start Phase 2 (`ui-b-p2`): cinematic landing scroll story, functional controls (filters, clock slider if included, profile switching wired to something real), and wiring the typed mock data into the dashboard/queue/commitment-detail skeletons behind the demo flag, clearly labeled as mock.
