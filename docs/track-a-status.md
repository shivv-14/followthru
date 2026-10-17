# Track A status — core engine and backend

Last updated: 17 Oct 2026, Phase 0 (branch `back-a-p0`)

## Current phase

| Phase | Branch | State |
|---|---|---|
| 0 Kickoff and baseline | `back-a-p0` | Done (docs only, no engine code) |
| 1 Contract, validation, deadlines | `back-a-p1` | Not started |
| 2 to 6 | `back-a-p2` … `back-a-p6` | Not started |

Branch naming follows the team instruction (`back-a-pN`). The Track A plan document mentions a single branch `track-a-engine-backend`, but that name is not used here.

## A-0.1 Repository baseline

### GitHub repo `shivv-14/followthru`
- Default branch is **`main`**. It was checked with `git remote show origin`, not assumed.
- `main` holds one commit, `f07fbcd Initial commit`, with only `README.md` (`# followthru`).
- Phase 0 started from `main`. Nothing on `main` was changed.
- Local working folder: `D:\followthru`, initialised against `origin`.
- Commit identity: `shivv-14 <shivaganesh1430@gmail.com>` (the existing global git config, left unchanged).

### Earlier local scaffold (not on GitHub)
An earlier setup exists at `C:\Users\shiva\projects\followthru`. Its history:

```
a79fa6f add project notes
fa62214 add test setup
7924279 add project folders
389a97a add vite react setup
4c92e4b Initial commit
```

- The root commit `4c92e4b` is **not** an ancestor of the current GitHub `main` (`f07fbcd`). That folder's `origin/main` ref still points at `a79fa6f`. So the scaffold was pushed once, and then the GitHub repo was recreated. **The scaffold is no longer on GitHub.**
- That folder has five untracked planning files: the prompt playbook PDF, the prompts copy-paste file, the blueprint, the roadmap and the C14 brief docx. They were left untouched.
- Nothing in that folder was modified. Phase 0 only read files there and ran its scripts.

What the scaffold contains:

| Area | Contents | Reusable? |
|---|---|---|
| `package.json` | React 18.3, Vite 8, TypeScript 5.9, Zod 4, Dexie 4 + dexie-react-hooks, date-fns 4 + date-fns-tz 3, PapaParse, Zustand, Tailwind 4, Framer Motion, Lenis, three / r3f / drei, vite-plugin-pwa 2, Vitest 5, Testing Library, jsdom, `@vercel/node`, tsx | Yes. Matches the planned stack |
| Scripts | `dev`, `build` (`tsc -b && vite build`), `preview`, `test` (`vitest run`), `test:watch`, `typecheck` | Yes |
| `vitest.config.ts` | Two projects: `engine` (node, `tests/**/*.test.ts`) and `ui` (jsdom, `tests/**/*.test.tsx`) | Yes |
| `src/` | Empty barrels: `engine`, `schema`, `lib`, `state`, `store`, `pages`, `components`, `three`; plus `App.tsx`, `main.tsx`, `styles/global.css` | Folder layout only, no logic |
| `api/`, `data/`, `scripts/`, `evidence/`, `docs/` | `.gitkeep` only | Placeholders |
| `tests/` | `sanity.test.ts`, `app.test.tsx`, `setup.ts` | Yes |
| Project rules file | Golden engine rules, scoring, design language, git rules | Yes. Consistent with the Track A rules |

Missing from the scaffold compared with the planned stack: **`fake-indexeddb`** (needed for Dexie tests) and **Playwright**. Neither is installed.

## A-0.5 Scripts check

The GitHub repo has **no `package.json`**, so there are no scripts to run in `D:\followthru` yet.

The earlier scaffold's scripts were run in place on 17 Oct 2026 (Node 24.19.0, npm 11.17.0):

| Command | Result |
|---|---|
| `npm test` | 2 files, 2 tests passed (engine + ui projects) |
| `npm run typecheck` | Clean, no errors |
| `npm run build` | Passed. JS 140.9 kB (45.8 kB gzip), CSS 7.9 kB |

