-- Knowledge base: spaces, pages and an append-only page history.
-- kb_spaces: one per topic (for example 'meetings'), key unique per workspace.
-- kb_pages: markdown pages in a parent/child tree. version counts saved versions; row_version is
--   the optimistic lock the server checks on every update. source says where a page came from,
--   for example {kind: 'email', emailId, threadId} for meeting minutes.
-- kb_page_versions: every save appends one row; rows are never changed.
-- Everyone in the workspace reads published pages; coordinators and team leads read everything;
-- members also read the pages they own. All writes go through the server (service role).

create table public.kb_spaces (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  space_key text not null check (space_key ~ '^[a-z0-9][a-z0-9-]{0,39}$'),
  name text not null check (char_length(name) between 1 and 120),
  description text check (char_length(description) <= 1000),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, space_key),
  unique (org_id, id)
);
create trigger kb_spaces_touch before update on public.kb_spaces for each row execute function app.touch_updated_at();

create table public.kb_pages (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  space_id uuid not null,
  parent_id uuid references public.kb_pages (id) on delete set null,
  slug text not null check (slug ~ '^[a-z0-9][a-z0-9-]{0,119}$'),
  title text not null check (char_length(title) between 1 and 200),
  body_md text not null default '' check (char_length(body_md) <= 100000),
  status text not null default 'draft' check (status in ('draft', 'review', 'published', 'archived')),
  tags text[] not null default '{}' check (cardinality(tags) <= 20),
  owner_profile_id uuid references public.profiles (id) on delete set null,
  source jsonb,
  version int not null default 1 check (version >= 1),
  row_version int not null default 1 check (row_version >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  search_tsv tsvector generated always as (to_tsvector('simple', title || ' ' || body_md)) stored,
  -- A page always lives in a space of its own workspace
  foreign key (org_id, space_id) references public.kb_spaces (org_id, id) on delete cascade,
  check (parent_id is null or parent_id <> id),
  unique (org_id, space_id, slug)
);
create trigger kb_pages_touch before update on public.kb_pages for each row execute function app.touch_updated_at();
create index kb_pages_space_idx on public.kb_pages (org_id, space_id, parent_id);
create index kb_pages_search_idx on public.kb_pages using gin (search_tsv);
create index kb_pages_tags_idx on public.kb_pages using gin (tags);
-- One minutes page per email, even if processing runs twice
create unique index kb_pages_email_source_idx on public.kb_pages (org_id, (source ->> 'emailId')) where source ->> 'kind' = 'email';

create table public.kb_page_versions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  page_id uuid not null references public.kb_pages (id) on delete cascade,
  version int not null check (version >= 1),
  title text not null check (char_length(title) between 1 and 200),
  body_md text not null default '' check (char_length(body_md) <= 100000),
  status text not null check (status in ('draft', 'review', 'published', 'archived')),
  tags text[] not null default '{}',
  note text check (char_length(note) <= 300),
  edited_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (page_id, version)
);
create index kb_page_versions_page_idx on public.kb_page_versions (page_id, version desc);

-- Page history is append-only, including for the service role. Rows only go away with their page.
create or replace function app.kb_versions_append_only() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' and not exists (select 1 from public.kb_pages p where p.id = old.page_id) then
    return old;
  end if;
  raise exception 'kb_page_versions is append-only' using errcode = '42501';
end;
$$;
create trigger kb_page_versions_append_only before update or delete on public.kb_page_versions
  for each row execute function app.kb_versions_append_only();

alter table public.kb_spaces enable row level security;
alter table public.kb_pages enable row level security;
alter table public.kb_page_versions enable row level security;
create policy service_all on public.kb_spaces for all to service_role using (true) with check (true);
create policy service_all on public.kb_pages for all to service_role using (true) with check (true);
create policy service_all on public.kb_page_versions for all to service_role using (true) with check (true);
create policy kb_spaces_read on public.kb_spaces for select to authenticated using (org_id = app.org_id());
create policy kb_pages_read on public.kb_pages for select to authenticated using (
  org_id = app.org_id() and (
    status = 'published'
    or app.role() in ('coordinator', 'team_lead')
    or owner_profile_id = auth.uid()
  )
);
-- History follows the page; readers of someone else's published page see only published versions
create policy kb_page_versions_read on public.kb_page_versions for select to authenticated using (
  org_id = app.org_id() and exists (
    select 1 from public.kb_pages p
    where p.id = page_id
      and (app.role() in ('coordinator', 'team_lead') or p.owner_profile_id = auth.uid() or kb_page_versions.status = 'published')
  )
);
revoke all on public.kb_spaces, public.kb_pages, public.kb_page_versions from anon, authenticated;
grant select on public.kb_spaces, public.kb_pages, public.kb_page_versions to authenticated;
grant all on public.kb_spaces, public.kb_pages, public.kb_page_versions to service_role;

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
    'gmail_accounts', 'inbound_emails', 'automation_events',
    'kb_spaces', 'kb_pages', 'kb_page_versions'];
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
