import { beforeAll, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { asService, asUser, freshDb, ids, seed } from './harness'

let db: PGlite
const rows = async (sql: string) => (await db.query<Record<string, unknown>>(sql)).rows

beforeAll(async () => {
  db = await freshDb()
  await seed(db)
}, 60_000)

describe('migrations', () => {
  it('enable row level security on every public table', async () => {
    const off = await rows(`select relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`)
    expect(off).toEqual([])
  })

  it('give anon nothing and signed-in users read access only', async () => {
    const writes = await rows(`select table_name, privilege_type from information_schema.role_table_grants
      where table_schema = 'public' and grantee in ('anon', 'authenticated') and privilege_type <> 'SELECT'`)
    expect(writes).toEqual([])
    const anon = await rows(`select table_name from information_schema.role_table_grants where table_schema = 'public' and grantee = 'anon'`)
    expect(anon).toEqual([])
  })

  it('keep one reminder draft per task', async () => {
    await expect(
      db.exec(`insert into public.reminder_drafts (org_id, draft_key, task_key, kind, body, state, snapshot)
        values ('${ids.orgA}', 'd_other', 'c_m_1', 'reminder', 'x', 'pending_review', '{}')`),
    ).rejects.toThrow(/duplicate key/)
  })
})

describe('organization isolation', () => {
  it('shows a coordinator only their own organization', async () => {
    const tasks = await asUser(db, ids.coordA, () => rows('select task_key from public.tasks order by task_key'))
    expect(tasks.map((t) => t.task_key)).toEqual(['c_m_1', 'c_m_2'])
    const msgs = await asUser(db, ids.coordA, () => rows('select external_id from public.messages order by external_id'))
    expect(msgs.map((m) => m.external_id)).toEqual(['m_1', 'm_2'])
    const orgs = await asUser(db, ids.coordB, () => rows('select name from public.organizations'))
    expect(orgs).toEqual([{ name: 'Org B' }])
  })

  it('does not reveal another organization by guessing ids', async () => {
    const guess = await asUser(db, ids.coordB, () => rows(`select * from public.tasks where id = '${ids.task1}'`))
    expect(guess).toEqual([])
    const profiles = await asUser(db, ids.coordB, () => rows(`select id from public.profiles where org_id = '${ids.orgA}'`))
    expect(profiles).toEqual([])
  })

  it('rejects every direct write from the browser, including into another organization', async () => {
    await expect(
      asUser(db, ids.coordB, () => db.exec(`insert into public.tasks (org_id, task_key, source, title) values ('${ids.orgA}', 'x', 'conversation', 'x')`)),
    ).rejects.toThrow(/permission denied/)
    await expect(asUser(db, ids.memberA, () => db.exec(`update public.profiles set role = 'coordinator' where id = '${ids.memberA}'`))).rejects.toThrow(
      /permission denied/,
    )
    await expect(asUser(db, ids.memberA, () => db.exec(`delete from public.audit_log`))).rejects.toThrow(/permission denied/)
  })
})

describe('role scopes', () => {
  it('shows a member only their own tasks, threads and decisions', async () => {
    const tasks = await asUser(db, ids.memberA, () => rows('select task_key from public.tasks'))
    expect(tasks.map((t) => t.task_key)).toEqual(['c_m_1'])
    const msgs = await asUser(db, ids.memberA, () => rows('select external_id from public.messages'))
    expect(msgs.map((m) => m.external_id)).toEqual(['m_1'])
  })

  it('never shows members the reminder drafts, audit log or other accounts', async () => {
    expect(await asUser(db, ids.memberA, () => rows('select id from public.reminder_drafts'))).toEqual([])
    expect(await asUser(db, ids.memberA, () => rows('select id from public.audit_log'))).toEqual([])
    const profiles = await asUser(db, ids.memberA, () => rows('select username from public.profiles'))
    expect(profiles).toEqual([{ username: 'member_a' }])
  })

  it('shows a team lead the tasks and drafts of the teams they lead, not others', async () => {
    const tasks = await asUser(db, ids.leadA, () => rows('select task_key from public.tasks'))
    expect(tasks.map((t) => t.task_key)).toEqual(['c_m_1'])
    const drafts = await asUser(db, ids.leadA, () => rows('select draft_key from public.reminder_drafts'))
    expect(drafts.map((d) => d.draft_key)).toEqual(['d_c_m_1'])
  })

  it('hides all organization data until a temporary password is changed', async () => {
    expect(await asUser(db, ids.mustChangeA, () => rows('select id from public.tasks'))).toEqual([])
    expect(await asUser(db, ids.mustChangeA, () => rows('select id from public.external_people'))).toEqual([])
    const self = await asUser(db, ids.mustChangeA, () => rows('select must_change_password from public.profiles'))
    expect(self).toEqual([{ must_change_password: true }])
  })

  it('hides data from disabled accounts', async () => {
    await db.exec(`update public.profiles set is_active = false where id = '${ids.member2A}'`)
    expect(await asUser(db, ids.member2A, () => rows('select id from public.tasks'))).toEqual([])
    await db.exec(`update public.profiles set is_active = true where id = '${ids.member2A}'`)
  })
})

describe('notifications', () => {
  it('shows only your own notifications, and quiet-hour reminders only once due', async () => {
    const mine = await asUser(db, ids.memberA, () => rows('select title from public.notifications'))
    expect(mine).toEqual([{ title: 'Now' }])
  })

  it('lets you mark only your own delivered notifications read', async () => {
    const n = await asUser(db, ids.memberA, async () => (await db.query<{ n: number }>('select public.mark_notifications_read() as n')).rows[0].n)
    expect(n).toBe(1)
    const other = await rows(`select read_at from public.notifications where event_key = 'e3'`)
    expect(other[0].read_at).toBeNull()
    const later = await rows(`select read_at from public.notifications where event_key = 'e2'`)
    expect(later[0].read_at).toBeNull()
  })
})

describe('audit log', () => {
  it('is append-only, even for the server', async () => {
    await expect(asService(db, () => db.exec(`update public.audit_log set action = 'changed'`))).rejects.toThrow(/append-only/)
    await expect(asService(db, () => db.exec(`delete from public.audit_log`))).rejects.toThrow(/append-only/)
  })
})

describe('apply_ops', () => {
  it('cannot be called from the browser', async () => {
    await expect(asUser(db, ids.coordA, () => db.query(`select public.apply_ops('[]')`))).rejects.toThrow(/permission denied/)
  })

  it('applies all operations or none', async () => {
    const ops = JSON.stringify([
      { op: 'insert', table: 'audit_log', row: { org_id: ids.orgA, action: 'atomic', entity_type: 'data', entity_id: 'y' } },
      { op: 'update', table: 'tasks', match: { id: ids.task1, row_version: 99 }, set: { title: 'x' }, require_rows: true },
    ])
    await expect(asService(db, () => db.query(`select public.apply_ops($1::jsonb)`, [ops]))).rejects.toThrow(/conflict/)
    expect(await rows(`select id from public.audit_log where action = 'atomic'`)).toEqual([])
  })

  it('updates with optimistic locking and upserts idempotently', async () => {
    const ops = JSON.stringify([
      { op: 'update', table: 'tasks', match: { id: ids.task1, row_version: 1 }, set: { title: 'Send it today', row_version: 2 }, require_rows: true },
      { op: 'upsert', table: 'task_events', conflict: ['org_id', 'event_key'], ignore_duplicates: true, row: { org_id: ids.orgA, task_id: ids.task1, event_key: 'k1', event_type: 'created', at: '2026-10-01T00:00:00Z' } },
      { op: 'upsert', table: 'task_events', conflict: ['org_id', 'event_key'], ignore_duplicates: true, row: { org_id: ids.orgA, task_id: ids.task1, event_key: 'k1', event_type: 'created', at: '2026-10-01T00:00:00Z' } },
    ])
    await asService(db, () => db.query(`select public.apply_ops($1::jsonb)`, [ops]))
    expect(await rows(`select title, row_version from public.tasks where id = '${ids.task1}'`)).toEqual([{ title: 'Send it today', row_version: 2 }])
    expect(await rows(`select count(*)::int as n from public.task_events where event_key = 'k1'`)).toEqual([{ n: 1 }])
  })
})

describe('file storage', () => {
  it('allows uploads only into your own organization folder', async () => {
    await expect(
      asUser(db, ids.memberA, () => db.exec(`insert into storage.objects (bucket_id, name) values ('task-attachments', '${ids.orgB}/r1/a.pdf')`)),
    ).rejects.toThrow(/row-level security/)
    await asUser(db, ids.memberA, () => db.exec(`insert into storage.objects (bucket_id, name) values ('task-attachments', '${ids.orgA}/r1/a.pdf')`))
  })

  it('lets only people who can read the task download the file', async () => {
    await db.exec(`insert into public.files (org_id, uploader_profile_id, task_id, original_name, object_path, mime, size_bytes, sha256)
      values ('${ids.orgA}', '${ids.memberA}', '${ids.task1}', 'a.pdf', '${ids.orgA}/r1/a.pdf', 'application/pdf', 10, '${'a'.repeat(64)}')`)
    const own = await asUser(db, ids.memberA, () => rows(`select name from storage.objects`))
    expect(own).toEqual([{ name: `${ids.orgA}/r1/a.pdf` }])
    expect(await asUser(db, ids.member2A, () => rows(`select name from storage.objects`))).toEqual([])
    expect(await asUser(db, ids.coordB, () => rows(`select name from storage.objects`))).toEqual([])
    expect(await asUser(db, ids.coordA, () => rows(`select name from storage.objects`))).toHaveLength(1)
  })
})

describe('gmail automation tables', () => {
  beforeAll(async () => {
    await db.exec(`
      insert into public.gmail_accounts (org_id, email, refresh_token_enc) values ('${ids.orgA}', 'coord@a.test', 'v1.sealed');
      insert into public.inbound_emails (org_id, gmail_message_id, gmail_thread_id, sent_at, subject) values ('${ids.orgA}', 'gm_1', 'th_1', now(), 'Deck');
      insert into public.automation_events (org_id, kind, message) values ('${ids.orgA}', 'ticket_created', 'Ticket created automatically');
    `)
  })

  it('stores each Gmail message once per workspace', async () => {
    await expect(db.exec(`insert into public.inbound_emails (org_id, gmail_message_id, gmail_thread_id, sent_at) values ('${ids.orgA}', 'gm_1', 'th_1', now())`)).rejects.toThrow(/duplicate key/)
  })

  it('never lets a signed-in user read stored OAuth tokens', async () => {
    await expect(asUser(db, ids.coordA, () => rows('select refresh_token_enc from public.gmail_accounts'))).rejects.toThrow(/permission denied/)
    await expect(asUser(db, ids.memberA, () => rows('select id from public.gmail_accounts'))).rejects.toThrow(/permission denied/)
  })

  it('shows emails and automation events to coordinators of the same workspace only', async () => {
    expect(await asUser(db, ids.coordA, () => rows('select subject from public.inbound_emails'))).toEqual([{ subject: 'Deck' }])
    expect((await asUser(db, ids.coordA, () => rows('select kind from public.automation_events'))).length).toBe(1)
    expect(await asUser(db, ids.coordB, () => rows('select id from public.inbound_emails'))).toEqual([])
    expect(await asUser(db, ids.memberA, () => rows('select id from public.inbound_emails'))).toEqual([])
    expect(await asUser(db, ids.memberA, () => rows('select id from public.automation_events'))).toEqual([])
  })

  it('lets the server write the new tables through apply_ops', async () => {
    await asService(db, () =>
      db.query(`select public.apply_ops($1::jsonb)`, [JSON.stringify([{ op: 'insert', table: 'automation_events', row: { org_id: ids.orgA, kind: 'email_detected', message: 'New email detected' } }])]),
    )
    expect((await rows(`select id from public.automation_events where org_id = '${ids.orgA}'`)).length).toBe(2)
  })
})

describe('slack tables', () => {
  const team = '40000000-0000-4000-8000-000000000001'
  beforeAll(async () => {
    await db.exec(`
      insert into public.slack_workspaces (id, org_id, team_id, team_name, bot_token_enc) values ('${team}', '${ids.orgA}', 'T1', 'Acme', 'v1.sealed');
      insert into public.slack_channels (org_id, slack_workspace_id, channel_id, name) values ('${ids.orgA}', '${team}', 'C1', 'launch');
      insert into public.slack_users (org_id, slack_user_id, email, person_external_id) values ('${ids.orgA}', 'U1', 'member@a.test', 'p_member');
    `)
  })

  it('never lets any signed-in role read Slack workspaces or bot tokens', async () => {
    for (const user of [ids.coordA, ids.leadA, ids.memberA, ids.coordB]) {
      await expect(asUser(db, user, () => rows('select bot_token_enc from public.slack_workspaces'))).rejects.toThrow(/permission denied/)
      await expect(asUser(db, user, () => rows('select id, team_name from public.slack_workspaces'))).rejects.toThrow(/permission denied/)
    }
  })

  it('shows Slack channels to coordinators and team leads of the same workspace only', async () => {
    expect(await asUser(db, ids.coordA, () => rows('select name, enabled from public.slack_channels'))).toEqual([{ name: 'launch', enabled: false }])
    expect(await asUser(db, ids.leadA, () => rows('select name from public.slack_channels'))).toEqual([{ name: 'launch' }])
    expect(await asUser(db, ids.coordB, () => rows('select id from public.slack_channels'))).toEqual([])
    expect(await asUser(db, ids.memberA, () => rows('select id from public.slack_channels'))).toEqual([])
  })

  it('shows the Slack user mapping to coordinators of the same workspace only', async () => {
    expect(await asUser(db, ids.coordA, () => rows('select slack_user_id from public.slack_users'))).toEqual([{ slack_user_id: 'U1' }])
    expect(await asUser(db, ids.leadA, () => rows('select id from public.slack_users'))).toEqual([])
    expect(await asUser(db, ids.coordB, () => rows('select id from public.slack_users'))).toEqual([])
  })

  it('keeps one row per Slack channel and lets the server write Slack tables through apply_ops', async () => {
    await expect(db.exec(`insert into public.slack_channels (org_id, slack_workspace_id, channel_id, name) values ('${ids.orgA}', '${team}', 'C1', 'again')`)).rejects.toThrow(/duplicate key/)
    await asService(db, () =>
      db.query(`select public.apply_ops($1::jsonb)`, [JSON.stringify([{ op: 'update', table: 'slack_channels', match: { org_id: ids.orgA, channel_id: 'C1' }, set: { enabled: true } }])]),
    )
    expect(await rows(`select enabled from public.slack_channels where channel_id = 'C1'`)).toEqual([{ enabled: true }])
  })
})

describe('knowledge base tables', () => {
  const space = '40000000-0000-4000-8000-000000000001'
  const spaceB = '40000000-0000-4000-8000-000000000002'
  const pub = '41000000-0000-4000-8000-000000000001'
  const draftM2 = '41000000-0000-4000-8000-000000000002'
  const draftM1 = '41000000-0000-4000-8000-000000000003'
  const pageB = '41000000-0000-4000-8000-000000000004'
  const titles = async (user: string) => (await asUser(db, user, () => rows('select title from public.kb_pages order by title'))).map((r) => r.title)

  beforeAll(async () => {
    await db.exec(`
      insert into public.kb_spaces (id, org_id, space_key, name) values ('${space}', '${ids.orgA}', 'eng', 'Engineering'), ('${spaceB}', '${ids.orgB}', 'eng', 'B space');
      insert into public.kb_pages (id, org_id, space_id, slug, title, body_md, status, owner_profile_id) values
        ('${pub}', '${ids.orgA}', '${space}', 'runbook', 'Runbook', 'How we deploy', 'published', '${ids.coordA}'),
        ('${draftM2}', '${ids.orgA}', '${space}', 'secret-draft', 'Secret draft', 'member two notes', 'draft', '${ids.member2A}'),
        ('${draftM1}', '${ids.orgA}', '${space}', 'my-draft', 'My draft', 'member one notes', 'draft', '${ids.memberA}'),
        ('${pageB}', '${ids.orgB}', '${spaceB}', 'b-page', 'B page', 'org b', 'published', '${ids.coordB}');
      insert into public.kb_page_versions (org_id, page_id, version, title, body_md, status) values
        ('${ids.orgA}', '${pub}', 1, 'Runbook', 'How we deploy (draft)', 'draft'),
        ('${ids.orgA}', '${pub}', 2, 'Runbook', 'How we deploy', 'published'),
        ('${ids.orgA}', '${draftM2}', 1, 'Secret draft', 'member two notes', 'draft');
    `)
  })

  it("shows members published pages and their own drafts, never another member's draft", async () => {
    expect(await titles(ids.memberA)).toEqual(['My draft', 'Runbook'])
    expect(await titles(ids.member2A)).toEqual(['Runbook', 'Secret draft'])
    expect(await asUser(db, ids.memberA, () => rows(`select id from public.kb_pages where id = '${draftM2}'`))).toEqual([])
  })

  it('shows coordinators and team leads every page of their own workspace', async () => {
    expect(await titles(ids.coordA)).toEqual(['My draft', 'Runbook', 'Secret draft'])
    expect(await titles(ids.leadA)).toEqual(['My draft', 'Runbook', 'Secret draft'])
  })

  it('keeps other workspaces out, even for published pages', async () => {
    expect(await titles(ids.coordB)).toEqual(['B page'])
    expect(await asUser(db, ids.coordB, () => rows('select id from public.kb_page_versions'))).toEqual([])
    expect(await asUser(db, ids.coordB, () => rows('select name from public.kb_spaces'))).toEqual([{ name: 'B space' }])
  })

  it('shows members only the published history of pages they do not own', async () => {
    expect(await asUser(db, ids.memberA, () => rows('select page_id, version from public.kb_page_versions order by version'))).toEqual([{ page_id: pub, version: 2 }])
    expect((await asUser(db, ids.coordA, () => rows('select id from public.kb_page_versions'))).length).toBe(3)
  })

  it('keeps one row per page version and never changes history', async () => {
    await expect(db.exec(`insert into public.kb_page_versions (org_id, page_id, version, title, status) values ('${ids.orgA}', '${pub}', 2, 'Dup', 'draft')`)).rejects.toThrow(/duplicate key/)
    await expect(asService(db, () => db.exec(`update public.kb_page_versions set title = 'changed'`))).rejects.toThrow(/append-only/)
    await expect(asService(db, () => db.exec(`delete from public.kb_page_versions where page_id = '${pub}'`))).rejects.toThrow(/append-only/)
  })

  it("rejects browser writes, duplicate slugs in a space and pages in another workspace's space", async () => {
    await expect(asUser(db, ids.coordA, () => db.exec(`update public.kb_pages set title = 'x'`))).rejects.toThrow(/permission denied/)
    await expect(db.exec(`insert into public.kb_pages (org_id, space_id, slug, title) values ('${ids.orgA}', '${space}', 'runbook', 'Again')`)).rejects.toThrow(/duplicate key/)
    await expect(db.exec(`insert into public.kb_pages (org_id, space_id, slug, title) values ('${ids.orgA}', '${spaceB}', 'cross', 'Cross')`)).rejects.toThrow(/foreign key/)
  })

  it('finds pages with the full-text index and saves through apply_ops with optimistic locking', async () => {
    expect(await rows(`select title from public.kb_pages where search_tsv @@ websearch_to_tsquery('simple', 'deploy')`)).toEqual([{ title: 'Runbook' }])
    const save = (rowVersion: number) =>
      JSON.stringify([
        { op: 'update', table: 'kb_pages', match: { id: pub, row_version: rowVersion }, set: { body_md: 'How we deploy, v3', version: 3, row_version: rowVersion + 1 }, require_rows: true },
        { op: 'insert', table: 'kb_page_versions', row: { org_id: ids.orgA, page_id: pub, version: 3, title: 'Runbook', body_md: 'How we deploy, v3', status: 'published' } },
      ])
    await asService(db, () => db.query('select public.apply_ops($1::jsonb)', [save(1)]))
    await expect(asService(db, () => db.query('select public.apply_ops($1::jsonb)', [save(1)]))).rejects.toThrow(/conflict/)
    expect(await rows(`select version, row_version from public.kb_pages where id = '${pub}'`)).toEqual([{ version: 3, row_version: 2 }])
  })

  it('allows one minutes page per email', async () => {
    const ins = (slug: string) => `insert into public.kb_pages (org_id, space_id, slug, title, source) values ('${ids.orgA}', '${space}', '${slug}', 'Minutes', '{"kind":"email","emailId":"e-1","threadId":"t"}')`
    await db.exec(ins('minutes-a'))
    await expect(db.exec(ins('minutes-b'))).rejects.toThrow(/duplicate key/)
  })
})
