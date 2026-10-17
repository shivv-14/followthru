# Fixture notes — C14 starter data

Last updated: 17 Oct 2026, Phase 0

## Status: fixture not available

The brief names the input as `Starter_Data/C14/fixture.json`. A search on 17 Oct 2026 found no such file:
- not in the GitHub repo;
- not in the earlier scaffold's `data/` folder, which has only `.gitkeep`;
- not in Downloads, Desktop, Documents, OneDrive, `C:\Users\shiva\projects` or `D:\`.

**Nothing below is verified against real data.** Every row is marked as either *from brief* (stated in the C14 brief) or *expected* (a planning assumption to check). No labels, ids or answers are invented here. Once the file arrives it goes at `data/fixture.json` and this document gets rewritten from the real contents.

## What the brief says the fixture contains (from brief)

> Message IDs, thread IDs, timestamps/timezone, owners, commitments, due dates and later changes/completions.

- Ten labelled commitments are scored for owner, deadline and status.
- A challenge set includes completed, cancelled and deferred actions.
- At least one deadline update exists, which the one-draft rule depends on.

## Field mapping

Fill in the real fixture path for each field once the file is available.

| Domain field | Expected source in fixture | Real path | Verified |
|---|---|---|---|
| Message id | message id | TBD | No |
| Thread id | thread id | TBD | No |
| Author / speaker | author or sender | TBD | No |
| Timestamp | timestamp with offset or timezone | TBD | No |
| Speaker timezone | per-person or per-message timezone | TBD | No |
| Message text | text or body | TBD | No |
| Reply / reference link | reply-to or reference id | TBD | No |
| People / participants | people list or inferred from messages | TBD | No |
| Labelled owner | label block (location unknown) | TBD | No |
| Labelled deadline | label block | TBD | No |
| Labelled status | label block | TBD | No |
| Evaluation clock ("now") | reference time, or latest message time | TBD | No |

## Labelled commitments

| # | Commitment | Source message id | Owner | Deadline | Status | Evidence ids |
|---|---|---|---|---|---|---|
| 1 to 10 | TBD from fixture | | | | | |

## Questions to answer during inspection
1. Where do the labels live: inline per message, in a separate `labels` or `expected` block, or in a separate file?
2. What status values exist (for example open, done, cancelled, deferred), and what exact spelling?
3. Is the timezone stored per person, per message, as an offset in the timestamp, or a mix?
4. Is there an explicit reference time for judging overdue?
5. How are threads linked: explicit reply ids, shared references, or only by topic?
6. Are deadlines given as phrases only ("Friday 6pm"), or also as normalised dates?

## Edge-case catalogue (from brief; message ids TBD)

| Case | What the engine must do | Fixture message ids |
|---|---|---|
| "Maybe Friday" | Mark the deadline tentative, not firm. Do not chase as overdue; route to clarify and review | TBD |
| Timezone | Read relative phrases in the speaker's timezone and store UTC. Test IST vs Pacific and DST | TBD |
| Delegated owner | Owner moves to the delegate only on accepted delegation; keep the history | TBD |
| Completion in another thread | Link it back to the original commitment and suppress the reminder | TBD |
| No response vs not completed | Silence keeps status unchanged; responseState stays `pending` | TBD |
| Deadline change | Same draft, version + 1, old deadline kept in events | TBD |
| Cancelled | Zero active drafts | TBD |
| Deferred | Zero active drafts | TBD |
| Stale draft | Re-check before approval and suppress with a visible reason | TBD |
| Recipient changed | Block approval until the recipient is confirmed | TBD |

## Malformed-input cases to test (expected, planning)

Validation should report these as issue codes and must not crash:
- **Errors:** duplicate message id; missing message id, thread id, author or timestamp; unparsable timestamp; unknown IANA timezone; manual task without an owner; due date before creation.
- **Warnings:** unknown author or mention; message references a missing thread; empty text; due date less than 2 h away.
- **Structural:** wrong top-level type; extra unknown fields (allowed but noted); file larger than 2 MB at the API.

Issue codes and exact paths get fixed in Phase 1 once the real shape is known.
