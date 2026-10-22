import type { ApiRequest } from '../../handlers'
import { admin, applyOps } from '../admin'
import { requireRole, requireUser } from '../context'
import { decryptSecret, encryptSecret, signState } from '../crypto'
import { bad, bodyOf, json, notFound, rateLimit, str } from '../http'
import { auditOp } from '../notify'
import { exchangeSlackCode, listChannels, readSlackState, requireSlack, revokeSlack, SlackApiError, slackAuthUrl } from '../slack'
import { slackStatus, syncSlack } from '../slackSync'
import { query, redirect } from './automation'

// Slack OAuth v2 and channel settings. Coordinators connect, choose channels and disconnect;
// team leads may look. Tokens never leave the server.

async function event(orgId: string, kind: string, message: string): Promise<void> {
  await admin().from('automation_events').insert({ org_id: orgId, kind, message: message.slice(0, 500) })
}

/** Starts Slack OAuth v2 for the workspace. 503 slack_not_configured until the app credentials exist. */
export async function slackConnect(req: ApiRequest) {
  const ctx = await requireUser(req)
  requireRole(ctx, 'coordinator')
  requireSlack()
  return json(200, { url: slackAuthUrl(signState({ kind: 'slack', org: ctx.orgId, profile: ctx.userId })) })
}

/** Slack redirects here after the install. The signed state proves this server started the request. */
export async function slackCallback(req: ApiRequest) {
  const fail = (reason: string) => redirect(`/automation?slack=error&reason=${encodeURIComponent(reason)}`)
  if (query(req, 'error')) return fail(query(req, 'error') === 'access_denied' ? 'You cancelled the Slack install.' : 'Slack returned an error.')
  const state = readSlackState(query(req, 'state'))
  if (!state) return fail('The connection link expired. Try Connect Slack again.')
  const code = query(req, 'code')
  if (!code) return fail('Slack did not return an authorization code.')
  try {
    const oauth = await exchangeSlackCode(code)
    const { data: saved, error } = await admin()
      .from('slack_workspaces')
      .upsert(
        { org_id: state.org, team_id: oauth.teamId, team_name: oauth.teamName, bot_token_enc: encryptSecret(oauth.accessToken), scope: oauth.scope, connected_by: state.profile, status: 'connected', last_error: null, updated_at: new Date().toISOString() },
        { onConflict: 'org_id,team_id' },
      )
      .select('id')
      .single()
    if (error || !saved) throw new Error('could not store the Slack workspace')
    const channels = await listChannels(oauth.accessToken)
    // Name and privacy only: an existing channel keeps its enabled flag and cursor
    if (channels.length) {
      await admin()
        .from('slack_channels')
        .upsert(
          channels.map((c) => ({ org_id: state.org, slack_workspace_id: saved.id, channel_id: c.id, name: c.name.slice(0, 120), is_private: c.isPrivate })),
          { onConflict: 'org_id,channel_id' },
        )
    }
    await applyOps([auditOp(state.org, state.profile, null, 'slack.connect', 'slack', oauth.teamId, null, { team: oauth.teamName, scope: oauth.scope, channels: channels.length })])
    await event(state.org, 'slack_connected', `Slack connected: ${oauth.teamName ?? oauth.teamId} (read-only, ${channels.length} channels found, none imported until enabled)`)
    return redirect('/automation?slack=connected')
  } catch (e) {
    console.error('slack callback failed', e instanceof SlackApiError ? e.code : e instanceof Error ? e.message : 'unknown')
    return fail(e instanceof SlackApiError ? `Slack refused the connection (${e.code}).` : 'Could not finish connecting Slack. Check the server Slack settings and try again.')
  }
}

export async function slackChannels(req: ApiRequest) {
  const ctx = await requireUser(req)
  requireRole(ctx, 'coordinator', 'team_lead')
  return json(200, await slackStatus(ctx.orgId))
}

export async function slackChannelToggle(req: ApiRequest) {
  const ctx = await requireUser(req)
  requireRole(ctx, 'coordinator')
  const b = bodyOf(req)
  const channelId = str(b, 'channelId', { max: 40 })
  if (typeof b.enabled !== 'boolean') throw bad('enabled must be true or false')
  const { data } = await admin().from('slack_channels').update({ enabled: b.enabled }).eq('org_id', ctx.orgId).eq('channel_id', channelId).select('name')
  if (!data?.length) throw notFound('Slack channel not found')
  const name = data[0].name as string
  await applyOps([auditOp(ctx.orgId, ctx.userId, ctx.person.id, b.enabled ? 'slack.channel_enable' : 'slack.channel_disable', 'slack_channel', channelId, null, { name })])
  await event(ctx.orgId, b.enabled ? 'slack_channel_enabled' : 'slack_channel_disabled', `${ctx.person.name} ${b.enabled ? 'enabled' : 'disabled'} Slack channel #${name}`)
  return json(200, { ok: true, message: b.enabled ? `#${name} will be imported on the next sync` : `#${name} will no longer be imported` })
}

/** Revokes the bot token (best effort) and deletes it. Imported messages and tasks are kept. */
export async function slackDisconnect(req: ApiRequest) {
  const ctx = await requireUser(req)
  requireRole(ctx, 'coordinator')
  const id = str(bodyOf(req), 'workspaceId', { max: 64 })
  const { data: w } = await admin().from('slack_workspaces').select('id, team_id, team_name, bot_token_enc').eq('org_id', ctx.orgId).eq('id', id).maybeSingle()
  if (!w) throw notFound('Slack workspace not found')
  if (w.bot_token_enc) {
    try {
      await revokeSlack(decryptSecret(w.bot_token_enc as string))
    } catch {
      // Revoking is best effort; the stored token is deleted either way
    }
  }
  await admin().from('slack_workspaces').delete().eq('id', w.id)
  await applyOps([auditOp(ctx.orgId, ctx.userId, ctx.person.id, 'slack.disconnect', 'slack', w.team_id as string, { team: w.team_name }, null)])
  await event(ctx.orgId, 'slack_disconnected', `Slack disconnected: ${w.team_name ?? w.team_id}. Token deleted; imported messages are kept.`)
  return json(200, { ok: true, message: 'Slack disconnected and its token deleted' })
}

export async function slackSyncNow(req: ApiRequest) {
  const ctx = await requireUser(req)
  requireRole(ctx, 'coordinator')
  rateLimit(`slack-sync:${ctx.orgId}`, 10, 60_000)
  const r = await syncSlack(ctx.orgId, fetch, 0)
  return json(200, { ok: true, ...r, message: `Imported ${r.imported} new Slack messages${r.errors.length ? `. Errors: ${r.errors.join('; ')}` : ''}` })
}
