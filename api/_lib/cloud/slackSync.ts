import { admin, applyOps, type Op } from './admin'
import { decryptSecret } from './crypto'
import { channelHistory, compareTs, slackConfig, SlackApiError, SlackRevokedError, userInfo, type Fetch } from './slack'
import { messageOps, slackPersonId, slackToMessage, type ParsedSlackMessage, type SlackAuthor } from './slackMessage'
import { syncOrg } from './sync'

// Enabled Slack channels -> messages rows -> one engine run. Logs counts and error codes only,
// never tokens or message text.

const INITIAL_DAYS = 14
const OPS_PER_BATCH = 200

async function slackEvent(orgId: string, kind: 'slack_message_detected' | 'slack_error', message: string, detail: Record<string, unknown>): Promise<void> {
  await admin().from('automation_events').insert({ org_id: orgId, kind, message: message.slice(0, 500), detail })
}

interface Directory {
  byEmail: Map<string, { id: string; name: string; timezone: string }>
  bySlackUser: Map<string, SlackAuthor>
  bots: Set<string>
}

async function loadDirectory(orgId: string): Promise<Directory> {
  const [{ data: people }, { data: profiles }, { data: users }] = await Promise.all([
    admin().from('external_people').select('external_id, name, timezone, email').eq('org_id', orgId),
    admin().from('profiles').select('person_id, email').eq('org_id', orgId),
    admin().from('slack_users').select('slack_user_id, real_name, person_external_id').eq('org_id', orgId),
  ])
  const byId = new Map((people ?? []).map((p) => [p.external_id as string, { id: p.external_id as string, name: p.name as string, timezone: (p.timezone as string) || 'UTC' }]))
  const byEmail = new Map<string, { id: string; name: string; timezone: string }>()
  for (const p of people ?? []) if (p.email) byEmail.set((p.email as string).toLowerCase(), byId.get(p.external_id as string)!)
  for (const p of profiles ?? []) {
    const person = byId.get(p.person_id as string)
    if (p.email && person && !byEmail.has((p.email as string).toLowerCase())) byEmail.set((p.email as string).toLowerCase(), person)
  }
  const bySlackUser = new Map<string, SlackAuthor>()
  for (const u of users ?? []) {
    const person = byId.get((u.person_external_id as string | null) ?? '')
    if (person) bySlackUser.set(u.slack_user_id as string, { personId: person.id, name: person.name, timezone: person.timezone })
  }
  return { byEmail, bySlackUser, bots: new Set() }
}

/** Looks up an unknown Slack author once: matched by email to an existing person, else a new person `slack_<user>`. */
async function resolveAuthor(orgId: string, token: string, user: string, dir: Directory, f: Fetch): Promise<void> {
  const info = await userInfo(token, user, f).catch((e: unknown) => {
    // A deleted or foreign user still gets a placeholder person so the line stays readable
    if (e instanceof SlackApiError) return { id: user, name: user, email: null, timezone: null, isBot: false }
    throw e
  })
  if (info.isBot) {
    dir.bots.add(user)
    return
  }
  const match = info.email ? dir.byEmail.get(info.email) : undefined
  const ops: Op[] = []
  let author: SlackAuthor
  if (match) author = { personId: match.id, name: match.name, timezone: match.timezone }
  else {
    author = { personId: slackPersonId(user), name: info.name, timezone: info.timezone || 'UTC' }
    ops.push({ op: 'upsert', table: 'external_people', conflict: ['org_id', 'external_id'], ignore_duplicates: true, row: { org_id: orgId, external_id: author.personId, name: info.name, timezone: author.timezone, role: 'member', email: info.email } })
  }
  ops.push({ op: 'upsert', table: 'slack_users', conflict: ['org_id', 'slack_user_id'], row: { org_id: orgId, slack_user_id: user, email: info.email, real_name: info.name, person_external_id: author.personId } })
  await applyOps(ops)
  dir.bySlackUser.set(user, author)
}

interface ChannelRow {
  id: string
  channel_id: string
  name: string
  cursor_ts: string | null
}

