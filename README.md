# FollowThru

**Chase what's late. Never what's done.** An automated chaser draft queue for project coordinators (Fynd × NMIMS Hyderabad, challenge C14).

FollowThru reads team conversations and finds commitments. It replays the whole history of each one so owner, deadline and status stay correct, and drafts exactly one reminder per genuinely overdue commitment. A coordinator reviews every draft and its recipient. **Shadow mode only: nothing is ever sent.**

## Run it

```bash
npm install
npm run dev
```

Open http://localhost:5173. Choose **Open app**, load data, then pick a profile: a coordinator (for example Priya) or a member. `npm run dev` also serves the API at `/api/health` and `/api/process`.

| Command | What it does |
|---|---|
| `npm run dev` | App and API on port 5173 |
| `npm test` | Unit, store, API and component tests (Vitest) |
| `npm run typecheck` | TypeScript strict check |
| `npm run build` | Production build with an offline PWA, output in `dist/` |
| `npm run e2e` | Browser tests in the installed Chrome (`PW_CHANNEL=msedge` for Edge) |
| `npm run evidence` | Scorecard, CSV/JSON results and SHA-256 manifest in `evidence/` |

## Data

- **Challenge fixture:** copy `Starter_Data/C14/fixture.json` to `data/fixture.json`. Setup then offers *Load the C14 challenge fixture*, and `npm run evidence` scores it. **The fixture is not in this repository yet.**
- **Import:** any JSON dataset in the format in `docs/fixture-notes.md`, or a messages CSV added to the people already loaded.
- **Demo:** synthetic conversations in `src/mocks/demoDataset.json` cover every edge case in the brief. They have no labels and are never scored. The demo is offered in dev, or in a build with `VITE_DEMO_MODE=true`.

## How it works

| Layer | Where | Notes |
|---|---|---|
| Engine (pure, deterministic) | `src/engine/` | Signals → commitments → cross-thread linking → history replay → draft queue → approval checks → scoring. The clock is always passed in. |
| Shared contract | `src/engine/types.ts` | The single source for domain types, used by UI, store, API and scripts |
| Validation and I/O | `src/schema/` | Zod schemas, stable issue codes, CSV/JSON with formula-injection escaping |
| Store | `src/store/` | Dexie (IndexedDB) repositories, an audited action layer with role checks, and the `EngineProvider` hook |
| UI | `src/pages/`, `src/components/` | Dashboard, commitments, detail ("Why?" evidence timeline), queue, flows, team, evidence |
| API | `api/` | Vercel functions `GET /api/health`, `POST /api/process` |

Rules the engine enforces:
- Silence never changes status.
- Only the owner, the requester or a coordinator can close work.
- Weak or ambiguous evidence goes to review, and nothing is chased while it is unresolved.
- Deadlines are read in the speaker's timezone and stored in UTC.
- One draft per commitment. Updates bump its version.
- Done, cancelled and deferred work keeps zero active drafts.
- Approval re-checks freshness and requires a confirmed recipient.

Status and remaining work: `docs/integration-status.md`.
