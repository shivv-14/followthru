-- Slack integration (official Web API, OAuth v2, read-only bot scopes).
-- slack_workspaces: one installed Slack team per workspace. The bot token is encrypted by the
--   server (AES-256-GCM, TOKEN_ENCRYPTION_KEY) and no signed-in role can read this table.
-- slack_channels: channels the bot can see. Nothing is imported until a coordinator enables a
--   channel. cursor_ts is the newest Slack message ts already imported.
-- slack_users: Slack user -> FollowThru person, matched by email when possible.
-- Imported lines are ordinary messages rows (source of the thread = 'slack'), so the rule engine
-- reads them like every other conversation.

create table public.slack_workspaces (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  team_id text not null,
  team_name text,
  bot_token_enc text,
  scope text,
  connected_by uuid references public.profiles (id) on delete set null,
  status text not null default 'connected' check (status in ('connected', 'error', 'revoked')),
  last_sync_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, team_id)
);

create table public.slack_channels (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  slack_workspace_id uuid not null references public.slack_workspaces (id) on delete cascade,
  channel_id text not null,
  name text not null,
  is_private boolean not null default false,
  enabled boolean not null default false,
  cursor_ts text,
  last_sync_at timestamptz,
  created_at timestamptz not null default now(),
  unique (org_id, channel_id)
);

create table public.slack_users (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  slack_user_id text not null,
  email text,
  real_name text,
  person_external_id text,
  created_at timestamptz not null default now(),
  unique (org_id, slack_user_id)
);

alter table public.slack_workspaces enable row level security;
alter table public.slack_channels enable row level security;
alter table public.slack_users enable row level security;
create policy service_all on public.slack_workspaces for all to service_role using (true) with check (true);
create policy service_all on public.slack_channels for all to service_role using (true) with check (true);
create policy service_all on public.slack_users for all to service_role using (true) with check (true);
-- No authenticated policy on slack_workspaces: status is served by the API without the token column.
create policy slack_channels_read on public.slack_channels for select to authenticated using (org_id = app.org_id() and app.role() in ('coordinator', 'team_lead'));
create policy slack_users_read on public.slack_users for select to authenticated using (org_id = app.org_id() and app.role() = 'coordinator');
revoke all on public.slack_workspaces from authenticated, anon;
revoke all on public.slack_channels, public.slack_users from anon;
grant all on public.slack_workspaces, public.slack_channels, public.slack_users to service_role;
grant select on public.slack_channels, public.slack_users to authenticated;

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
    'gmail_accounts', 'inbound_emails', 'automation_events', 'kb_spaces', 'kb_pages', 'kb_page_versions',
    'slack_workspaces', 'slack_channels', 'slack_users'];
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
