# Final evidence (after the product change) — SYNTHETIC DATA

Same data and same simulation as `evidence/starting_state/`, with stale-message
suppression and recipient review **on** (the app default). Synthetic demo data,
not the C14 challenge fixture; re-run with the fixture when it arrives.

Command:

```
npm run evidence -- --demo --label final --flags on --simulate-later 2026-10-16T14:00:00Z
```

## Before and after

| | Starting state (flags off) | Final (flags on) |
|---|---|---|
| Drafts written at the cutoff | 2 | 2 |
| Outdated after later messages | 1 (`d_c_m_03`) | 1 (`d_c_m_03`) |
| Outdated but still approvable | **1** | **0** |
| `d_c_m_03` state at the evaluation clock | `pending_review` v1 | `suppressed` v1, reason `completed`, evidence `m_10` |
| Active reminders on closed work (check 2) | 1 — FAIL | 0 — PASS |
| One draft per commitment (check 3) | PASS (4 drafts) | PASS (4 drafts) |
| Approval needs a confirmed recipient | No | Yes |
| Test suite | 200 passed | 200 passed |

The suppression carries the evidence message (`suppressions.csv`:
`d_c_m_03, completed, m_10`), and the queue shows the reason on the card.
Owner/deadline/status accuracy is not scored here (no labels).

Files as in the starting state, with SHA-256 hashes in `manifest.json`.
