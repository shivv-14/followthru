# Sample files for testing the import screen

All files here are **synthetic**, written to exercise FollowThru. None of them is
the C14 challenge fixture, and their labels are not challenge results.

Open the app (`npm run dev`, then http://localhost:5173 → Open app) and use
**Import a JSON dataset or a messages CSV** on the Setup screen.

| File | What to expect |
|---|---|
| `01-valid-dataset-SYNTHETIC.json` | Loads with 0 issues. 5 people in 4 timezones, 16 messages, 7 hand-written labels. Shows: completion in another thread (s03), an explicit "10am ET" deadline, "maybe Friday", a numeric date (22/10) with delegation from Sofia to Ravi, "next week", a cancellation and a deferral. The Evidence scorecard shows 7 of 7, 0 wrong reminders, no duplicates. |
| `02-messages-SYNTHETIC.csv` | Load **after** file 01: a messages CSV uses the people already loaded. Shows one warning (a message in an unknown thread `t_newthread`) and a cell starting with "=" that is escaped in CSV exports. |
| `03-broken-dataset.json` | Blocked: missing fields and an invalid label status. The validation table lists each problem with its path. |
| `04-broken-messages.csv` | Blocked: the CSV is missing the threadId, authorId and sentAt columns. |
| `05-not-json.json` | Blocked: "File is not valid JSON". |

Evaluation clock for file 01: Fri 23 Oct 2026, 10:00 IST (its `referenceTime`).
