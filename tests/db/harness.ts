import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { PGlite } from '@electric-sql/pglite'

const root = resolve(__dirname, '../..')

/** Fresh in-memory Postgres with the Supabase stand-ins and every migration applied in order. */
export async function freshDb(): Promise<PGlite> {
  const db = new PGlite()
  await db.exec(readFileSync(resolve(__dirname, 'supabaseStubs.sql'), 'utf8'))
  const dir = resolve(root, 'supabase/migrations')
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    await db.exec(readFileSync(resolve(dir, file), 'utf8'))
  }
  return db
}

/** Runs queries as a signed-in user (role authenticated, auth.uid() = userId), then switches back. */
export async function asUser<T>(db: PGlite, userId: string, fn: () => Promise<T>): Promise<T> {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${userId}', false);`)
  try {
    return await fn()
  } finally {
    await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`)
  }
}

export async function asService<T>(db: PGlite, fn: () => Promise<T>): Promise<T> {
  await db.exec('set role service_role;')
  try {
    return await fn()
  } finally {
    await db.exec('reset role;')
  }
}

export const ids = {
  orgA: '00000000-0000-4000-8000-00000000000a',
  orgB: '00000000-0000-4000-8000-00000000000b',
  coordA: '10000000-0000-4000-8000-000000000001',
  leadA: '10000000-0000-4000-8000-000000000002',
  memberA: '10000000-0000-4000-8000-000000000003',
  member2A: '10000000-0000-4000-8000-000000000004',
  mustChangeA: '10000000-0000-4000-8000-000000000005',
  coordB: '20000000-0000-4000-8000-000000000001',
  task1: '30000000-0000-4000-8000-000000000001',
  task2: '30000000-0000-4000-8000-000000000002',
  taskB: '30000000-0000-4000-8000-000000000003',
}

/** Two organizations: A with a coordinator, a team lead (team eng), two members and one account that must change its password; B with a coordinator. */
export async function seed(db: PGlite): Promise<void> {
  const people: [string, string, string, string, string][] = [
    [ids.coordA, ids.orgA, 'coord_a', 'coordinator', 'p_coord'],
    [ids.leadA, ids.orgA, 'lead_a', 'team_lead', 'p_lead'],
    [ids.memberA, ids.orgA, 'member_a', 'member', 'p_member'],
    [ids.member2A, ids.orgA, 'member2_a', 'member', 'p_member2'],
    [ids.mustChangeA, ids.orgA, 'new_a', 'member', 'p_new'],
    [ids.coordB, ids.orgB, 'coord_b', 'coordinator', 'p_coord'],
  ]
  await db.exec(`
    insert into public.organizations (id, name) values ('${ids.orgA}', 'Org A'), ('${ids.orgB}', 'Org B');
  `)
  for (const [id, org, username, role, person] of people) {
    await db.exec(`
      insert into auth.users (id, email) values ('${id}', '${username}@example.com');
      insert into public.external_people (org_id, external_id, name, timezone) values ('${org}', '${person}', '${username}', 'UTC');
      insert into public.profiles (id, org_id, full_name, username, role, person_id, must_change_password)
        values ('${id}', '${org}', '${username}', '${username}', '${role}', '${person}', ${id === ids.mustChangeA});
    `)
  }
  await db.exec(`
    insert into public.teams (id, org_id, team_key, name, lead_profile_id) values (gen_random_uuid(), '${ids.orgA}', 'eng', 'Engineering', '${ids.leadA}');
    insert into public.threads (org_id, external_id, title) values ('${ids.orgA}', 't_1', 'One'), ('${ids.orgA}', 't_2', 'Two'), ('${ids.orgB}', 't_b', 'B');
    insert into public.messages (org_id, thread_external_id, external_id, author_external_id, text, sent_at)
      values ('${ids.orgA}', 't_1', 'm_1', 'p_member', 'I will send it', now()),
             ('${ids.orgA}', 't_2', 'm_2', 'p_member2', 'Secret other work', now()),
             ('${ids.orgB}', 't_b', 'm_b', 'p_coord', 'Org B message', now());
    insert into public.tasks (id, org_id, task_key, source, title, owner_person, owner_profile_id, team_key, thread_ids)
      values ('${ids.task1}', '${ids.orgA}', 'c_m_1', 'conversation', 'Send it', 'p_member', '${ids.memberA}', 'eng', '{t_1}'),
             ('${ids.task2}', '${ids.orgA}', 'c_m_2', 'conversation', 'Other work', 'p_member2', '${ids.member2A}', 'ops', '{t_2}'),
             ('${ids.taskB}', '${ids.orgB}', 'c_m_b', 'conversation', 'B work', 'p_coord', '${ids.coordB}', null, '{t_b}');
    insert into public.reminder_drafts (org_id, draft_key, task_key, task_id, kind, body, state, snapshot)
      values ('${ids.orgA}', 'd_c_m_1', 'c_m_1', '${ids.task1}', 'reminder', 'Hi', 'pending_review', '{}'),
             ('${ids.orgA}', 'd_c_m_2', 'c_m_2', '${ids.task2}', 'reminder', 'Hi', 'pending_review', '{}');
    insert into public.notifications (org_id, recipient_profile_id, type, title, event_key, deliver_after)
      values ('${ids.orgA}', '${ids.memberA}', 'task_assigned', 'Now', 'e1', now() - interval '1 minute'),
             ('${ids.orgA}', '${ids.memberA}', 'reminder', 'Later', 'e2', now() + interval '8 hours'),
             ('${ids.orgA}', '${ids.member2A}', 'task_assigned', 'Not yours', 'e3', now() - interval '1 minute');
    insert into public.audit_log (org_id, action, entity_type, entity_id) values ('${ids.orgA}', 'seed', 'data', 'x');
  `)
}
