# Slack integration

Status: **implemented, awaiting credentials; mocked tests only.** No Slack app exists for FollowThru yet, so the connection has never run against real Slack. Until the three `SLACK_*` variables are set, `slack/connect` answers `503 slack_not_configured` and the Automation page says "Slack is not configured on the server yet". Passing the mocked tests does not prove the live connection.

Slack messages in chosen channels → stored as ordinary `messages` rows → the same rule engine that reads team chat finds commitments, owners and deadlines. FollowThru never posts to Slack.

## What runs where

| Step | Code | Notes |
|---|---|---|
| Connect (OAuth v2) | `api/_lib/cloud/routes/slack.ts` (`slack/connect`, `slack/callback`) | Coordinators only. Signed, expiring state that only a Slack connect can produce (a Gmail state is rejected). The bot token is encrypted (AES-256-GCM, `TOKEN_ENCRYPTION_KEY`) in `slack_workspaces`; no signed-in role can read that table. Visible channels are listed into `slack_channels` with `enabled = false`. |
| Choose channels | `slack/channel-toggle` | Nothing is imported until a coordinator enables a channel. Audited. |
| Import | `api/_lib/cloud/slackSync.ts` `syncSlack`, `api/_lib/cloud/slack.ts` | For each enabled channel: `conversations.history` after the stored `cursor_ts` (first run: last 14 days), plus `conversations.replies` for threads started in that window. Retries 429 (honouring `Retry-After`, capped at 30 s) and 5xx with backoff, bounded. `token_revoked`, `invalid_auth`, `account_inactive` mark the workspace revoked. |
| People | `slack_users` | Each Slack author is looked up once with `users.info`: matched to an existing person by email, otherwise a new person `slack_<user id>` (name, email and timezone from Slack). |
| Parse | `api/_lib/cloud/slackMessage.ts` `slackToMessage` (pure, tested) | Id `slack_<channel>_<ts>`; thread `slack-<channel>`, replies in `slack-<channel>-<thread_ts>` linked to the parent. `<@U123>` becomes the person's name, link and channel markup is cleaned, entities decoded. Bot messages and system subtypes (joins, topic changes, edits) are skipped. Text is untrusted data and is only cleaned. |
| Store | `messageOps` | Upserts that ignore rows already stored (unique `org_id, external_id`), so a repeated sync adds nothing. Then one engine run (`syncOrg`) if anything was new. |
| When | `tick()` in `api/_lib/cloud/automation.ts` (every two minutes while a coordinator has the app open, and the daily cron) and **Sync now** (`slack/sync`) | A Slack failure is caught and reported; it never stops the Gmail round. |
| Disconnect | `slack/disconnect` | `auth.revoke` (best effort), then the token row and its channel list are deleted. Imported messages and tasks are kept. |
| Show | `src/components/domain/SlackCard.tsx` on `/automation` | Not-configured notice, connected workspace, channel toggles, last sync, errors, Sync now, Disconnect. `automation/overview` returns `slack: { configured, workspaces, channels }` without token columns. |

The activity feed (`automation_events`) gets `slack_connected`, `slack_channel_enabled`, `slack_message_detected` (counts only), `slack_error` (error codes only) and `slack_disconnected`. Tokens and message text are never logged.

Known limits: replies added later to a thread whose parent is older than the cursor are not imported; the first run reads at most 10 pages of 200 messages per channel; a public channel must have the app invited (`/invite @FollowThru`), because the minimal scopes do not include `channels:join`.

## Setup

### 1. Database
Run `supabase/migrations/20261018000008_slack.sql` in the Supabase SQL editor (not run yet). It adds `slack_workspaces`, `slack_channels`, `slack_users` with row level security and extends `apply_ops`.

### 2. Slack app (needs a Slack workspace admin)
1. https://api.slack.com/apps → **Create New App** → **From scratch** → name FollowThru, pick the workspace.
2. **OAuth & Permissions** → **Bot Token Scopes** → add exactly:
   `channels:read`, `channels:history`, `groups:read`, `groups:history`, `users:read`, `users:read.email`
3. **OAuth & Permissions** → **Redirect URLs** → add both and save:
   - `https://followthru-ruby.vercel.app/api/cloud/slack/callback`
   - `http://localhost:5173/api/cloud/slack/callback`
4. **Basic Information** → **App Credentials** → copy the Client ID and Client Secret.
5. To install for other workspaces later, enable **Manage Distribution**; for a single workspace this is not needed.

### 3. Server settings
In Vercel → Project → Settings → Environment Variables (Production), and in `.env.local` for local runs:

| Name | Value |
|---|---|
| `SLACK_CLIENT_ID` | from step 2.4 |
| `SLACK_CLIENT_SECRET` | from step 2.4 |
| `SLACK_REDIRECT_URI` | `https://followthru-ruby.vercel.app/api/cloud/slack/callback` (local: `http://localhost:5173/api/cloud/slack/callback`) |
| `TOKEN_ENCRYPTION_KEY` | already set for Gmail; the same key encrypts the Slack token |

Redeploy after changing variables.

### 4. Connect
Sign in as a coordinator → **Email automation** → Slack card → **Connect Slack** → allow → back on the page, invite the app to the channels you want (`/invite @FollowThru` in Slack), tick them, then **Sync now**.

## Testing

- Automated (mocked fetch): `npx vitest run tests/slack.test.ts` covers parsing (mentions, links, skipped subtypes, thread ids), pagination, 429 `Retry-After`, bounded 5xx retries, revoked tokens, OAuth state forgery and idempotent ids. `tests/db/rls.test.ts` checks that no signed-in role can read `slack_workspaces` and that another workspace cannot read `slack_channels`.
- Not tested: the `syncSlack` database job end to end and any real Slack call. Those need the app credentials from step 2.
