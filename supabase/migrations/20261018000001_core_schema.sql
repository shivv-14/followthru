-- FollowThru core schema.
-- Identity: auth.users (Supabase Auth, owns passwords) 1:1 public.profiles. Each profile belongs to one
-- organization and is linked to one engine person (external_people.external_id) in that organization.
-- All real-world timestamps are timestamptz (stored in UTC).

create schema if not exists app;

-- ---------------------------------------------------------------------------
-- Organizations and people
-- ---------------------------------------------------------------------------

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 120),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Everyone the engine knows about: imported people and people created for app accounts.
create table public.external_people (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  external_id text not null check (char_length(external_id) between 1 and 80),
  name text not null check (char_length(name) between 1 and 120),
  timezone text not null,
  role text not null default 'member' check (role in ('coordinator', 'member')),
  team_key text,
  email text,
  linked_profile_id uuid,
  import_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, external_id)
);

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  org_id uuid not null references public.organizations (id) on delete restrict,
  full_name text not null check (char_length(full_name) between 1 and 120),
  username text not null check (username ~ '^[a-z0-9][a-z0-9._-]{2,31}$'),
  email text,
  role text not null check (role in ('coordinator', 'team_lead', 'member')),
  timezone text not null default 'UTC',
  person_id text not null,
  is_active boolean not null default true,
  must_change_password boolean not null default false,
  created_by uuid references public.profiles (id) on delete set null,
  last_login_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, person_id),
  foreign key (org_id, person_id) references public.external_people (org_id, external_id) on update cascade
);
create unique index profiles_username_key on public.profiles (lower(username));
create index profiles_org_idx on public.profiles (org_id);

alter table public.external_people
  add constraint external_people_linked_profile_fk foreign key (linked_profile_id) references public.profiles (id) on delete set null;

create table public.teams (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  team_key text not null check (team_key ~ '^[a-z0-9][a-z0-9_-]{0,39}$'),
  name text not null check (char_length(name) between 1 and 80),
  description text check (char_length(description) <= 500),
  lead_profile_id uuid references public.profiles (id) on delete set null,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, team_key)
);

create table public.team_members (
  team_id uuid not null references public.teams (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  added_by uuid references public.profiles (id) on delete set null,
  added_at timestamptz not null default now(),
  primary key (team_id, profile_id)
);
create index team_members_profile_idx on public.team_members (profile_id);

-- Login outcomes. Never passwords or tokens; the identifier is stored as a hash.
create table public.auth_events (
  id bigint generated always as identity primary key,
  org_id uuid references public.organizations (id) on delete set null,
  profile_id uuid references public.profiles (id) on delete set null,
  identifier_hash text,
  event text not null check (event in ('login_success', 'login_failure', 'login_disabled', 'login_rate_limited', 'logout', 'password_changed', 'password_reset_requested')),
  ip_hash text,
  user_agent text,
  created_at timestamptz not null default now()
);
create index auth_events_org_idx on public.auth_events (org_id, created_at desc);

create table public.credential_events (
  id bigint generated always as identity primary key,
  org_id uuid not null references public.organizations (id) on delete cascade,
  target_profile_id uuid references public.profiles (id) on delete set null,
  actor_profile_id uuid references public.profiles (id) on delete set null,
  event text not null check (event in ('account_created', 'password_reset', 'password_changed', 'account_disabled', 'account_enabled', 'role_changed')),
  details jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index credential_events_org_idx on public.credential_events (org_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Conversation imports
-- ---------------------------------------------------------------------------

create table public.imports (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  file_name text not null,
  format text not null check (format in ('json', 'csv')),
  source text not null check (source in ('fixture', 'import', 'demo')),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  status text not null check (status in ('imported', 'failed')),
  issues jsonb not null default '[]',
  people_count int not null default 0,
  thread_count int not null default 0,
  message_count int not null default 0,
  reference_time timestamptz,
  labels jsonb not null default '[]',
  imported_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (org_id, sha256)
);

alter table public.external_people
  add constraint external_people_import_fk foreign key (import_id) references public.imports (id) on delete set null;

create table public.threads (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  external_id text not null,
  title text,
  source text not null default 'import',
  import_id uuid references public.imports (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (org_id, external_id)
);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  thread_external_id text not null,
  external_id text not null,
  author_external_id text not null,
  text text not null check (char_length(text) <= 20000),
  sent_at timestamptz not null,
  reply_to_external_id text,
  mention_external_ids text[] not null default '{}',
  source_timezone text,
  raw jsonb,
  import_id uuid references public.imports (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (org_id, external_id),
  foreign key (org_id, thread_external_id) references public.threads (org_id, external_id) on delete cascade
);
create index messages_thread_idx on public.messages (org_id, thread_external_id, sent_at);

-- ---------------------------------------------------------------------------
-- Follow-up flows and tasks
-- ---------------------------------------------------------------------------

create table public.followup_flows (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  flow_key text not null check (flow_key ~ '^[a-z0-9_-]{1,60}$'),
  name text not null check (char_length(name) between 1 and 80),
  is_default boolean not null default false,
  applies_to text not null default 'all',
  -- The engine's Flow object (steps, tones, recipients, skipWeekends)
  definition jsonb not null,
  quiet_hours jsonb not null default '{"start": "21:00", "end": "09:00"}',
  skip_weekends boolean not null default false,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, flow_key)
);

-- Manual tasks (engine input) and every commitment the engine derives (engine output snapshot).
create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  task_key text not null,
  source text not null check (source in ('conversation', 'manual')),
  manual_task jsonb,
  title text not null check (char_length(title) between 1 and 300),
  description text check (char_length(description) <= 4000),
  owner_person text,
  owner_profile_id uuid references public.profiles (id) on delete set null,
  requester_person text,
  team_key text,
  group_key text,
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high', 'critical')),
  due_at timestamptz,
  timezone text,
  deadline_certainty text,
  deadline_phrase text,
  status text not null default 'open' check (status in ('open', 'in_progress', 'overdue', 'done', 'cancelled', 'deferred')),
  review_state text not null default 'none' check (review_state in ('none', 'submitted', 'approved', 'rejected', 'changes_requested')),
  response_state text,
  needs_review boolean not null default false,
  review_reasons text[] not null default '{}',
  confidence numeric,
  extraction_method text,
  flow_key text,
  thread_ids text[] not null default '{}',
  snapshot jsonb,
  created_by uuid references public.profiles (id) on delete set null,
  completed_at timestamptz,
  row_version int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, task_key),
  check (source <> 'manual' or manual_task is not null)
);
create index tasks_owner_idx on public.tasks (owner_profile_id);
create index tasks_status_idx on public.tasks (org_id, status);
create index tasks_due_idx on public.tasks (org_id, due_at);
create index tasks_team_idx on public.tasks (org_id, team_key);

create table public.task_assignments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  task_id uuid not null references public.tasks (id) on delete cascade,
  assignee_person text not null,
  assignee_profile_id uuid references public.profiles (id) on delete set null,
  assigned_by uuid references public.profiles (id) on delete set null,
  assigned_at timestamptz not null default now(),
  ended_at timestamptz,
  reason text
);
create index task_assignments_task_idx on public.task_assignments (task_id);
create unique index task_assignments_one_open on public.task_assignments (task_id) where ended_at is null;

