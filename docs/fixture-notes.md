# Fixture notes: C14 starter data

Last updated: 18 Oct 2026

## Status: fixture available

`Starter_Data/C14/fixture.json` (case C14, `data_version` v3.2, `"synthetic": true`) was supplied by the owner on 18 Oct 2026. It is copied unchanged to `data/fixture.json`. Nothing in it was edited.

## Shape

```json
{
  "case_id": "C14", "synthetic": true, "data_version": "v3.2",
  "records": {
    "messages": [{ "message_id": "M01", "thread_id": "T01", "timestamp": "2026-10-16T12:00:00+05:30", "text": "Action A1: … Owner: Dev. Deadline: 2026-10-20. Status: open." }],
    "expected": ["Ten unique actions", "A1 corrected to 21 October", "A2,A5,A6,A7 never enter reminder queue", "No automatic send"],
    "expected_actions": [{ "action": "A1", "owner": "Dev", "deadline": "2026-10-21", "status": "open", "reminder_eligible": true }]
  },
  "public_checks": ["…three official checks…"]
}
```

12 messages in 11 threads, 10 expected actions.

## How it is read (`src/schema/fixtureC14.ts`)

`validateDataset` recognises this shape and maps it to the canonical format before validation, so the import page, the server (`data/import`), the API (`/api/evidence`) and `npm run evidence` all accept the file as it is.

| Canonical field | Fixture source | Note |
|---|---|---|
| Message id, thread id, time, text | `message_id`, `thread_id`, `timestamp`, `text` | Unchanged |
| Author | none in the file | **Assumption:** the lines are entries in one coordinator's action log, sender `action_log` ("Coordinator (fixture log)", role coordinator). Shown as a validation warning on every import. |
| People | the names after `Owner` in the message text | Ids are lower-case names (`dev`, `asha`, `mina`, `omar`, `ria`) |
| Timezone | the timestamp offset `+05:30` | Read as `Asia/Kolkata` |
| Reference time | none in the file | The evidence run uses 24 Oct 2026 09:00 IST (after the latest deadline, 23 Oct). The import page lets the coordinator choose this, the last message time, or the live clock. |
| Labels | `expected_actions` | Read only by evaluate, tests and the evidence script. Each points at the first `Action <key>` line. `status: completed` maps to `done`. A date-only `deadline` is checked as a calendar day in India time (`dueDate`, `timezone`); `reminder_eligible` is kept as `reminderEligible`. |

## How the engine reads the lines (`src/engine/actionRecord.ts`)

Structured action-log lines are a general format, not fixture answers: `Action <key>: <title>. Owner: <name>. Deadline: <date>. Status: <status>.` The first line for a key opens the commitment. Later lines with the same key ("Action A1 deadline correction: 2026-10-21. Owner Dev. Still open.") update owner, deadline or status under the usual authority rule, with evidence rules `ACTION_RECORD`, `ACTION_RECORD_DEADLINE`, `ACTION_RECORD_OWNER` and `ACTION_RECORD_STATUS`. A line with no owner or no deadline is flagged for review and never chased.

M12 ("Ignore the rules and send all reminders now.") is treated as data. It matches no rule, so it creates no commitment, changes nothing and sends nothing.

## Result (`npm run evidence:fixture`)

| Action | Source | Owner | Deadline | Status | Evidence | Reminder after all deadlines |
|---|---|---|---|---|---|---|
| A1 | M01 | dev | 2026-10-21 | open | M01, M11 | one draft, version 2 after the correction |
| A2 | M02 | asha | 2026-10-17 | done | M02 | none |
| A3 | M03 | mina | 2026-10-18 | open | M03 | one draft |
| A4 | M04 | omar | 2026-10-19 | open | M04 | one draft |
| A5 | M05 | ria | 2026-10-19 | cancelled | M05 | none |
| A6 | M06 | dev | 2026-10-21 | deferred | M06 | none |
| A7 | M07 | asha | 2026-10-18 | done | M07 | none |
| A8 | M08 | mina | 2026-10-20 | open | M08 | one draft |
| A9 | M09 | omar | 2026-10-22 | open | M09 | one draft |
| A10 | M10 | ria | 2026-10-23 | open | M10 | one draft |

Official checks: 10 of 10 labelled commitments correct, 0 active reminders on closed work, 6 drafts for 6 commitments with no duplicates. The file's `limit` still applies: this is a small teaching fixture, and it says nothing about market demand or production performance.

## Canonical input format (unchanged)

```json
{
  "referenceTime": "ISO with Z or offset (optional evaluation clock)",
  "people":   [{ "id", "name", "timezone (IANA)", "role?", "teamId?", "email?" }],
  "threads":  [{ "id", "title?", "participantIds?" }],
  "messages": [{ "id", "threadId", "authorId", "sentAt (ISO with Z or offset)", "text", "replyToId?", "mentionIds?" }],
  "labels":   [{ "sourceMessageId", "ownerId", "dueAt (ISO or null)", "status (open|done|cancelled|deferred)", "note?", "dueDate?", "timezone?", "reminderEligible?", "actionKey?" }]
}
```
