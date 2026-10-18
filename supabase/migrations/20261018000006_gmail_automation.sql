-- Gmail-to-ticket automation.
-- gmail_accounts: one connected mailbox per workspace address. OAuth tokens are encrypted by the
--   server (AES-256-GCM, TOKEN_ENCRYPTION_KEY) and no signed-in role can read this table.
-- inbound_emails: every fetched message once (unique per Gmail message id), its AI reading,
--   processing status, retries and the tickets it created or updated.
-- automation_events: the activity feed; each row is a real backend step.
-- tasks.origin: where an automatic ticket came from (Gmail message and thread, confidence, mode).

create table public.gmail_accounts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  connected_by uuid references public.profiles (id) on delete set null,
  email text not null,
  refresh_token_enc text,
  access_token_enc text,
  access_expires_at timestamptz,
  scope text,
  history_id text,
  status text not null default 'connected' check (status in ('connected', 'error', 'revoked')),
  initial_days int not null default 7 check (initial_days between 1 and 90),
  last_sync_at timestamptz,
  last_error text,
  messages_seen int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, email)
);

create table public.inbound_emails (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  account_id uuid references public.gmail_accounts (id) on delete set null,
  source text not null default 'gmail' check (source in ('gmail', 'test')),
  gmail_message_id text not null,
  gmail_thread_id text not null,
  from_email text,
  from_name text,
  to_emails text[] not null default '{}',
  cc_emails text[] not null default '{}',
  subject text,
  sent_at timestamptz not null,
  body_text text not null default '' check (char_length(body_text) <= 20000),
  automated boolean not null default false,
  status text not null default 'pending' check (status in ('pending', 'processing', 'processed', 'ignored', 'review', 'failed')),
  attempts int not null default 0,
  next_attempt_at timestamptz not null default now(),
  last_error text,
  classification text,
  ai_mode text,
  ai_model text,
  confidence numeric,
  ai_result jsonb,
  decision jsonb,
  task_keys text[] not null default '{}',
  created_at timestamptz not null default now(),
  processed_at timestamptz,
  unique (org_id, gmail_message_id)
);
create index inbound_emails_status_idx on public.inbound_emails (org_id, status, next_attempt_at);
create index inbound_emails_thread_idx on public.inbound_emails (org_id, gmail_thread_id, sent_at);

create table public.automation_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  kind text not null,
  message text not null,
  email_id uuid references public.inbound_emails (id) on delete set null,
  task_key text,
  detail jsonb,
  created_at timestamptz not null default now()
);
create index automation_events_org_idx on public.automation_events (org_id, created_at desc);

alter table public.tasks add column origin jsonb;
create index tasks_origin_thread_idx on public.tasks (org_id, (origin ->> 'threadId'));

alter table public.gmail_accounts enable row level security;
alter table public.inbound_emails enable row level security;
alter table public.automation_events enable row level security;
create policy service_all on public.gmail_accounts for all to service_role using (true) with check (true);
create policy service_all on public.inbound_emails for all to service_role using (true) with check (true);
create policy service_all on public.automation_events for all to service_role using (true) with check (true);
-- No authenticated policy on gmail_accounts: status is served by the API without token columns.
create policy inbound_emails_read on public.inbound_emails for select to authenticated using (org_id = app.org_id() and app.role() in ('coordinator', 'team_lead'));
create policy automation_events_read on public.automation_events for select to authenticated using (org_id = app.org_id() and app.role() in ('coordinator', 'team_lead'));
revoke all on public.gmail_accounts from authenticated, anon;
grant all on public.gmail_accounts, public.inbound_emails, public.automation_events to service_role;
grant select on public.inbound_emails, public.automation_events to authenticated;

-- apply_ops: same function, three more tables allowed
create or replace function public.apply_ops(p_ops jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  op jsonb;
  t text;
  kind text;
  cols text;
  sets text;
  cond text;
  conflict text;
  ret text;
  n int;
  val jsonb;
  results jsonb := '[]';
  allowed text[] := array['organizations', 'external_people', 'profiles', 'teams', 'team_members', 'auth_events', 'credential_events',
    'imports', 'threads', 'messages', 'followup_flows', 'tasks', 'task_assignments', 'task_events', 'human_decisions', 'blockers',
    'deadline_requests', 'submissions', 'comments', 'files', 'reminder_drafts', 'reminder_draft_versions', 'suppressions',
    'engine_runs', 'notifications', 'audit_log', 'settings', 'join_requests', 'growth_experiments',
    'gmail_accounts', 'inbound_emails', 'automation_events'];
begin
  if jsonb_typeof(p_ops) <> 'array' then
    raise exception 'ops must be an array';
  end if;
  for op in select * from jsonb_array_elements(p_ops) loop
    t := op ->> 'table';
    kind := op ->> 'op';
    if not t = any (allowed) then
      raise exception 'table % is not allowed', t;
    end if;
    ret := coalesce(op ->> 'returning', 'id');
    val := null;

    if kind in ('insert', 'upsert') then
      select string_agg(format('%I', k), ', ') into cols from jsonb_object_keys(op -> 'row') k;
      if kind = 'upsert' then
        select string_agg(format('%I', c), ', ') into conflict from jsonb_array_elements_text(op -> 'conflict') c;
        if coalesce((op ->> 'ignore_duplicates')::boolean, false) then
          sets := 'do nothing';
        else
          select 'do update set ' || string_agg(format('%I = excluded.%I', k, k), ', ') into sets
          from jsonb_object_keys(op -> 'row') k where not k = any (array(select jsonb_array_elements_text(op -> 'conflict')));
          sets := coalesce(sets, 'do nothing');
        end if;
        execute format('insert into public.%I (%s) select %s from jsonb_populate_record(null::public.%I, $1) on conflict (%s) %s returning to_jsonb(%I)',
          t, cols, cols, t, conflict, sets, ret) into val using op -> 'row';
      else
        execute format('insert into public.%I (%s) select %s from jsonb_populate_record(null::public.%I, $1) returning to_jsonb(%I)',
          t, cols, cols, t, ret) into val using op -> 'row';
      end if;
      results := results || jsonb_build_array(coalesce(val, 'null'::jsonb));
      continue;
    end if;

    if op -> 'match' is null or op -> 'match' = '{}'::jsonb then
      raise exception 'update and delete need a match';
    end if;
    select string_agg(format('x.%I is not distinct from m.%I', k, k), ' and ') into cond from jsonb_object_keys(op -> 'match') k;

    if kind = 'update' then
      select string_agg(format('%I', k), ', ') into cols from jsonb_object_keys(op -> 'set') k;
      execute format('update public.%I as x set (%s) = (select %s from jsonb_populate_record(null::public.%I, $1)) from jsonb_populate_record(null::public.%I, $2) as m where %s',
        t, cols, cols, t, t, cond) using op -> 'set', op -> 'match';
    elsif kind = 'delete' then
      execute format('delete from public.%I as x using jsonb_populate_record(null::public.%I, $1) as m where %s', t, t, cond) using op -> 'match';
    else
      raise exception 'unknown op %', kind;
    end if;
    get diagnostics n = row_count;
    if n = 0 and coalesce((op ->> 'require_rows')::boolean, false) then
      raise exception 'conflict' using errcode = 'P0409', detail = format('%s on %s matched no rows', kind, t);
    end if;
    results := results || jsonb_build_array(n);
  end loop;
  return results;
end;
$$;
revoke all on function public.apply_ops(jsonb) from public, anon, authenticated;
grant execute on function public.apply_ops(jsonb) to service_role;