create table public.task_events (
  id bigint generated always as identity primary key,
  org_id uuid not null references public.organizations (id) on delete cascade,
  task_id uuid not null references public.tasks (id) on delete cascade,
  event_key text not null,
  event_type text not null,
  actor_person text,
  actor_profile_id uuid references public.profiles (id) on delete set null,
  at timestamptz not null,
  message_external_id text,
  thread_external_id text,
  evidence jsonb,
  rule text,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  unique (org_id, event_key)
);
create index task_events_task_idx on public.task_events (task_id, at);

-- Human decisions are the engine's second input next to messages (full HumanDecision in payload).
create table public.human_decisions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  decision_key text not null,
  task_key text not null,
  type text not null,
  at timestamptz not null,
  recorded_at timestamptz not null default now(),
  by_person text not null,
  by_profile_id uuid references public.profiles (id) on delete set null,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  unique (org_id, decision_key)
);
create index human_decisions_task_idx on public.human_decisions (org_id, task_key);

create table public.blockers (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  task_id uuid not null references public.tasks (id) on delete cascade,
  decision_key text,
  reporter_profile_id uuid references public.profiles (id) on delete set null,
  reporter_person text,
  description text not null check (char_length(description) between 1 and 2000),
  related_person text,
  status text not null default 'open' check (status in ('open', 'resolved')),
  resolved_by uuid references public.profiles (id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);
create index blockers_task_idx on public.blockers (task_id);

create table public.deadline_requests (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  task_id uuid not null references public.tasks (id) on delete cascade,
  decision_key text,
  requester_profile_id uuid references public.profiles (id) on delete set null,
  requester_person text,
  proposed_due_at timestamptz not null,
  reason text not null check (char_length(reason) between 1 and 2000),
  status text not null default 'pending' check (status in ('pending', 'approved', 'declined')),
  decided_by uuid references public.profiles (id) on delete set null,
  decided_at timestamptz,
  decision_note text,
  created_at timestamptz not null default now()
);
create index deadline_requests_task_idx on public.deadline_requests (task_id);

create table public.submissions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  task_id uuid not null references public.tasks (id) on delete cascade,
  submission_key text not null,
  submitter_profile_id uuid references public.profiles (id) on delete set null,
  submitter_person text,
  note text check (char_length(note) <= 4000),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'reassigned')),
  reviewer_profile_id uuid references public.profiles (id) on delete set null,
  reviewed_at timestamptz,
  review_note text,
  reassigned_to_person text,
  created_at timestamptz not null default now(),
  unique (org_id, submission_key)
);
create index submissions_task_idx on public.submissions (task_id);

