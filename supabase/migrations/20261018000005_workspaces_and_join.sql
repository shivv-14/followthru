-- Team members who sign up themselves, workspace discovery and join requests, task start dates,
-- cancelling held reminders, member-visible audit history, and growth experiment records.

-- A self-registered team member has no workspace until a coordinator approves a join request.
alter table public.profiles alter column org_id drop not null;

alter table public.organizations add column if not exists description text check (char_length(description) <= 500);
alter table public.organizations add column if not exists discoverable boolean not null default true;

create table public.join_requests (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  message text check (char_length(message) <= 500),
  decided_by uuid references public.profiles (id) on delete set null,
  decided_at timestamptz,
  decision_reason text check (char_length(decision_reason) <= 500),
  created_at timestamptz not null default now()
);
-- One open request per person per workspace
create unique index join_requests_one_pending on public.join_requests (org_id, profile_id) where status = 'pending';
create index join_requests_org_idx on public.join_requests (org_id, status, created_at desc);

-- Planned start; due_at stays the deadline (the end), so the engine and history are unchanged
alter table public.tasks add column if not exists start_at timestamptz;
alter table public.tasks add constraint tasks_start_before_due check (start_at is null or due_at is null or due_at >= start_at);

-- A reminder held for quiet hours is cancelled if the task closes before it is due
alter table public.notifications add column if not exists cancelled_at timestamptz;
drop policy if exists notifications_read on public.notifications;
create policy notifications_read on public.notifications for select to authenticated using (
  recipient_profile_id = auth.uid() and org_id = app.org_id() and deliver_after <= now() and cancelled_at is null
);

-- Members see audit history about themselves and the tasks they can read (still append-only)
alter table public.audit_log add column if not exists subject_profile_id uuid;
create policy audit_member_read on public.audit_log for select to authenticated using (
  org_id = app.org_id() and (
    actor_profile_id = auth.uid()
    or subject_profile_id = auth.uid()
    or (entity_type = 'task' and app.can_read_task_key(org_id, entity_id))
  )
);

create table public.growth_experiments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  slot int not null check (slot between 1 and 10),
  commitment_key text,
  intended_recipient text,
  person_approached text,
  approached_at timestamptz,
  reminder_text text check (char_length(reminder_text) <= 2000),
  decision text not null default 'pending' check (decision in ('pending', 'approved', 'rejected')),
  delivery text not null default 'not_sent' check (delivery in ('not_sent', 'shown_in_app', 'sent')),
  response text check (char_length(response) <= 2000),
  response_at timestamptz,
  useful boolean,
  progressed boolean,
  minutes_saved int check (minutes_saved >= 0),
  false_reminder boolean,
  notes text check (char_length(notes) <= 4000),
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, slot)
);
create trigger growth_experiments_touch before update on public.growth_experiments for each row execute function app.touch_updated_at();

alter table public.join_requests enable row level security;
alter table public.growth_experiments enable row level security;
create policy service_all on public.join_requests for all to service_role using (true) with check (true);
create policy service_all on public.growth_experiments for all to service_role using (true) with check (true);
-- Your own requests, or the requests for the workspace you coordinate
create policy join_requests_read on public.join_requests for select to authenticated using (
  profile_id = auth.uid() or (org_id = app.org_id() and app.role() in ('coordinator', 'team_lead'))
);
create policy growth_read on public.growth_experiments for select to authenticated using (org_id = app.org_id() and app.role() in ('coordinator', 'team_lead'));
revoke all on public.join_requests, public.growth_experiments from anon, authenticated;
grant select on public.join_requests, public.growth_experiments to authenticated;
grant all on public.join_requests, public.growth_experiments to service_role;

-- apply_ops: same function, two more tables allowed
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
    'engine_runs', 'notifications', 'audit_log', 'settings', 'join_requests', 'growth_experiments'];
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

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'join_requests') then
    alter publication supabase_realtime add table public.join_requests;
  end if;
end;
$$;
