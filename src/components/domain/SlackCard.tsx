import { Button, Card, CardHeader, CardTitle } from '../ui'
import { Notice, useActionNotice } from './parts'
import { shortTime } from './view'
import { callApi } from '../../cloud/api'

export interface SlackStatus {
  configured: boolean
  workspaces: { id: string; team_id: string; team_name: string | null; status: string; last_sync_at: string | null; last_error: string | null }[]
  channels: { id: string; slack_workspace_id: string; channel_id: string; name: string; is_private: boolean; enabled: boolean; last_sync_at: string | null }[]
}

/** Slack status, channel choice and actions on the Automation page. Nothing is imported until a channel is enabled. */
export function SlackCard({ slack, onChange }: { slack: SlackStatus | undefined; onChange: () => Promise<void> }) {
  const notice = useActionNotice()
  const act = (route: string, body: Record<string, unknown>) =>
    notice.run(async () => {
      const r = await callApi<{ message: string }>(route, body)
      await onChange()
      return r.ok ? { ok: true, message: r.data.message } : { ok: false, message: r.error.message }
    })

  return (
    <Card>
      <CardHeader>
        <CardTitle>Slack</CardTitle>
        <span className="text-xs text-text-faint">Read-only bot · chosen channels only</span>
      </CardHeader>
      {!slack ? (
        <p className="text-sm text-text-muted">Loading…</p>
      ) : (
        <div className="flex flex-col gap-3">
          {!slack.configured ? (
            <p className="rounded-md border border-status-tentative/40 p-2 text-xs text-status-tentative">
              Slack is not configured on the server yet (SLACK_CLIENT_ID, SLACK_CLIENT_SECRET, SLACK_REDIRECT_URI). See docs/slack-integration.md.
            </p>
          ) : null}
          {slack.configured && slack.workspaces.length === 0 ? <p className="text-sm text-text-muted">No Slack workspace connected.</p> : null}
          {slack.workspaces.map((w) => {
            const channels = slack.channels.filter((c) => c.slack_workspace_id === w.id)
            return (
              <div key={w.id} className="rounded-md border border-surface-border p-2 text-sm">
                <p className="font-semibold text-text-primary">{w.team_name ?? w.team_id}</p>
                <p className={w.status === 'connected' ? 'text-xs text-status-done' : 'text-xs text-status-overdue'}>
                  {w.status === 'connected' ? 'Connected' : w.status === 'revoked' ? 'Access revoked: connect again' : 'Sync error'} · last sync {w.last_sync_at ? shortTime(w.last_sync_at) : 'not yet'}
                </p>
                {w.last_error ? <p className="text-xs text-status-overdue">{w.last_error}</p> : null}
                {channels.length === 0 ? <p className="mt-1 text-xs text-text-muted">No channels visible to the app.</p> : null}
                <ul className="mt-1 flex max-h-48 flex-col gap-1 overflow-y-auto">
                  {channels.map((c) => (
                    <li key={c.id}>
                      <label className="flex items-center gap-2 text-xs">
                        <input type="checkbox" checked={c.enabled} disabled={notice.busy} onChange={(e) => void act('slack/channel-toggle', { channelId: c.channel_id, enabled: e.target.checked })} />
                        <span className="text-text-primary">#{c.name}</span>
                        {c.is_private ? <span className="text-text-faint">private</span> : null}
                        {c.enabled && c.last_sync_at ? <span className="text-text-faint">synced {shortTime(c.last_sync_at)}</span> : null}
                      </label>
                    </li>
                  ))}
                </ul>
                <Button size="sm" variant="ghost" className="mt-1" disabled={notice.busy} onClick={() => void act('slack/disconnect', { workspaceId: w.id })}>
                  Disconnect
                </Button>
              </div>
            )
          })}
          {slack.configured ? (
            <div className="flex flex-wrap items-end gap-2">
              <Button
                disabled={notice.busy}
                onClick={() =>
                  notice.run(async () => {
                    const r = await callApi<{ url: string }>('slack/connect', {})
                    if (!r.ok) return { ok: false, message: r.error.message }
                    window.location.href = r.data.url
                    return { ok: true, message: 'Opening Slack…' }
                  })
                }
              >
                Connect Slack
              </Button>
              {slack.workspaces.length ? (
                <Button variant="secondary" disabled={notice.busy} onClick={() => void act('slack/sync', {})}>
                  Sync now
                </Button>
              ) : null}
            </div>
          ) : null}
          <p className="text-xs text-text-faint">Invite the app to a channel in Slack (/invite @FollowThru) before enabling it. Imported lines feed the same commitment engine as team chat.</p>
          <Notice result={notice.result} />
        </div>
      )}
    </Card>
  )
}
