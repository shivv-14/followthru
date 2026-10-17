# Starting state (before the product change) — SYNTHETIC DATA

This folder records how FollowThru behaves **without** the negotiated product
change. It uses the synthetic demo conversations in `src/mocks/demoDataset.json`,
not the C14 challenge fixture (not yet available), so it shows behaviour, not
challenge accuracy. Re-run it with the fixture when it arrives.

Command:

```
npm run evidence -- --demo --label starting-state --flags off --simulate-later 2026-10-16T14:00:00Z
```

`--flags off` turns off stale-message suppression and recipient review.
`--simulate-later` writes drafts with the messages known at 16 Oct 14:00 UTC,
then replays the later messages up to the evaluation clock (19 Oct 05:30 UTC)
with those drafts already in the queue.

## What happened

- Drafts at the cutoff: 2 (`d_c_m_03` pricing deck for Ben, `d_c_m_21` press kit for Lena).
- Drafts at the evaluation clock: 4 (`d_c_m_03`, `d_c_m_05`, `d_c_m_18`, `d_c_m_21`).
- **Outdated draft: 1.** Ben reported the pricing deck as sent in another thread
  (`m_10`, 16 Oct 16:00 UTC) after the reminder was written. Without stale
  suppression the draft stays `pending_review` (see `stale-report.md`), and the
  approval check does not re-check freshness, so it **could be approved and sent
  wrongly**.
- Scorecard: `zero_wrong_reminders` **FAIL** (1 active reminder on closed work,
  `c_m_03`). `one_action_one_draft` PASS. Owner/deadline/status is not scored
  (no labels in synthetic data).
- Recipients are not reviewed: approval does not require a confirmed recipient.

Files: `scorecard.md`, `stale-report.md`, `drafts.csv`, `suppressions.csv`,
`commitments.csv`, `results.json`, `validation.json`, `test-report.txt`,
`manifest.json` (SHA-256 of every file, git commit, flags).
