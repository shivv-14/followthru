-- Row Level Security. The browser only ever reads, through these policies. Every write goes
-- through the server API (service role), which checks permissions again and writes atomically
-- with public.apply_ops. Helpers live in schema app, which the Data API does not expose.

-- Caller's organization; null when the caller is disabled or must still change a temporary
-- password, which hides all organization data until they do.
create or replace function app.org_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select p.org_id from public.profiles p
  where p.id = auth.uid() and p.is_active and not p.must_change_password
$$;

create or replace function app.role() returns text
language sql stable security definer set search_path = '' as $$
  select p.role from public.profiles p
  where p.id = auth.uid() and p.is_active and not p.must_change_password
$$;

-- Team keys the caller leads.
create or replace function app.led_team_keys() returns text[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(t.team_key), '{}') from public.teams t
  where t.lead_profile_id = auth.uid() and t.org_id = app.org_id()
$$;

-- Task visibility: coordinators see their organization, team leads the tasks of teams they
-- lead, members the tasks they own.
create or replace function app.can_read_task(p_task_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.tasks t
    where t.id = p_task_id and t.org_id = app.org_id()
      and (app.role() = 'coordinator'
        or t.owner_profile_id = auth.uid()
        or (app.role() = 'team_lead' and t.team_key = any (app.led_team_keys())))
  )
$$;

create or replace function app.can_read_task_key(p_org uuid, p_task_key text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.tasks t where t.org_id = p_org and t.task_key = p_task_key and app.can_read_task(t.id))
$$;

-- Reviewers (coordinators, and team leads for their teams) see reminder drafts.
create or replace function app.can_review_task_key(p_org uuid, p_task_key text) returns boolean
language sql stable security definer set search_path = '' as $$
  select app.role() in ('coordinator', 'team_lead') and app.can_read_task_key(p_org, p_task_key)
$$;

-- Messages: coordinators see every thread; others see threads linked to tasks they can read.
create or replace function app.can_read_thread(p_org uuid, p_thread text) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_org = app.org_id() and (
    app.role() = 'coordinator'
    or exists (select 1 from public.tasks t where t.org_id = p_org and p_thread = any (t.thread_ids) and app.can_read_task(t.id))
  )
$$;

create or replace function app.can_read_file(p_object_path text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.files f
    where f.object_path = p_object_path and f.deleted_at is null and f.org_id = app.org_id()
      and (app.role() = 'coordinator' or f.uploader_profile_id = auth.uid() or (f.task_id is not null and app.can_read_task(f.task_id)))
  )
$$;