/** Imports one channel. Returns how many messages were new. */
async function syncChannel(orgId: string, token: string, ch: ChannelRow, dir: Directory, f: Fetch): Promise<number> {
  const now = Date.now()
  const oldest = ch.cursor_ts ?? String(Math.floor(now / 1000) - INITIAL_DAYS * 86_400)
  const raw = await channelHistory(token, ch.channel_id, oldest, f)
  const users = new Set<string>()
  for (const m of raw) {
    if (!m.user || m.bot_id) continue
    users.add(m.user)
    for (const hit of (m.text ?? '').matchAll(/<@([A-Z0-9]+)/g)) users.add(hit[1])
  }
  for (const user of users) if (!dir.bySlackUser.has(user) && !dir.bots.has(user)) await resolveAuthor(orgId, token, user, dir, f)
  const rows = raw.map((m) => slackToMessage(m, ch.channel_id, (u) => dir.bySlackUser.get(u))).filter((r): r is ParsedSlackMessage => !!r)
  let added = 0
  for (let i = 0; i < rows.length; i += OPS_PER_BATCH) {
    const ops = messageOps(orgId, ch.name, rows.slice(i, i + OPS_PER_BATCH))
    const results = await applyOps(ops)
    added += results.filter((r, j) => ops[j].table === 'messages' && r !== null).length
  }
  const newest = raw.filter((m) => !m.thread_ts || m.thread_ts === m.ts).reduce<string | null>((max, m) => (!max || compareTs(m.ts, max) > 0 ? m.ts : max), ch.cursor_ts)
  await admin().from('slack_channels').update({ cursor_ts: newest, last_sync_at: new Date(now).toISOString() }).eq('id', ch.id)
  return added
}

/** One Slack round for a workspace: every enabled channel of every connected Slack team. */
export async function syncSlack(orgId: string, f: Fetch = fetch, minIntervalMs = 45_000): Promise<{ imported: number; errors: string[] }> {
  const { data: teams } = await admin().from('slack_workspaces').select('id, team_name, bot_token_enc, last_sync_at').eq('org_id', orgId).neq('status', 'revoked').not('bot_token_enc', 'is', null)
  let imported = 0
  const errors: string[] = []
  for (const t of teams ?? []) {
    if (t.last_sync_at && Date.now() - Date.parse(t.last_sync_at as string) < minIntervalMs) continue
    const team = (t.team_name as string | null) ?? 'Slack'
    const { data: channels } = await admin().from('slack_channels').select('id, channel_id, name, cursor_ts').eq('slack_workspace_id', t.id).eq('enabled', true)
    let lastError: string | null = null
    let revoked = false
    try {
      const token = decryptSecret(t.bot_token_enc as string)
      const dir = await loadDirectory(orgId)
      for (const ch of (channels ?? []) as ChannelRow[]) {
        try {
          const added = await syncChannel(orgId, token, ch, dir, f)
          imported += added
          if (added) await slackEvent(orgId, 'slack_message_detected', `${added} new Slack message${added === 1 ? '' : 's'} in #${ch.name}`, { channel: ch.channel_id, count: added })
        } catch (e) {
          if (e instanceof SlackRevokedError) throw e
          const code = e instanceof SlackApiError ? e.code : 'sync_failed'
          lastError = `#${ch.name}: ${code === 'not_in_channel' ? 'invite the FollowThru app to this channel' : code}`
          errors.push(`Slack ${lastError}`)
          await slackEvent(orgId, 'slack_error', `Slack sync of #${ch.name} failed: ${code}`, { channel: ch.channel_id, code })
        }
      }
    } catch (e) {
      revoked = e instanceof SlackRevokedError
      lastError = revoked ? (e as Error).message : 'Slack sync failed'
      errors.push(`Slack ${team}: ${lastError}`)
      await slackEvent(orgId, 'slack_error', `Slack sync for ${team} failed: ${lastError}`, { code: revoked ? 'revoked' : 'sync_failed' })
    }
    await admin()
      .from('slack_workspaces')
      .update({ status: revoked ? 'revoked' : lastError ? 'error' : 'connected', last_error: lastError?.slice(0, 300) ?? null, last_sync_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', t.id)
  }
  if (imported > 0) await syncOrg(orgId, null, 'write')
  return { imported, errors }
}

/** Slack status for the Automation page: never the token column. */
export async function slackStatus(orgId: string) {
  const [{ data: workspaces }, { data: channels }] = await Promise.all([
    admin().from('slack_workspaces').select('id, team_id, team_name, scope, status, last_sync_at, last_error, created_at').eq('org_id', orgId),
    admin().from('slack_channels').select('id, slack_workspace_id, channel_id, name, is_private, enabled, last_sync_at').eq('org_id', orgId).order('name'),
  ])
  return { configured: slackConfig().configured, workspaces: workspaces ?? [], channels: channels ?? [] }
}
