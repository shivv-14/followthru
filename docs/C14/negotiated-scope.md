# Negotiated scope

Agreed 2026-10-18 from the change request. Rule: keep everything that already works; change only what was asked.

| Item | Decision |
|---|---|
| Single workspace creation flow | One "Create a workspace" entry on the sign-in page; sign-up no longer asks for a role. |
| Combined Coordinator / Team Lead | One role, stored as `coordinator`, shown as "Coordinator / Team Lead". Existing `team_lead` support stays in the database for compatibility but is no longer offered. |
| Team login and join requests | "Join as a team member" sign-up creates an account with no workspace. The Workspaces page lists workspaces with Request to join / Request pending / Open workspace / Ask again. Coordinators approve or reject (reason required); both sides are notified and audited. One workspace per account at a time. |
| Team member accounts by coordinators | First password = normalised username + `1` (pilot only), shown once, never stored, must be changed at first sign-in. Usernames need 5+ characters so the password meets Supabase's minimum. Password resets keep using strong random passwords. Before real customer data: use invitations or reset links. |
| Task assignment | Start Date & Time, End Date & Time (the deadline the engine checks), description, priority; end before start is refused in the browser and on the server. Start is stored in `tasks.start_at`; conversation deadlines are never overwritten. |
| Dates and timezones | Unchanged model: `timestamptz` in UTC, phrases read in the speaker's timezone, display in the viewer's timezone. |
| Audit log for members | Members see events they caused, events about them, and events on tasks they can read. Append-only for everyone. |
| Queue | Button reads "Approve". Delivery stays in-app only. Owner and deadline filters added. |
| Files | Users upload CSV and PDF. JSON stays internal (official fixture, demo button). PDF: text lines `time | thread | name | timezone | message` or WhatsApp exports; scanned PDFs are refused with a clear message. |
| Stale suppression after approval | If an approved reminder is still held for quiet hours and the task closes, the held notification is cancelled. |
| Reminder configuration | Existing Flows page (timing, tones, recipients, weekends) plus Evidence → Data & settings (stale suppression, recipient review, stale window, quiet hours). No new sending integration: nothing is emailed or texted. |
| Ten-commitment validation | Blocked until the official fixture is provided. Supplemental synthetic tests cover the edge cases. |
| Growth experiment | Ten persistent rows, all pending until real results are entered. |
