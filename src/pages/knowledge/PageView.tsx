import { useState } from 'react'
import { Link } from 'react-router-dom'
import clsx from 'clsx'
import { Button, Card } from '../../components/ui'
import { Notice } from '../../components/domain/parts'
import { Markdown } from '../../components/domain/Markdown'
import { shortTime } from '../../components/domain/view'
import { callApi } from '../../cloud/api'
import { canEditPage, nextStatuses, type KbRole, type KbStatus } from '../../knowledge/rules'
import type { ActionResult } from '../../store'
import { STATUS_LABEL, STATUS_TONE, type PageDetail, type PageSource } from './types'

const ACTION_LABEL: Record<KbStatus, string> = { draft: 'Move to draft', review: 'Send to review', published: 'Publish', archived: 'Archive' }

function SourceLink({ source, role }: { source: PageSource | null; role: KbRole }) {
  if (!source) return null
  if (source.kind === 'task' && 'taskKey' in source) return <Link to={`/commitments/${encodeURIComponent(source.taskKey)}`} className="text-accent hover:underline">From task {source.taskKey}</Link>
  if (source.kind !== 'email') return null
  // The email itself is on the Automation page, which only coordinators can open
  return role === 'coordinator' ? <Link to="/automation" className="text-accent hover:underline">From an email (meeting minutes)</Link> : <span className="text-text-faint">From an email (meeting minutes)</span>
}

interface Props {
  detail: PageDetail
  role: KbRole
  userId: string
  onEdit: () => void
  onChanged: () => void
  onShowVersion: (version: number | null) => void
}

/** A page with its status actions and version history. Old versions open read-only and can be restored as a new version. */
export function PageView({ detail, role, userId, onEdit, onChanged, onShowVersion }: Props) {
  const { page, shownVersion } = detail
  const [notice, setNotice] = useState<ActionResult | null>(null)
  const [busy, setBusy] = useState(false)
  const access = { status: page.status, ownerProfileId: page.owner_profile_id }
  const editable = canEditPage(access, role, userId)
  const moves = nextStatuses(access, role, userId)

  async function act(route: string, body: Record<string, unknown>) {
    setBusy(true)
    const res = await callApi<{ message: string }>(route, { pageId: page.id, expectedRowVersion: page.row_version, ...body })
    setBusy(false)
    setNotice(res.ok ? { ok: true, message: res.data.message } : { ok: false, message: res.error.message })
    if (res.ok) onChanged()
    return res.ok
  }

  const viewing = shownVersion && shownVersion.version !== page.version ? shownVersion : null
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs text-text-faint">
              {detail.space?.name ?? 'Space'} · version {page.version} · updated {shortTime(page.updated_at)}
              {detail.ownerName ? ` · owner ${detail.ownerName}` : ''}
            </p>
            <h2 className="mt-1 font-display text-2xl font-semibold text-text-primary">{viewing ? viewing.title : page.title}</h2>
            <p className="mt-1 flex flex-wrap items-center gap-2 text-xs">
              <span className={clsx('font-medium', STATUS_TONE[page.status])}>{STATUS_LABEL[page.status]}</span>
              {page.tags.map((t) => (
                <span key={t} className="rounded-full border border-surface-border px-2 py-0.5 text-text-muted">
                  #{t}
                </span>
              ))}
              <SourceLink source={page.source} role={role} />
            </p>
          </div>
          {viewing ? null : (
            <div className="flex flex-wrap gap-2">
              {editable ? (
                <Button size="sm" onClick={onEdit}>
                  Edit
                </Button>
              ) : null}
              {moves.map((s) => (
                <Button key={s} size="sm" variant="secondary" disabled={busy} onClick={() => void act('kb/page-status', { status: s })}>
                  {ACTION_LABEL[s]}
                </Button>
              ))}
            </div>
          )}
        </div>
        {viewing ? (
          <div role="status" className="mt-3 flex flex-wrap items-center gap-2 rounded-md border border-status-tentative/40 px-3 py-2 text-sm text-status-tentative">
            Viewing version {viewing.version} ({STATUS_LABEL[viewing.status]}, {shortTime(viewing.created_at)}). This is not the current text.
            <Button size="sm" variant="ghost" onClick={() => onShowVersion(null)}>
              Back to current
            </Button>
            {editable ? (
              <Button size="sm" variant="secondary" disabled={busy} onClick={() => void act('kb/page-restore', { version: viewing.version }).then((ok) => ok && onShowVersion(null))}>
                Restore as new version
              </Button>
            ) : null}
          </div>
        ) : null}
        <div className="mt-3">
          <Notice result={notice} />
        </div>
        <article className="mt-4">
          <Markdown source={viewing ? viewing.body_md : page.body_md} />
        </article>
      </Card>
      <Card>
        <h3 className="font-display text-base font-semibold text-text-primary">Version history</h3>
        {detail.versions.length === 0 ? (
          <p className="mt-2 text-sm text-text-faint">No versions you can see yet.</p>
        ) : (
          <ol className="mt-2 divide-y divide-surface-border">
            {detail.versions.map((v) => (
              <li key={v.version} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <span className="min-w-0">
                  <b className="text-text-primary">v{v.version}</b> · {STATUS_LABEL[v.status]} · {v.editedBy ?? 'automation'} · {shortTime(v.createdAt)}
                  {v.note ? <span className="block text-xs text-text-faint">{v.note}</span> : null}
                </span>
                {v.version === page.version ? (
                  <span className="text-xs text-text-faint">current</span>
                ) : (
                  <Button size="sm" variant="ghost" onClick={() => onShowVersion(v.version)} aria-label={`View version ${v.version}`}>
                    View
                  </Button>
                )}
              </li>
            ))}
          </ol>
        )}
      </Card>
    </div>
  )
}
