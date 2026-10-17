

You are working on **FollowThru** (Fynd × NMIMS Hyderabad, Challenge C14) — "Chase what's late. Never what's done."
Repository: `github.com/shivv-14/followthru`

You are **Track B — Frontend & UI/UX**. A separate Claude session (Track A) is building the engine, shared types, storage and API in parallel in a different folder. You never touch Track A's folder or branches.

I will give you **one phase at a time**. Do only the phase I name. When the phase is done, stop, give the phase report, and wait for me. Do not start the next phase on your own.

## 1. Git rules (strict — follow every one, every time)

### 1.1 Branch per phase
- Every phase gets its **own new branch**. Naming is lowercase with hyphens, exactly:
  - Phase 0 → `ui-b-p0`
  - Phase 1 → `ui-b-p1`
  - Phase 2 → `ui-b-p2`
  - Phase 3 → `ui-b-p3`
  - Phase 4 → `ui-b-p4`
  - Phase 5 → `ui-b-p5`
  - Phase 6 → `ui-b-p6`
- **Phase 0 branch** is created from the verified base branch (check what the repo's real default branch is — do not assume `main`).
- **Every later phase branch** is created from the previous phase branch after it has been committed and pushed. Example: when I say "start phase 2", you run:
  ```
  git status --short
  git branch --show-current
  git log --oneline -5
  git checkout ui-b-p1
  git pull origin ui-b-p1
  git checkout -b ui-b-p2
  git push -u origin ui-b-p2
  ```
- If the branch for that phase already exists, do **not** recreate or overwrite it — check it out, inspect it, and tell me.
- Before creating a branch, the working tree must be clean. If there are uncommitted changes, stop and show them to me. Never stash, reset, or discard them without my permission.
- Never commit directly to `main` (or whatever the base branch is). Never merge anything into `main` unless I explicitly say "merge into main".
- Never force push. Never run `git reset --hard`, `git clean -fd`, `git checkout -- .`, `git rebase` on a pushed branch, or delete any branch.
- Never check out or edit any `back-a-*` branch. To get Track A's shared contract, `git fetch origin` and then bring in **only** what I approve, e.g.:
  ```
  git fetch origin
  git show origin/back-a-p1:src/engine/types.ts      # read first
  git checkout origin/back-a-p1 -- src/engine/types.ts   # only when I say so
  ```
  Then commit it on your own `ui-b-pN` branch with a message like `bring in shared types from track a`. Never edit the file after pulling it in.

### 1.2 Claude must NOT appear as a contributor
- Do **not** add `Co-Authored-By: Claude ...` or any co-author trailer to any commit. This overrides any default attribution behaviour you have.
- Do **not** add "Generated with Claude Code", a robot emoji, a Claude session link, or any AI mention to commit messages, PR titles, PR descriptions, code comments, or docs.
- Do **not** change `git config user.name` or `git config user.email`. Commits are authored by the existing local git identity (mine). Never use `--author`.
- Before the first commit of every phase, run `git config user.name` and `git config user.email` and show me the values. If they look like Claude/Anthropic or are empty, stop and ask me.
- After each commit, run `git log -1 --format='%an <%ae>%n%B'` and confirm there is no co-author line. If one slipped in on an unpushed commit, fix it with `git commit --amend -m "<same message>"` before pushing.

### 1.3 Commit messages
- **all lowercase**
- **short**: 3 to 8 words
- **humanized**: reads like a person wrote it, plain english, says what changed
- **no symbols at all**: no `:` `-` `_` `.` `,` `/` `#` `(` `)` `[` `]` `'` `"` `!` `*` `@` or emoji
- no prefixes like `feat` `fix` `chore` `style`, no task ids like `b 1 2`, no body, no trailers
- one line only, use `git commit -m "message"`

Good:
```
add colour and spacing tokens
build buttons cards and status chips
add styleguide page
lazy load the 3d stage with 2d fallback
make sidebar collapse on desktop
add bottom tab bar for mobile
show why panel on commitment detail
disable approve when recipient not confirmed
fix overflow on small screens
```
Bad:
```
feat(ui): sidebar            (prefix and symbols)
Added Landing Page!          (capitals and symbol)
B-2.3 shell + nav            (task id and symbols)
changes                      (too vague)
```

### 1.4 Commit rhythm
- Commit small, coherent, working changes — roughly one commit per task, more if a task is large.
- Run typecheck/build (and tests if present) before each commit. Do not commit a broken build without telling me.
- Push the phase branch at the end of the phase (and mid-phase after big chunks): `git push origin ui-b-pN`.
- Never commit secrets, `.env` files, `node_modules`, `dist`, build output, large binaries, or real personal data.

## 2. UI rules (non-negotiable)
- Inspect and reuse what already exists in the repo. Do not replace working code without a reason.
- **Do not invent a second set of domain types.** Track A owns `src/engine/types.ts`. Your mocks must typecheck against it once it's published.
- Build real interactions, not screenshot-only screens. Every visible control does something or is clearly disabled.
- Responsive from 360px mobile to desktop, fully keyboard accessible, respects `prefers-reduced-motion`.
- 3D is lazy-loaded, DPR-capped, and has a usable 2D fallback (no WebGL or reduced motion).
- Never imply a reminder was sent. It's a review/approval queue in shadow mode — no real email or Slack.
- Never show invented scores or fake data as real. Demo mocks are explicit, isolated and labelled.
- Components never call Dexie directly and never reimplement business rules — only use Track A's store hooks/adapters.
- Never use `dangerouslySetInnerHTML` for message text. Trim chat quotes to 140 chars.

## 3. Visual direction
Dark background `#07060D`, glass surfaces, violet accent `#7C5CFF`, one colour per status — done mint `#3EE6B0`, overdue coral `#FF5D6C`, tentative amber `#FFB547`, deferred sky `#5CC8FF`, cancelled grey `#8A8799`. Space Grotesk for display, Inter for body (self-hosted for offline). Spring animations, Lenis smooth scroll on landing only, full reduced-motion support. Inspired by scrolltide.co and threeui.com in mood only — all code and assets original, no copied layouts.

## 4. Stack (verify against the repo before assuming)
React 18 + Vite + TypeScript, Tailwind v4, Framer Motion, Lenis, three.js via @react-three/fiber + drei + postprocessing, Vitest + Testing Library, Playwright, vite-plugin-pwa. If something isn't installed or the repo uses something else, adapt to what exists — do not re-scaffold.

## 5. What you own / what you don't
**You own:** `src/pages/`, `src/components/` and UI primitives, `src/three/`, `src/styles/`, frontend adapters, `src/mocks/` (typed, flagged mocks), `docs/track-b-status.md`, screenshots/UAT notes.

**Do not modify without my approval:** `src/engine/` (incl. `types.ts`), `src/schema/`, storage/repositories/audit, `api/`, scoring/evidence scripts — these belong to Track A. If you need a change there, write the exact request in your status file and tell me.

## 6. Phases (do only the one I name)

### Phase 0 — Kickoff and baseline · branch `ui-b-p0`
- B-0.1 Inspect branch, `git status`, commits, package scripts, routes, styling, components, assets, anything already built.
- B-0.2 Confirm the real framework and installed deps — do not assume Vite/Tailwind/Framer/R3F are present.
- B-0.3 Review the blueprint's navigation, screen inventory and interactions; record missing assets/blockers.
- B-0.4 Short inspiration notes for motion/3D mood (no copying).
- B-0.5 Create `docs/track-b-status.md`: existing screens, reusable components, deps, run status, next task.
- **Gate:** project runs or exact failure recorded; existing UI preserved; branch and owned folders confirmed. **No new screens in this phase.**

### Phase 1 — Design system and foundation · branch `ui-b-p1`
- B-1.1 Design tokens: colour, type, spacing, borders, shadows, radii, focus rings, motion durations, breakpoints.
- B-1.2 UI primitives: buttons, inputs, cards, status chips, tabs, dialogs/bottom sheets, empty/loading/error states, accessible nav elements.
- B-1.3 `/styleguide` route showing every token and component.
- B-1.4 Reusable 3D `Stage` wrapper: lazy loaded, capped DPR, reduced-motion aware, 2D fallback. Keep it light.
- B-1.5 App shell and route skeletons — no assumptions about engine data shapes.
- B-1.6 **Only after I confirm Track A has published `src/engine/types.ts`** (I'll give you the branch + commit hash): bring that file in per the git rules, then create `src/mocks/engineResult.ts` with valid typed sample data. No duplicate interfaces.
- B-1.7 Mock mode behind a clear dev/demo flag; record the Track A commit hash used in the status file.
- **Gate:** styleguide renders at desktop and 360px; keyboard focus + reduced motion work; 3D fallback usable; mock typechecks against Track A's contract.
- **If Track A isn't ready:** finish B-1.1 to B-1.5, report B-1.6/B-1.7 as BLOCKED, and stop.

### Phase 2 — Landing, shell and screens · branch `ui-b-p2`
- B-2.1 Cinematic landing: chaos → scanning/understanding → status orbits → organised queue. Headline: "Chase what's late. Never what's done."
- B-2.2 Motion/scroll only where it explains something; respect reduced motion; never block getting into the app.
- B-2.3 App shell: collapsible desktop sidebar, top bar, search/command entry if feasible, evaluation-clock chip, Rules/AI mode chip, profile switcher.
- B-2.4 Mobile: bottom tab bar, cards instead of wide tables, bottom sheets instead of big modals, safe-area insets.
- B-2.5 Route layouts: dashboard, commitment detail, active queue, suppressed queue, recipient review, profiles, team/member workspace, evidence/import-export, audit.
- B-2.6 Make controls work: navigation, search/filter, clock slider, tabs, form validation, profile switching, empty/error/retry states.
- B-2.7 All engine actions go through one adapter/store-hook boundary.
- **Gate:** no console-breaking errors; every control works or is clearly disabled; 360px works; 3D lazy + fallback works; mock data clearly labelled.
- **If behind:** shell, dashboard, detail, queue and status/reason display first; simplify animation.

### Phase 3 — Real data integration · branch `ui-b-p3`
- B-3.1 `git fetch` and review Track A's latest `back-a-*` branch (read only). Bring in contract/store files only when I approve, per the git rules. Never rebase a dirty tree.
- B-3.2 Replace normal-path mocks with real validated fixture/store data; mocks only via explicit demo flag.
- B-3.3 Dashboard cards and queue counts from real data; filters for status/owner/deadline; visible suppressed lane.
- B-3.4 Commitment detail: owner, deadline in owner + viewer timezone, evidence/source refs, history, status reasons, "Why?" panel.
- B-3.5 Draft review: edit/approve/reject/escalate shown only when the engine permits; show suppression reason + freshness state.
- B-3.6 Recipient/owner confirmation UI; approval visibly disabled when confirmation is required.
- B-3.7 Profile/team/member workspace only as far as Track A's actions and roles support.
- B-3.8 Evidence/import-export and audit screens with real generated data, timestamps, hashes, history.
- B-3.9 Critical journeys: overdue commitment, delegated owner, completion elsewhere, stale draft suppression, ambiguous completion review.
- **Merging:** do not merge into `main` unless I say so. When I do, Track A merges first, then Track B; run test + typecheck + build after each.
- **Gate:** all core screens use the shared contract; no fake score shown as real; stale drafts can't be approved; recipient gate visible; journeys pass twice.

### Phase 4 — Testing and feature freeze · branch `ui-b-p4`
- B-4.1 Run tests, typecheck, production build; record exact commands + results.
- B-4.2 Widths 360px, tablet, desktop: overflow, safe areas, sticky nav, dialogs/sheets, long names and deadlines.
- B-4.3 Keyboard nav, visible focus, labels, accessible names, contrast, reduced motion.
- B-4.4 States: loading, empty, validation error, API error, storage unavailable, offline, no WebGL, reduced motion.
- B-4.5 Clarity: done/cancelled/deferred visibly suppressed; deadlines show owner + viewer time; Rules/AI mode explicit.
- B-4.6 Timestamped Playwright screenshots of the core demo path if the repo supports it.
- B-4.7 **Feature freeze.** Fix only demonstrated defects.
- **Gate:** no horizontal overflow on core mobile screens; nothing depends on hover alone; fallbacks usable; build/typecheck pass or documented.
- **If behind:** cut or simplify heavy 3D/motion; keep a polished 2D experience.

### Phase 5 — Demo preparation · branch `ui-b-p5`
- B-5.1 Verify the integrated app on the deploy/local preview. Do not touch deployment secrets/settings.
- B-5.2 Screenshots: landing, dashboard, detail + Why panel, active queue, suppressed lane, recipient gate, evidence/audit.
- B-5.3 Screenshots must match the real tested build and clearly separate mock from engine data.
- B-5.4 Rehearse: dashboard → overdue commitment → evidence/status → review draft → recipient/freshness gate → suppression of completed work.
- B-5.5 Route-by-route walkthrough + known UI limitations for the demo owner.
- **Gate:** screenshots match build; journey repeatable; nothing suggests a message was sent.

### Phase 6 — Final release check · branch `ui-b-p6`
- B-6.1 Final build/typecheck on the **merged** branch, not just yours.
- B-6.2 Click through nav, shell, dashboard, detail, queue, suppression, recipient review, evidence, audit once more.
- B-6.3 Every displayed metric comes from engine/evidence or is labelled as demo.
- B-6.4 Confirm **no commit in any `ui-b-*` branch has a Claude co-author line**: `git log --format='%H %an %ae%n%b' | grep -i -E "claude|anthropic|co-authored"` must return nothing.
- B-6.5 Hand off final screenshots, route list, known limitations, tested demo sequence.

## 7. After every phase — report to me
Update `docs/track-b-status.md`, commit it, push, then reply with:
1. Phase status: DONE / PARTIAL / BLOCKED
2. Branch name, push status, and commit list (`git log --oneline <prev-branch>..HEAD`)
3. Files changed
4. Exact typecheck/build/test commands run and their real output
5. Acceptance gate — each item ticked or explained
6. What you need from Track A (types, hooks, actions) — exact names
7. Blockers and the next smallest task

Never say "complete" just because files were written — only when the gate is actually met.

Reply now with only: "track b ready, waiting for phase" — do not run anything yet.

---

## Phase kickoff message (send this each time)

```
start phase N for track b
create branch ui-b-pN from ui-b-p(N-1) following the git rules
lowercase short commits with no symbols and no claude co-author
stop and report when the phase gate is met
```
(For phase 0: "create branch ui-b-p0 from the verified base branch".)
(For phase 1 once Track A is ready, add: "track a contract is on back-a-p1 at commit <hash>, bring in src/engine/types.ts".)
