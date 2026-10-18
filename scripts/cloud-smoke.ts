/**
 * Live end-to-end check of the Supabase backend through the real API routes.
 * Creates a throwaway workspace ("Smoke test <time>"), runs the main workflows, checks RLS with
 * real user sessions, then deletes everything it created. Never touches other workspaces.
 *
 *   npm run cloud:smoke            (needs the dev server on :5173 and .env.local)
 */
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import demo from '../src/mocks/demoDataset.json'

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8')
    .split(/\r?\n/)
    .filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
)
const URL = env.VITE_SUPABASE_URL
const BASE = process.env.SMOKE_BASE ?? 'http://localhost:5173'
const admin = createClient(URL, env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } })
const stamp = Date.now().toString(36)
const results: { name: string; ok: boolean; detail?: string }[] = []
const created: string[] = []
let orgId = ''

async function api(route: string, body: unknown, token?: string) {
  const res = await fetch(`${BASE}/api/cloud/${route}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  })
  return { status: res.status, body: (await res.json()) as any }
}

function check(name: string, ok: boolean, detail?: unknown) {
  results.push({ name, ok, detail: ok ? undefined : JSON.stringify(detail)?.slice(0, 300) })
}

function userClient(token: string) {
  return createClient(URL, env.VITE_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false }, global: { headers: { Authorization: `Bearer ${token}` } } })
}

async function main() {
  // 1. Signup creates the workspace, profile and three flows
  const coordPassword = `Smoke${stamp}Pass1`
  const signup = await api('auth/signup', { orgName: `Smoke test ${stamp}`, fullName: 'Smoke Coordinator', username: `smoke_c_${stamp}`, email: `smoke.c.${stamp}@example.com`, password: coordPassword, timezone: 'Asia/Kolkata', role: 'coordinator' })
  check('coordinator signup', signup.status === 201 && !!signup.body.session, signup)
  const coord = signup.body.session?.access_token as string
  const me = await api('auth/me', {}, coord)
  orgId = me.body.org?.id
  created.push(me.body.profile?.id)
  const { data: flows } = await admin.from('followup_flows').select('flow_key').eq('org_id', orgId)
  check('signup seeds three default flows', flows?.length === 3, flows)

  // 2. Members cannot sign up publicly
  const member = await api('auth/signup', { orgName: 'x', fullName: 'x', username: `smoke_m_${stamp}`, email: `smoke.m.${stamp}@example.com`, password: 'Abcdefgh123', timezone: 'UTC', role: 'member' })
  check('public member signup is refused', member.status === 400, member)

  // 3. Username and email login; wrong password is generic
  check('login by username', (await api('auth/login', { identifier: `smoke_c_${stamp}`, password: coordPassword })).status === 200)
  check('login by email', (await api('auth/login', { identifier: `smoke.c.${stamp}@example.com`, password: coordPassword })).status === 200)
  const wrong = await api('auth/login', { identifier: `smoke_c_${stamp}`, password: 'nope-nope-1' })
  const nobody = await api('auth/login', { identifier: `nobody_${stamp}`, password: 'nope-nope-1' })
  check('wrong password and unknown user get the same answer', wrong.status === 401 && nobody.status === 401 && wrong.body.error.message === nobody.body.error.message, [wrong, nobody])

  // 4. Import is idempotent and the engine syncs tasks and drafts
  const imp = await api('data/import', { name: 'Synthetic demo data', source: 'demo', format: 'json', dataset: demo }, coord)
  check('import demo data', imp.status === 201, imp)
  const again = await api('data/import', { name: 'Synthetic demo data', source: 'demo', format: 'json', dataset: demo }, coord)
  check('same import twice is refused', again.status === 409, again)
  const { count: taskCount } = await admin.from('tasks').select('id', { count: 'exact', head: true }).eq('org_id', orgId)
  const { count: draftCount } = await admin.from('reminder_drafts').select('id', { count: 'exact', head: true }).eq('org_id', orgId)
  check('engine sync wrote tasks and drafts', (taskCount ?? 0) >= 10 && (draftCount ?? 0) >= 1, { taskCount, draftCount })
  const run1 = await api('engine/run', { trigger: 'manual' }, coord)
  const run2 = await api('engine/run', { trigger: 'manual' }, coord)
  const { count: taskCount2 } = await admin.from('tasks').select('id', { count: 'exact', head: true }).eq('org_id', orgId)
  check('repeated engine runs change nothing and duplicate nothing', run1.body.changed?.tasks === 0 && run2.body.changed?.drafts === 0 && taskCount2 === taskCount, { run1: run1.body, run2: run2.body })
  const { data: closedDrafts } = await admin.from('reminder_drafts').select('state, tasks!inner(status)').eq('org_id', orgId).in('tasks.status', ['done', 'cancelled', 'deferred']).in('state', ['pending_review', 'approved'])
  check('no active reminder for closed work', (closedDrafts ?? []).length === 0, closedDrafts)

  // 5. Coordinator creates a member linked to imported person Lena; temporary password must be changed
  const acct = await api('accounts/create', { fullName: 'Lena Ortiz', username: `smoke_lena_${stamp}`, timezone: 'Europe/London', role: 'member', personExternalId: 'p_lena' }, coord)
  check('coordinator creates a member account', acct.status === 201 && typeof acct.body.temporaryPassword === 'string', acct)
  created.push(acct.body.account?.id)
  const firstLogin = await api('auth/login', { identifier: `smoke_lena_${stamp}`, password: acct.body.temporaryPassword })
  check('temporary password signs in but must be changed', firstLogin.status === 200 && firstLogin.body.mustChangePassword === true, firstLogin)
  const lenaTemp = firstLogin.body.session?.access_token
  const blocked = await api('tasks/decide', { taskKey: 'c_m_21', type: 'set_progress', input: { progress: 'in_progress' } }, lenaTemp)
  check('server refuses work until the password is changed', blocked.status === 403 && blocked.body.error.code === 'must_change_password', blocked)
  const { data: hidden } = await userClient(lenaTemp).from('tasks').select('id')
  check('RLS hides data until the password is changed', (hidden ?? []).length === 0, hidden)
  const lenaPassword = `Lena${stamp}Pass9`
  check('member changes the temporary password', (await api('auth/change-password', { password: lenaPassword }, lenaTemp)).status === 200)
  const lena = (await api('auth/login', { identifier: `smoke_lena_${stamp}`, password: lenaPassword })).body.session.access_token
  await api('engine/run', { trigger: 'manual' }, coord)

  // 6. RLS: Lena sees only her tasks, no drafts, no audit, no other accounts
  const lc = userClient(lena)
  const { data: lenaTasks } = await lc.from('tasks').select('task_key, owner_person')
  check('member sees only their own tasks', (lenaTasks ?? []).length > 0 && lenaTasks!.every((t) => t.owner_person === 'p_lena'), lenaTasks)
  const { data: lenaDrafts } = await lc.from('reminder_drafts').select('id')
  const { data: lenaAudit } = await lc.from('audit_log').select('actor_profile_id, subject_profile_id, entity_type, entity_id')
  const { data: lenaProfiles } = await lc.from('profiles').select('id')
  const lenaId = acct.body.account.id
  const ownTaskKeys = new Set((lenaTasks ?? []).map((t) => t.task_key))
  const onlyHers = (lenaAudit ?? []).every((a) => a.actor_profile_id === lenaId || a.subject_profile_id === lenaId || (a.entity_type === 'task' && ownTaskKeys.has(a.entity_id)))
  check('member sees no drafts, no other accounts, and only audit events about themselves or their tasks', !lenaDrafts?.length && onlyHers && lenaProfiles?.length === 1, { lenaDrafts, lenaAudit, lenaProfiles })
  const { error: writeErr } = await lc.from('tasks').update({ title: 'hacked' }).eq('task_key', 'c_m_21')
  check('member cannot write tables directly', !!writeErr, writeErr)

  // 7. Workflow: progress, submit, self-review refused, coordinator rejects without note refused, approves
  const lenaTask = lenaTasks!.find((t) => t.task_key === 'c_m_21')?.task_key ?? lenaTasks![0].task_key
  check('member reports progress', (await api('tasks/decide', { taskKey: lenaTask, type: 'set_progress', input: { progress: 'in_progress' } }, lena)).status === 200)
  const notOwner = await api('tasks/decide', { taskKey: 'c_m_03', type: 'set_progress', input: { progress: 'in_progress' } }, lena)
  check("member cannot act on someone else's task", notOwner.status === 404 || notOwner.status === 403, notOwner)
  const memberApprove = await api('tasks/decide', { taskKey: lenaTask, type: 'mark_done', input: {} }, lena)
  check('member cannot close work', memberApprove.status === 403, memberApprove)
  check('member submits work', (await api('tasks/decide', { taskKey: lenaTask, type: 'submit_work', input: { note: 'Done, see notes' } }, lena)).status === 200)
  const { data: subs } = await admin.from('submissions').select('submission_key, status').eq('org_id', orgId)
  const sub = subs?.[0]?.submission_key
  const noNote = await api('tasks/decide', { taskKey: lenaTask, type: 'reject_submission', input: { submissionId: sub } }, coord)
  check('rejecting needs a note', noNote.status === 400, noNote)
  const { data: taskRow } = await admin.from('tasks').select('row_version').eq('org_id', orgId).eq('task_key', lenaTask).single()
  const stale = await api('tasks/decide', { taskKey: lenaTask, type: 'approve_submission', input: { submissionId: sub }, expectedVersion: (taskRow?.row_version ?? 1) - 1 }, coord)
  check('stale version gets a conflict', stale.status === 409, stale)
  const approve = await api('tasks/decide', { taskKey: lenaTask, type: 'approve_submission', input: { submissionId: sub }, expectedVersion: taskRow?.row_version }, coord)
  check('coordinator approves the submission', approve.status === 200, approve)
  const { data: done } = await admin.from('tasks').select('status, review_state').eq('org_id', orgId).eq('task_key', lenaTask).single()
  check('approval marks the task done', done?.status === 'done' && done.review_state === 'approved', done)
  const { data: doneDraft } = await admin.from('reminder_drafts').select('state').eq('org_id', orgId).eq('task_key', lenaTask).maybeSingle()
  check('approval suppresses the reminder', !doneDraft || doneDraft.state === 'suppressed', doneDraft)

  // 8. Notifications reach Lena (and only Lena)
  const { data: notes } = await lc.from('notifications').select('type, title')
  check('member gets workflow notifications', (notes ?? []).some((n) => n.type === 'submission_approved'), notes)
  const { data: read } = await lc.rpc('mark_notifications_read', { p_ids: null })
  check('member marks notifications read', typeof read === 'number' && read > 0, read)

  // 9. Comments with mentions, and files with permission checks
  const comment = await api('comments/add', { taskKey: lenaTask, body: `Thanks @smoke_lena_${stamp}!` }, coord)
  check('comment with mention', comment.status === 201, comment)
  const path = `${orgId}/${stamp}/notes.txt`
  const { error: upErr } = await lc.storage.from('task-attachments').upload(path, new Blob(['hello world'], { type: 'text/plain' }))
  check('member uploads into own workspace folder', !upErr, upErr)
  const reg = await api('files/register', { objectPath: path, originalName: 'notes.txt', taskKey: lenaTask }, lena)
  check('server registers the file with its hash', reg.status === 201 && reg.body.file?.sha256?.length === 64, reg)
  const { error: foreignErr } = await lc.storage.from('task-attachments').upload(`00000000-0000-4000-8000-000000000000/${stamp}/x.txt`, new Blob(['x']))
  check('upload into another workspace folder is refused', !!foreignErr, foreignErr)
  const { error: svgErr } = await lc.storage.from('task-attachments').upload(`${orgId}/${stamp}/evil.svg`, new Blob(['<svg/>'], { type: 'image/svg+xml' }))
  check('SVG upload is refused by the bucket', !!svgErr, svgErr)
  const fakePath = `${orgId}/${stamp}/photo.png`
  await lc.storage.from('task-attachments').upload(fakePath, new Blob(['<svg onload="x()"/>'], { type: 'image/png' }))
  const fake = await api('files/register', { objectPath: fakePath, originalName: 'photo.png' }, lena)
  const { data: gone } = await admin.storage.from('task-attachments').list(`${orgId}/${stamp}`, { search: 'photo.png' })
  check('SVG renamed to .png is refused and removed', fake.status === 400 && (gone ?? []).length === 0, { fake, gone })
  const url = await api('files/url', { id: reg.body.file?.id }, coord)
  check('coordinator gets a short-lived download link', url.status === 200 && typeof url.body.url === 'string', url)

  // 10. Audit is append-only and recorded
  const { count: auditCount } = await admin.from('audit_log').select('id', { count: 'exact', head: true }).eq('org_id', orgId)
  check('audit log recorded the workflow', (auditCount ?? 0) >= 8, auditCount)
  const { error: auditErr } = await admin.from('audit_log').update({ action: 'x' }).eq('org_id', orgId)
  check('audit log rejects edits even from the server', !!auditErr, auditErr)

  // 12. Team member signs up, asks to join, the coordinator approves; the member then works in the workspace
  const memberSignup = await api('auth/signup-member', { fullName: 'Ganesh Rao', username: `smoke_g_${stamp}`, password: `Ganesh${stamp}9x`, timezone: 'Asia/Kolkata' })
  check('team member signs up without a workspace', memberSignup.status === 201 && !!memberSignup.body.session, memberSignup)
  const ganesh = memberSignup.body.session?.access_token
  const gMe = await api('auth/me', {}, ganesh)
  created.push(gMe.body.profile?.id)
  check('new member has no workspace yet', gMe.body.org === null, gMe.body)
  const blockedTask = await api('tasks/decide', { taskKey: lenaTask, type: 'set_progress', input: { progress: 'in_progress' } }, ganesh)
  check('member without a workspace cannot touch tasks', blockedTask.status === 403, blockedTask)
  const list = await api('workspaces/list', {}, ganesh)
  check('member sees the workspace in the list', (list.body.workspaces ?? []).some((w: any) => w.id === orgId && w.status === 'none'), list.body)
  const ask = await api('workspaces/request', { orgId }, ganesh)
  const askAgain = await api('workspaces/request', { orgId }, ganesh)
  check('join request saved once, duplicates refused', ask.status === 201 && askAgain.status === 409, [ask, askAgain])
  const { data: coordNotes } = await userClient(coord).from('notifications').select('type, title').eq('type', 'join_request')
  check('coordinator gets a persistent join-request notification', (coordNotes ?? []).length === 1, coordNotes)
  const reqs = await api('workspaces/requests', {}, coord)
  const pendingReq = (reqs.body.requests ?? []).find((r: any) => r.status === 'pending')
  const memberDecides = await api('workspaces/decide', { requestId: pendingReq?.id, approve: true }, lena)
  check('a team member cannot approve join requests', memberDecides.status === 403, memberDecides)
  const approveJoin = await api('workspaces/decide', { requestId: pendingReq?.id, approve: true }, coord)
  check('coordinator approves the join request', approveJoin.status === 200, approveJoin)
  const gMe2 = await api('auth/me', {}, ganesh)
  check('member now belongs to the workspace', gMe2.body.org?.id === orgId, gMe2.body)
  const { data: gAudit } = await userClient(ganesh).from('audit_log').select('action')
  check('member sees their own audit history (join request and approval)', (gAudit ?? []).some((a) => a.action === 'workspace.join_approved') && (gAudit ?? []).some((a) => a.action === 'workspace.join_request'), gAudit)
  const { data: gNotes } = await userClient(ganesh).from('notifications').select('type')
  check('member is notified of the approval', (gNotes ?? []).some((n) => n.type === 'join_approved'), gNotes)

  // 13. Assigning with start and end dates; end before start is refused
  const badRange = await api('tasks/create', { title: 'Bad range', ownerIds: [gMe2.body.person.id], startAt: '2026-12-02T10:00:00Z', dueAt: '2026-12-01T10:00:00Z' }, coord)
  check('end before start is refused', badRange.status === 400, badRange)
  const assigned = await api('tasks/create', { title: 'Prepare the FAQ', ownerIds: [gMe2.body.person.id], startAt: '2026-12-01T04:30:00Z', dueAt: '2026-12-03T12:30:00Z', description: 'Ten questions', priority: 'high' }, coord)
  check('task with start, end, description and priority is saved', assigned.status === 201, assigned)
  const { data: gTasks } = await userClient(ganesh).from('tasks').select('title, start_at, due_at, priority')
  check('member sees the assigned task with its dates', (gTasks ?? []).some((t) => t.title === 'Prepare the FAQ' && t.start_at && t.due_at && t.priority === 'high'), gTasks)

  // 14. First password for coordinator-created accounts is username + 1, and must be changed
  const ravi = await api('accounts/create', { fullName: 'Ravi Kumar', username: `ravi_${stamp}`, timezone: 'Asia/Kolkata', role: 'member' }, coord)
  created.push(ravi.body.account?.id)
  check('first password is username + 1', ravi.body.temporaryPassword === `ravi_${stamp}1`, ravi.body)
  const raviLogin = await api('auth/login', { identifier: `ravi_${stamp}`, password: `ravi_${stamp}1` })
  check('username + 1 signs in and must be changed', raviLogin.status === 200 && raviLogin.body.mustChangePassword === true, raviLogin.body)

  // 11. Disabling blocks sign-in
  check('coordinator disables the member', (await api('accounts/set-active', { profileId: acct.body.account.id, active: false }, coord)).status === 200)
  const disabled = await api('auth/login', { identifier: `smoke_lena_${stamp}`, password: lenaPassword })
  check('disabled account cannot sign in', disabled.status === 403, disabled)
  const selfDisable = await api('accounts/set-active', { profileId: me.body.profile.id, active: false }, coord)
  check('coordinator cannot disable themselves', selfDisable.status === 400, selfDisable)
}

async function cleanup() {
  if (orgId) {
    await admin.storage.from('task-attachments').list(orgId).then(async ({ data }) => {
      for (const dir of data ?? []) {
        const { data: files } = await admin.storage.from('task-attachments').list(`${orgId}/${dir.name}`)
        await admin.storage.from('task-attachments').remove((files ?? []).map((f) => `${orgId}/${dir.name}/${f.name}`))
      }
    })
  }
  for (const id of created.filter(Boolean)) await admin.auth.admin.deleteUser(id)
  if (orgId) await admin.from('organizations').delete().eq('id', orgId)
}

main()
  .catch((e) => check('script finished', false, e instanceof Error ? e.message : e))
  .finally(async () => {
    await cleanup()
    const failed = results.filter((r) => !r.ok)
    for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? `  ${r.detail}` : ''}`)
    console.log(`\n${results.length - failed.length}/${results.length} passed (test workspace deleted)`)
    process.exit(failed.length ? 1 : 0)
  })
