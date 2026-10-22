# Supabase backend: setup and deploy

FollowThru runs in two modes:

- **Cloud mode** (Supabase configured): real accounts, a shared PostgreSQL database, private file storage, live updates.
- **Demo mode** (no Supabase settings, or `vite --mode demo`): everything stays in the browser. The automated browser tests use this mode.

## How it fits together

- `auth.users` (Supabase Auth) owns passwords and sessions. Each user has one row in `public.profiles` with their organization, role (`coordinator`, `team_lead`, `member`) and the engine person they act as (`person_id` → `external_people.external_id`).
- The browser only **reads**, through Row Level Security (`supabase/migrations/20261018000002_security.sql`). It never writes tables directly.
- Every write goes through the server routes in `api/_lib/cloud` (`/api/cloud/<route>`). They check the caller's role from the database, run the existing engine on the server, and save each change set atomically with `public.apply_ops`, which only the service role can call.
- Files go to the private `task-attachments` bucket under `<org_id>/<random>/<name>`. The server checks each file's bytes, records its SHA-256 and gives out 60-second signed download links.
- Approved reminders become in-app notifications only. During quiet hours a notification is stored with a later `deliver_after` and RLS hides it until then, so no scheduler is needed.

## One-time setup (already done for project `mxtcgulucnmbclmwtxfa`)

1. Create a Supabase project.
2. SQL Editor → New query → paste every file in `supabase/migrations/` in order (or the combined file) → Run.
3. Project Settings → API Keys: copy the URL, the publishable key and the secret key.
4. Create `.env.local` from `.env.example` and paste them in. `.env.local` is ignored by git.
5. `npm run dev`, open http://localhost:5173, choose **Create a workspace**.

Optional: Authentication → URL Configuration → set Site URL to your app URL so password-reset emails link back correctly. Supabase's built-in email only delivers to your own team's addresses; for real users, add an SMTP provider under Authentication → Emails, or let coordinators reset passwords on the People page.

## Checks

- `npm test`: includes `tests/db/rls.test.ts`, which runs every migration and the RLS policies in a local Postgres (PGlite).
- `npm run cloud:smoke`: 42 live checks against the real project through the API routes (needs `npm run dev`). It creates a throwaway workspace and deletes it at the end.

## Deploy to Vercel

1. Import the GitHub repository in Vercel (framework: Vite; build command and output come from `vercel.json`).
2. Project → Settings → Environment Variables, for Production and Preview:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_PUBLISHABLE_KEY`
   - `SUPABASE_SECRET_KEY` (server only, never prefixed with `VITE_`)
3. Deploy. `/api/cloud/*` runs as the `api/cloud.ts` function.
4. In Supabase, add the Vercel URL under Authentication → URL Configuration (Site URL and Redirect URLs).

## Known limits

- Rate limits for sign-up and login are kept in memory per server instance; on Vercel each instance counts separately (Supabase Auth adds its own limits).
- The engine runs on the server on every write, on sign-in, every 5 minutes while a reviewer has the app open, and with **Run now**. Nothing runs when nobody is signed in; quiet-hour reminders still appear on time because delivery is gated by `deliver_after`, not by a job.
- The optional Gemini second opinion is available in demo mode only; the server engine uses the rules.
- If the secret key was ever shared outside `.env.local` or Vercel settings, rotate it in Supabase (Project Settings → API Keys).

## Live deployment

- Production: https://followthru-ruby.vercel.app (Vercel project `followthru`).
- `npm run build` first bundles the server code (`scripts/build-api.mjs` → `api/_dist/entries.mjs`, not committed). The `api/*.js` files are one-line entries that re-export from it; Vercel runs functions as ES modules, which cannot follow the extensionless imports in `src/`.
- Redeploy: `npx vercel deploy --prod` (with a Vercel login or `--token`).

## Android app (Trusted Web Activity)

- Built with PWABuilder from the live manifest. Package id `app.vercel.followthru_ruby.twa`.
- `public/.well-known/assetlinks.json` holds the signing certificate fingerprint, so Android opens the app full screen (no address bar). Google's Digital Asset Links API confirms the link.
- The APK, AAB, signing keystore and its password are kept outside the repository (never commit them). Every future app update must be signed with the same keystore.
- A new Vercel domain needs a new package (or an updated `assetlinks.json` and `host`).