create table public.comments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  task_id uuid not null references public.tasks (id) on delete cascade,
  author_profile_id uuid references public.profiles (id) on delete set null,
  body text not null check (char_length(body) between 1 and 4000),
  mentions uuid[] not null default '{}',
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  deleted_at timestamptz
);
create index comments_task_idx on public.comments (task_id, created_at);

create table public.files (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  uploader_profile_id uuid references public.profiles (id) on delete set null,
  task_id uuid references public.tasks (id) on delete set null,
  submission_key text,
  original_name text not null check (char_length(original_name) between 1 and 255),
  object_path text not null unique,
  mime text not null,
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 10485760),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  deleted_at timestamptz,
  delete_reason text,
  created_at timestamptz not null default now()
);
create index files_task_idx on public.files (task_id);
create index files_org_idx on public.files (org_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Reminder queue
-- ---------------------------------------------------------------------------

-- One draft per task (unique task_key), versioned in place. snapshot is the engine's Draft.
create table public.reminder_drafts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  draft_key text not null,
  task_key text not null,
  task_id uuid references public.tasks (id) on delete set null,
  kind text not null,
  recipient_person text,
  recipient_confirmed boolean not null default false,
  warnings jsonb not null default '[]',
  subject text,
  body text not null,
  tone text,
  flow_key text,
  stage int,
  state text not null check (state in ('pending_review', 'approved', 'suppressed', 'stale', 'rejected', 'delivered')),
  version int not null default 1,
  evidence jsonb,
  approved_by_person text,
  approved_at timestamptz,
  delivered_at timestamptz,
  delivery jsonb,
  snapshot jsonb not null,
  row_version int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, draft_key),
  unique (org_id, task_key)
);
create index reminder_drafts_state_idx on public.reminder_drafts (org_id, state);

create table public.reminder_draft_versions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  draft_id uuid not null references public.reminder_drafts (id) on delete cascade,
  version int not null,
  change_note text,
  subject text,
  body text not null,
  recipient_person text,
  editor_profile_id uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (draft_id, version)
);

create table public.suppressions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  task_key text not null,
  draft_id uuid references public.reminder_drafts (id) on delete cascade,
  reason text not null,
  evidence jsonb,
  at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (draft_id, reason, at)
);

create table public.engine_runs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  actor_profile_id uuid references public.profiles (id) on delete set null,
  trigger text not null check (trigger in ('login', 'interval', 'manual', 'write', 'import')),
  evaluated_at timestamptz not null,
  flags jsonb not null default '{}',
  extractor text not null,
  engine_version text not null,
  result_hash text,
  counts jsonb not null default '{}',
  status text not null check (status in ('ok', 'error')),
  error text,
  duration_ms int,
  created_at timestamptz not null default now()
);
create index engine_runs_org_idx on public.engine_runs (org_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Notifications, audit, settings
-- ---------------------------------------------------------------------------

-- deliver_after holds approved reminders back until the recipient's quiet hours end:
-- a notification is only visible (RLS) once deliver_after has passed, so no scheduler is needed.
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  recipient_profile_id uuid not null references public.profiles (id) on delete cascade,
  type text not null,
  title text not null check (char_length(title) <= 200),
  body text check (char_length(body) <= 2000),
  task_key text,
  link text,
  event_key text not null,
  deliver_after timestamptz not null default now(),
  read_at timestamptz,
  created_at timestamptz not null default now(),
  unique (recipient_profile_id, event_key)
);
create index notifications_recipient_idx on public.notifications (recipient_profile_id, created_at desc);
create index notifications_unread_idx on public.notifications (recipient_profile_id) where read_at is null;

create table public.audit_log (
  id bigint generated always as identity primary key,
  org_id uuid not null references public.organizations (id) on delete cascade,
  actor_profile_id uuid,
  actor_person text,
  action text not null,
  entity_type text not null,
  entity_id text not null,
  before jsonb,
  after jsonb,
  request jsonb,
  created_at timestamptz not null default now()
);
create index audit_log_org_idx on public.audit_log (org_id, created_at desc);
create index audit_log_entity_idx on public.audit_log (org_id, entity_id);

create table public.settings (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  key text not null,
  value jsonb not null,
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, key)
);

-- Audit history is append-only for everyone, including the service role. Rows only go away
-- when their whole organization is deleted.
create or replace function app.audit_append_only() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' and not exists (select 1 from public.organizations o where o.id = old.org_id) then
    return old;
  end if;
  raise exception 'audit_log is append-only' using errcode = '42501';
end;
$$;
create trigger audit_log_append_only before update or delete on public.audit_log
  for each row execute function app.audit_append_only();

create or replace function app.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
do $$
declare t text;
begin
  foreach t in array array['organizations', 'external_people', 'profiles', 'teams', 'followup_flows', 'tasks', 'reminder_drafts', 'settings'] loop
    execute format('create trigger %I before update on public.%I for each row execute function app.touch_updated_at()', t || '_touch', t);
  end loop;
end;
$$;
