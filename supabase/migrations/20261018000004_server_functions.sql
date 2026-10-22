-- Atomic change sets for the server API. supabase-js has no transactions, so every workflow
-- write (permission already checked in the API) is sent as one list of operations that either
-- all apply or none do. Only the service role may call it.
--
-- ops: [{ "op": "insert" | "upsert" | "update" | "delete", "table": "...", "row"/"set": {...},
--         "match": {...}, "conflict": ["col", ...], "ignore_duplicates": bool, "require_rows": bool,
--         "returning": "col" }]
-- An update or delete with require_rows that touches no row raises 'conflict' (SQLSTATE P0409),
-- which the API turns into HTTP 409. Optimistic locking is a match on row_version.
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
    'engine_runs', 'notifications', 'audit_log', 'settings'];
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

-- Live updates (Realtime honours the RLS policies above).
do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['notifications', 'tasks', 'reminder_drafts', 'human_decisions', 'engine_runs', 'comments', 'files', 'settings'] loop
      if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end;
$$;