revoke all on schema app from public;
grant usage on schema app to authenticated, service_role;
revoke all on all functions in schema app from public;
grant execute on function app.org_id(), app.role(), app.led_team_keys(), app.can_read_task(uuid), app.can_read_task_key(uuid, text),
  app.can_review_task_key(uuid, text), app.can_read_thread(uuid, text), app.can_read_file(text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Grants: anon gets nothing; signed-in users may only SELECT (RLS decides which rows).
-- ---------------------------------------------------------------------------
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
grant select on all tables in schema public to authenticated;
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on functions from anon, authenticated, public;

-- ---------------------------------------------------------------------------
-- RLS on every table
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['organizations', 'external_people', 'profiles', 'teams', 'team_members', 'auth_events', 'credential_events',
    'imports', 'threads', 'messages', 'followup_flows', 'tasks', 'task_assignments', 'task_events', 'human_decisions', 'blockers',
    'deadline_requests', 'submissions', 'comments', 'files', 'reminder_drafts', 'reminder_draft_versions', 'suppressions',
    'engine_runs', 'notifications', 'audit_log', 'settings'] loop
    -- Not FORCE: the security-definer helpers above run as the table owner and must see every row.
    execute format('alter table public.%I enable row level security', t);
  end loop;
end;
$$;

-- Service role: full access for the server API (it bypasses RLS on Supabase; this keeps local tests honest too).
do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('create policy service_all on public.%I for all to service_role using (true) with check (true)', t);
  end loop;
end;
$$;

create policy org_read on public.organizations for select to authenticated using (id = app.org_id());

-- Your own profile is always readable (so a disabled or must-change account can see why it is blocked).
create policy profile_self on public.profiles for select to authenticated using (id = auth.uid());
create policy profile_coordinator on public.profiles for select to authenticated using (org_id = app.org_id() and app.role() = 'coordinator');
create policy profile_team_lead on public.profiles for select to authenticated using (
  org_id = app.org_id() and app.role() = 'team_lead'
  and exists (select 1 from public.team_members m join public.teams t on t.id = m.team_id
              where m.profile_id = profiles.id and t.lead_profile_id = auth.uid())
);

-- Names and timezones of people in the organization (needed to show owners and deadlines).
create policy people_read on public.external_people for select to authenticated using (org_id = app.org_id());

create policy teams_read on public.teams for select to authenticated using (org_id = app.org_id());
create policy team_members_read on public.team_members for select to authenticated using (
  profile_id = auth.uid()
  or exists (select 1 from public.teams t where t.id = team_id and t.org_id = app.org_id()
             and (app.role() = 'coordinator' or t.lead_profile_id = auth.uid()))
);

create policy auth_events_read on public.auth_events for select to authenticated using (org_id = app.org_id() and app.role() = 'coordinator');
create policy credential_events_read on public.credential_events for select to authenticated using (org_id = app.org_id() and app.role() = 'coordinator');

create policy imports_read on public.imports for select to authenticated using (org_id = app.org_id() and app.role() in ('coordinator', 'team_lead'));
create policy threads_read on public.threads for select to authenticated using (app.can_read_thread(org_id, external_id));
create policy messages_read on public.messages for select to authenticated using (app.can_read_thread(org_id, thread_external_id));

create policy flows_read on public.followup_flows for select to authenticated using (org_id = app.org_id());

create policy tasks_read on public.tasks for select to authenticated using (app.can_read_task(id));
create policy assignments_read on public.task_assignments for select to authenticated using (app.can_read_task(task_id));
create policy task_events_read on public.task_events for select to authenticated using (app.can_read_task(task_id));
create policy decisions_read on public.human_decisions for select to authenticated using (app.can_read_task_key(org_id, task_key));
create policy blockers_read on public.blockers for select to authenticated using (app.can_read_task(task_id));
create policy deadline_requests_read on public.deadline_requests for select to authenticated using (app.can_read_task(task_id));
create policy submissions_read on public.submissions for select to authenticated using (app.can_read_task(task_id));
create policy comments_read on public.comments for select to authenticated using (deleted_at is null and app.can_read_task(task_id));
create policy files_read on public.files for select to authenticated using (deleted_at is null and app.can_read_file(object_path));

create policy drafts_read on public.reminder_drafts for select to authenticated using (app.can_review_task_key(org_id, task_key));
create policy draft_versions_read on public.reminder_draft_versions for select to authenticated using (
  exists (select 1 from public.reminder_drafts d where d.id = draft_id and app.can_review_task_key(d.org_id, d.task_key))
);
create policy suppressions_read on public.suppressions for select to authenticated using (app.can_review_task_key(org_id, task_key));
create policy engine_runs_read on public.engine_runs for select to authenticated using (org_id = app.org_id() and app.role() in ('coordinator', 'team_lead'));

create policy notifications_read on public.notifications for select to authenticated using (
  recipient_profile_id = auth.uid() and org_id = app.org_id() and deliver_after <= now()
);

create policy audit_read on public.audit_log for select to authenticated using (org_id = app.org_id() and app.role() = 'coordinator');
create policy settings_read on public.settings for select to authenticated using (org_id = app.org_id());

-- ---------------------------------------------------------------------------
-- The only browser write: marking your own notifications read (no other column can change).
-- ---------------------------------------------------------------------------
create or replace function public.mark_notifications_read(p_ids uuid[] default null) returns int
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  if auth.uid() is null or app.org_id() is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  update public.notifications set read_at = now()
  where recipient_profile_id = auth.uid() and read_at is null and deliver_after <= now()
    and (p_ids is null or id = any (p_ids));
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke all on function public.mark_notifications_read(uuid[]) from public, anon;
grant execute on function public.mark_notifications_read(uuid[]) to authenticated;
