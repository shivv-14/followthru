# Gmail-to-ticket automation

Email arrives → FollowThru fetches it → the AI (or the labelled rules fallback) reads it → tickets are created or updated → anything uncertain waits for a coordinator.

## What runs where

| Step | Code | Notes |
|---|---|---|
| Connect Gmail (Google OAuth 2.0) | `api/_lib/cloud/routes/automation.ts` (`gmail/connect`, `gmail/callback`, `gmail/disconnect`) | Read-only scope `gmail.readonly`. Signed, expiring state. Tokens stored encrypted (AES-256-GCM) in `gmail_accounts`; no signed-in role can read that table. Disconnect revokes and deletes the tokens. |
| Fetch mail | `api/_lib/cloud/automation.ts` `syncAccount`, `api/_lib/cloud/gmail.ts` | First run: the last N days (1 to 90). Then Gmail history (only new messages); falls back to a dated listing when the history id expires. Retries 429/5xx with backoff; a revoked grant marks the account and asks to reconnect. Each message is stored once (`inbound_emails`, unique Gmail message id). |
| When | Every 2 minutes by a Supabase pg_cron job that calls `/api/cloud/cron/gmail` with `Authorization: Bearer <CRON_SECRET>` (runs with nobody signed in); also every 2 minutes while a coordinator has the app open, **Sync now**, and Vercel Cron daily | The pg_cron SQL holds the secret, so it is kept outside the repository. Gmail push (Pub/Sub) is not set up. |
| Clean the text | `src/automation/emailText.ts` | Newest reply only: quoted history, forwarded blocks and signatures removed. Bulk and automated mail detected from headers and sender. |
| Read the email | `api/_lib/cloud/ai.ts` | `AI_PROVIDER=anthropic` or `gemini` with a key: structured output against `src/automation/schema.ts`, validated with Zod; invalid output is rejected. No key: `src/automation/rules.ts` reads it and every result is labelled "rules". Email text is treated as untrusted data. |
| Decide | `src/automation/plan.ts` | Pure and tested. Owner by email address, then a unique name, then the only team-member recipient; otherwise review. Deadline wording is resolved in the sender's timezone; tentative or unreadable wording never becomes a date. Replies match tickets by Gmail thread first, then wording among the sender's own tickets; no clear match goes to review. Status changes follow FollowThru's rules: the owner's "done" becomes a submission for coordinator approval; "can we move the deadline" becomes an extension request; only a coordinator or the requester can cancel. Below `AI_MIN_CONFIDENCE` (default 0.6) nothing is applied automatically. |
| Apply | `api/_lib/cloud/automation.ts` `processEmail` | Claims the row first (no double processing). Tickets are ordinary FollowThru tasks with `tasks.origin` (Gmail message, thread, mode, confidence, why this owner and deadline). Ticket ids come from the Gmail message id, so a repeated delivery creates nothing. Updates go through the same decision code as the app (`decideAs`). Every step writes `automation_events`; tickets and decisions are in `audit_log`. Failures retry with backoff (2, 4, 8 … 60 minutes, 5 tries) and are never dropped. |
| Show | `src/pages/Automation.tsx` (`/automation`, coordinators) | Gmail status, last sync, counts, review list (create a ticket with a chosen owner, process again, dismiss with a reason), activity feed, recent emails with Gmail links, meeting minutes (decisions, open questions). Ticket pages show the email evidence. |

## Setup

### 1. Database
Run `supabase/migrations/20261018000006_gmail_automation.sql` in the Supabase SQL editor (done on 18 Oct 2026).

### 2. Google Cloud (needs your Google account)
1. https://console.cloud.google.com → create a project (for example "FollowThru").
2. APIs & Services → Library → enable **Gmail API**.
3. APIs & Services → OAuth consent screen → External → app name FollowThru, your email as support and developer contact. Scopes: add `.../auth/gmail.readonly`. Test users: add every Gmail address that will connect (for example brungishivaganesh@gmail.com, shivaganesh1430@gmail.com). While the app is in "Testing", only test users can connect, and Google shows an "unverified app" screen; click Continue.
4. APIs & Services → Credentials → Create credentials → OAuth client ID → Web application. Authorized redirect URIs:
   - `https://followthru-ruby.vercel.app/api/cloud/gmail/callback`
   - `http://localhost:5173/api/cloud/gmail/callback`
5. Copy the client ID and client secret.

### 3. Server settings
In Vercel → Project → Settings → Environment Variables (Production), and in `.env.local` for local runs:

| Name | Value |
|---|---|
| `GOOGLE_CLIENT_ID` | from step 2 |
| `GOOGLE_CLIENT_SECRET` | from step 2 |
| `GOOGLE_REDIRECT_URI` | `https://followthru-ruby.vercel.app/api/cloud/gmail/callback` (local: `http://localhost:5173/api/cloud/gmail/callback`) — already set |
| `TOKEN_ENCRYPTION_KEY` | 32 random bytes, base64 — already set |
| `CRON_SECRET` | random string — already set |
| `AI_PROVIDER` | `anthropic` or `gemini` (optional; without it the rules read emails) |
| `ANTHROPIC_API_KEY` or `GEMINI_API_KEY` | the provider key |
| `AI_MODEL` | optional; defaults `claude-haiku-5-5` / `gemini-3.5-flash-lite` |
| `AI_MIN_CONFIDENCE` | optional; default `0.6` |

Redeploy after changing variables (`npx vercel deploy --prod`).

### 4. Connect
Sign in as a coordinator → **Email automation** → choose how many days to read → **Connect Gmail** → pick the account → allow read-only access. New mail is processed within about two minutes while the app is open.

## Testing

- Automated (mocked Gmail and AI): `npm test` → `tests/automation.test.ts`, `tests/db/rls.test.ts`.
- Live without Gmail: Automation → **Try it with a test email** runs the same pipeline; rows are stored with source `test` and labelled.
- Live end to end against Supabase: `npm run cloud:smoke` (section 17).
- Real Gmail: only after steps 2–4. Send an email to the connected address, wait two minutes or press **Sync now**, and check the activity feed. Passing mocked tests does not prove the live Gmail connection.