## A-0.2 Brief, deadline and scoring

Source: `problem statment & solution C14 Automated Chaser Draft Queue (1).docx`. It is not in the repo. Copies exist in the earlier scaffold folder and in Downloads, and both copies are identical.

Official scoring (the only official scoring in the brief), engineering outcome checks, 25 points:
- **10 points**: correct owner, deadline and status for the **ten labelled commitments**, with evidence.
- **10 points**: zero reminders for completed, cancelled or deferred actions in the challenge set.
- **5 points**: one action creates one draft. A later deadline update changes the queue without duplicate reminders.

Required edge cases from the brief: "Maybe Friday" (tentative), timezone, delegated owner, completion in another thread, and no response versus not completed. The brief also says silence must never change status.

Product change to negotiate: stale-message suppression and recipient review. Save the starting state, the negotiated scope and the final evidence.

| Item | Status |
|---|---|
| Official submission deadline | **Unknown.** Not stated in the brief. The team target of 08:00 IST 18 Oct 2026 is a team goal, **not** an official deadline. Confirm with the organisers |
| Demo format and length | **Unknown.** Not stated in the brief |
| Evaluation clock ("now") for overdue checks | **Unknown** until the fixture is inspected |
| Where the labels live in the fixture | **Unknown** until the fixture is inspected |

## Risks and blockers

| # | Risk | Impact | Proposed action |
|---|---|---|---|
| R1 | **Fixture `Starter_Data/C14/fixture.json` is not on this machine or in the repo** | Blocks all scored engine work (A-0.3 and A-0.4 cannot be verified) | **Need the file from the organisers or the team.** Place it at `data/fixture.json` |
| R2 | The scaffold exists only locally and is not on GitHub `main` | Track B may scaffold separately and conflict with it | Decide who brings the scaffold onto a branch (needs owner approval: `src/pages`, `src/components`, `src/three` and `src/styles` are Track B folders) |
| R3 | Official deadline and demo format unknown | Planning risk | Confirm with the organisers |
| R4 | `fake-indexeddb` and Playwright are missing | Storage and e2e tests cannot run yet | Add them in the phase that needs them |
| R5 | The planning docs in `D:\followthru\docs` (docx files and the prompt file) are untracked | Not committed on purpose | Owner decides whether they belong in the repo |

## Phase 0 re-check (17 Oct 2026, later the same day)

- **Fixture still missing.** A full search of `C:` and `D:` for `fixture*.json`, `Starter_Data` and `*C14*.json` found nothing. Only the C14 brief docx turned up (three identical copies). Risk R1 stays open. No placeholder fixture was created, because labels must come from the supplied file.
- Added `data/README.md` to mark the expected location `data/fixture.json`. It contains no data.
- `main` has moved. PR #2 (`ui-b-p0`) was merged, so `main` now holds `README.md` and `docs/track-b-status.md`. PR #1 (`back-a-p0` → `main`) is open and merges cleanly. The Track A docs appear on `main` only after PR #1 is merged.
- Track B runs on a **separate laptop** (identity `zohaib`). So the earlier scaffold at `C:\Users\shiva\projects\followthru` is invisible to Track B unless it is pushed to a branch.

## Replies to Track B requests (from `docs/track-b-status.md` on `main`)

| Track B request | Track A answer |
|---|---|
| `src/engine/types.ts` with a commit hash | Planned for the end of Track A Phase 1 (`back-a-p1`). The branch and hash will be recorded here when published |
| Scaffold decision: push the old local scaffold, or Track B scaffolds fresh | **Waiting on the owner's decision (R2).** Track A will not push it without approval, because it includes Track B folders |
| `data/fixture.json` | Not available to either track yet (R1). Owner to obtain it from the organisers |

## Dependencies on Track B
- None yet. Track B should import domain types only from `src/engine/types.ts` once it is published at the end of Phase 1.

## Contract changes log
- None. The contract is not published yet.
