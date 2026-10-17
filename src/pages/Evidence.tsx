import { useState } from 'react'
import { Button, Card, CardHeader, CardTitle, Dialog, EmptyState, Input, Select, StatusChip, Tabs, Textarea } from '../components/ui'
import { Notice, PageHeader, useActionNotice } from '../components/domain/parts'
import { downloadText, personName, shortTime } from '../components/domain/view'
import { commitmentsToCsv, draftsToCsv, resultsToJson } from '../schema/io'
import { buildEvidencePack, changedKeys, sha256Hex, useActions, useAuditLog, useEngine, useEvidenceFiles, useRuns, type AuditFilter } from '../store'
import { validateBackupJson, type BackupValidation } from '../schema/backup'

function ScorecardTab() {
  const { scorecard, dataset, result } = useEngine()
  const actions = useActions()
  const notice = useActionNotice()
  const runs = useRuns()
  const unlabelled = (dataset?.data.labels.length ?? 0) === 0
  return (
    <div className="flex flex-col gap-4">
      {unlabelled ? (
        <p className="rounded-md border border-status-tentative/40 bg-status-tentative/10 p-3 text-sm text-status-tentative">
          This data has no labelled commitments{dataset?.source === 'demo' ? ' (synthetic demo data)' : ''}, so owner, deadline and status accuracy is not scored. Load the C14 challenge fixture to measure it.
        </p>
      ) : null}
      <div className="grid gap-3 md:grid-cols-3">
        {scorecard.checks.map((c) => (
          <Card key={c.name}>
            <CardHeader>
              <CardTitle className="text-sm">{c.name.replace(/_/g, ' ')}</CardTitle>
              <StatusChip status={c.pass ? 'done' : 'overdue'} label={c.pass ? 'Pass' : unlabelled && c.name === 'owner_deadline_status' ? 'Not scored' : 'Fail'} />
            </CardHeader>
            <p className="font-display text-2xl font-semibold">
              {c.points} <span className="text-sm text-text-faint">/ {c.name === 'one_action_one_draft' ? 5 : 10}</span>
            </p>
            <p className="mt-1 text-xs text-text-muted">{c.detail}</p>
          </Card>
        ))}
      </div>
      {scorecard.labelChecks.length > 0 ? (
        <div className="overflow-x-auto rounded-lg border border-surface-border">
          <table className="w-full text-left text-xs">
            <thead className="bg-surface text-text-faint">
              <tr>
                <th className="p-2">Message</th>
                <th className="p-2">Expected</th>
                <th className="p-2">Actual</th>
                <th className="p-2">Owner</th>
                <th className="p-2">Deadline</th>
                <th className="p-2">Status</th>
                <th className="p-2">Evidence</th>
              </tr>
            </thead>
            <tbody>
              {scorecard.labelChecks.map((l) => (
                <tr key={l.sourceMessageId} className="border-t border-surface-border">
                  <td className="p-2 font-mono">{l.sourceMessageId}</td>
                  <td className="p-2">
                    {l.expected.ownerId} / {l.expected.dueAt ?? 'none'} / {l.expected.status}
                  </td>
                  <td className="p-2">{l.actual ? `${l.actual.ownerId} / ${l.actual.dueAt ?? 'none'} / ${l.actual.status}` : 'not found'}</td>
                  {[l.ownerOk, l.deadlineOk, l.statusOk].map((v, i) => (
                    <td key={i} className={v ? 'p-2 text-status-done' : 'p-2 text-status-overdue'}>
                      {v ? '✓' : '✗'}
                    </td>
                  ))}
                  <td className="p-2 font-mono">{l.evidenceMessageIds.join(', ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => notice.run(() => actions.saveRun())}>Save this run</Button>
        <span className="text-xs text-text-faint">
          {result.commitments.length} commitments · {result.drafts.length} drafts · evaluated at {result.runAt}
        </span>
      </div>
      <Notice result={notice.result} />
      {runs.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Saved runs</CardTitle>
          </CardHeader>
          <ul className="flex flex-col gap-1 text-xs">
            {runs.map((r) => (
              <li key={r.id} className="flex flex-wrap justify-between gap-2 border-b border-surface-border py-1">
                <span>
                  {shortTime(r.at)} · {r.dataset} · clock {shortTime(r.evaluatedAt)} · {r.mode}
                </span>
                <span className="text-text-muted">{r.checks.map((c) => `${c.name.split('_')[0]} ${c.pass ? 'pass' : 'fail'}`).join(' · ')}</span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  )
}

function ExportsTab() {
  const { result, scorecard } = useEngine()
  const stamp = result.runAt.replace(/[:.]/g, '-')
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {[
        { label: 'Results (JSON)', file: `followthru-results-${stamp}.json`, mime: 'application/json', make: () => resultsToJson(result) },
        { label: 'Commitments (CSV)', file: `commitments-${stamp}.csv`, mime: 'text/csv', make: () => commitmentsToCsv(result.commitments) },
        { label: 'Drafts (CSV)', file: `drafts-${stamp}.csv`, mime: 'text/csv', make: () => draftsToCsv(result.drafts) },
        { label: 'Scorecard (JSON)', file: `scorecard-${stamp}.json`, mime: 'application/json', make: () => JSON.stringify(scorecard, null, 2) },
      ].map((e) => (
        <Card key={e.file}>
          <CardHeader>
            <CardTitle className="text-sm">{e.label}</CardTitle>
          </CardHeader>
          <Button variant="secondary" size="sm" onClick={() => downloadText(e.file, e.make(), e.mime)}>
            Download
          </Button>
        </Card>
      ))}
      <EvidencePackCard />
      <p className="text-xs text-text-faint sm:col-span-2">
        CSV cells that start with = + - @ are escaped so spreadsheets do not run them. For a hashed, timestamped bundle run <code>npm run evidence</code>.
      </p>
    </div>
  )
}

function EvidencePackCard() {
  const state = useEngine()
  const auditRows = useAuditLog(100_000)
  const files = useEvidenceFiles()
  const [hash, setHash] = useState('')
  async function download() {
    const text = buildEvidencePack(state, auditRows, files, new Date().toISOString())
    setHash(await sha256Hex(new TextEncoder().encode(text).buffer as ArrayBuffer))
    downloadText(`followthru-evidence-pack-${state.result.runAt.replace(/[:.]/g, '-')}.json`, text, 'application/json')
  }
  return (
    <Card className="sm:col-span-2">
      <CardHeader>
        <CardTitle className="text-sm">Evidence pack (one JSON: scorecard, results, audit, file hashes)</CardTitle>
      </CardHeader>
      <Button size="sm" onClick={download}>
        Download evidence pack
      </Button>
      {hash ? <p className="mt-2 break-all font-mono text-xs text-text-muted">SHA-256 of the downloaded file: {hash}</p> : null}
    </Card>
  )
}

function UploadsTab() {
  const files = useEvidenceFiles()
  const actions = useActions()
  const notice = useActionNotice()
  const { people, user } = useEngine()
  const [deleting, setDeleting] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  return (
    <div className="flex flex-col gap-3">
      <label className="flex flex-col gap-1.5 text-sm font-medium text-text-primary">
        Upload screenshots, test reports or output files (10 MB max each)
        <input
          type="file"
          multiple
          onChange={(e) =>
            notice.run(async () => {
              const list = Array.from(e.target.files ?? [])
              for (const f of list) {
                const res = await actions.upload(f)
                if (!res.ok) return res
              }
              return { ok: true, message: `${list.length} file(s) stored with SHA-256 hashes` }
            })
          }
          className="text-sm text-text-muted"
        />
      </label>
      <Notice result={notice.result} />
      {files.length === 0 ? (
        <EmptyState title="No evidence files yet" description="Each upload is stored locally with a timestamp, uploader and SHA-256 hash, and logged in the audit trail." />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-surface-border">
          <table className="w-full text-left text-xs">
            <thead className="bg-surface text-text-faint">
              <tr>
                <th className="p-2">File</th>
                <th className="p-2">Uploaded</th>
                <th className="p-2">By</th>
                <th className="p-2">SHA-256</th>
                <th className="p-2" />
              </tr>
            </thead>
            <tbody>
              {files.map((f) => (
                <tr key={f.id} className="border-t border-surface-border">
                  <td className="p-2">
                    {f.name} <span className="text-text-faint">({Math.ceil(f.size / 1024)} KB)</span>
                    {f.linkedTo ? <span className="block text-text-faint">linked to {f.linkedTo}</span> : null}
                  </td>
                  <td className="p-2">{new Date(f.uploadedAt).toLocaleString()}</td>
                  <td className="p-2">{personName(people, f.uploadedBy)}</td>
                  <td className="p-2 font-mono break-all">{f.sha256}</td>
                  <td className="p-2">
                    <button
                      type="button"
                      className="text-accent hover:underline"
                      onClick={() => {
                        const url = URL.createObjectURL(f.blob)
                        const a = document.createElement('a')
                        a.href = url
                        a.download = f.name
                        a.click()
                        setTimeout(() => URL.revokeObjectURL(url), 1000)
                      }}
                    >
                      Download
                    </button>
                    {user?.role === 'coordinator' ? (
                      <button type="button" className="ml-3 text-status-overdue hover:underline" onClick={() => setDeleting(f.id)}>
                        Delete
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Dialog open={deleting !== null} onClose={() => setDeleting(null)} title="Delete this evidence file?" variant="modal">
        <div className="flex flex-col gap-3">
          <p className="text-sm text-text-muted">The file is removed from this device. The audit log keeps its name, size, hash and your reason.</p>
          <Textarea label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} />
          <div className="flex gap-2">
            <Button
              variant="danger"
              disabled={!reason.trim()}
              onClick={() =>
                notice.run(async () => {
                  const res = await actions.deleteEvidence(deleting!, reason)
                  if (res.ok) {
                    setDeleting(null)
                    setReason('')
                  }
                  return res
                })
              }
            >
              Delete file
            </Button>
            <Button variant="ghost" onClick={() => setDeleting(null)}>
              Keep it
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  )
}

const PAGE = 50
const ENTITIES = ['commitment', 'draft', 'task', 'evidence', 'settings', 'data'] as const

function AuditTab() {
  const { people } = useEngine()
  const [limit, setLimit] = useState(PAGE)
  const [actorId, setActorId] = useState('')
  const [actionPrefix, setActionPrefix] = useState('')
  const [entity, setEntity] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const filter: AuditFilter = {
    actorId: actorId || undefined,
    actionPrefix: actionPrefix.trim() || undefined,
    entity: (entity || undefined) as AuditFilter['entity'],
    from: from ? new Date(from).toISOString() : undefined,
    to: to ? new Date(to).toISOString() : undefined,
  }
  const log = useAuditLog(limit + 1, filter)
  const shown = log.slice(0, limit)
  const input = 'h-10 rounded-md border border-surface-border bg-surface px-3 text-sm [color-scheme:dark]'
  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-2 sm:grid-cols-5">
        <Select label="Actor" value={actorId} onChange={(e) => setActorId(e.target.value)}>
          <option value="">Anyone</option>
          <option value="setup">Setup (no profile)</option>
          {[...people.values()].map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
        <Input label="Action starts with" value={actionPrefix} onChange={(e) => setActionPrefix(e.target.value)} placeholder="draft." />
        <Select label="Entity" value={entity} onChange={(e) => setEntity(e.target.value)}>
          <option value="">Any</option>
          {ENTITIES.map((x) => (
            <option key={x} value={x}>
              {x}
            </option>
          ))}
        </Select>
        <label className="flex flex-col gap-1.5 text-sm font-medium text-text-primary">
          From (your time)
          <input type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)} className={input} />
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-medium text-text-primary">
          To (your time)
          <input type="datetime-local" value={to} onChange={(e) => setTo(e.target.value)} className={input} />
        </label>
      </div>
      {shown.length === 0 ? (
        <EmptyState title="No audit events match" />
      ) : (
        <ol className="flex flex-col gap-2 text-xs">
          {shown.map((a) => {
            const changed = changedKeys(a.before, a.after)
            return (
              <li key={a.id} className="rounded-md border border-surface-border p-2">
                <p>
                  <span className="font-mono text-accent">{a.action}</span> · {a.entity} {a.entityId} · {personName(people, a.actorId)}
                </p>
                <p className="text-text-faint">
                  {new Date(a.at).toLocaleString()} your time · {a.at} UTC
                </p>
                {a.before !== undefined || a.after !== undefined ? (
                  <details className="mt-1 text-text-muted">
                    <summary className="cursor-pointer">Before / after{changed.length ? ` (changed: ${changed.join(', ')})` : ''}</summary>
                    <pre className="mt-1 overflow-x-auto whitespace-pre-wrap">{JSON.stringify({ before: a.before, after: a.after }, null, 2)}</pre>
                  </details>
                ) : null}
              </li>
            )
          })}
        </ol>
      )}
      {log.length > limit ? (
        <Button size="sm" variant="secondary" onClick={() => setLimit((n) => n + PAGE)}>
          Load more
        </Button>
      ) : null}
    </div>
  )
}

function DataTab() {
  const { dataset, settings, user } = useEngine()
  const actions = useActions()
  const notice = useActionNotice()
  const [confirmReset, setConfirmReset] = useState(false)
  const [backup, setBackup] = useState<BackupValidation | null>(null)
  const isCoordinator = user?.role === 'coordinator'
  const flag = (key: keyof typeof settings.flags, label: string, hint: string) => (
    <label className="flex items-start gap-2 text-sm">
      <input
        type="checkbox"
        className="mt-1 size-4"
        disabled={!isCoordinator}
        checked={settings.flags[key]}
        onChange={(e) => notice.run(() => actions.updateSettings({ flags: { ...settings.flags, [key]: e.target.checked } }))}
      />
      <span>
        {label}
        <span className="block text-xs text-text-faint">{hint}</span>
      </span>
    </label>
  )
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Engine settings</CardTitle>
        </CardHeader>
        <div className="flex flex-col gap-3">
          {flag('staleSuppression', 'Stale-message suppression', 'Suppress drafts when work closes, and mark unapproved drafts stale after the window below.')}
          {flag('recipientReview', 'Recipient review', 'A coordinator must confirm the recipient before approving.')}
          {flag('ai', 'AI-assisted extraction', 'No AI provider is configured in this build, so this falls back to the rules and is labelled "Rules (fallback)".')}
          <Input
            label="Stale window (hours)"
            type="number"
            min={1}
            disabled={!isCoordinator}
            defaultValue={settings.staleAfterHours}
            onBlur={(e) => {
              const v = Number(e.target.value)
              if (v > 0 && v !== settings.staleAfterHours) void notice.run(() => actions.updateSettings({ staleAfterHours: v }))
            }}
          />
        </div>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Data</CardTitle>
        </CardHeader>
        <p className="mb-2 text-sm text-text-muted">
          {dataset?.name} · {dataset?.source} · loaded {dataset ? new Date(dataset.loadedAt).toLocaleString() : ''}
        </p>
        <p className="mb-3 text-xs text-text-faint">{dataset?.issues.length ?? 0} validation warnings</p>
        {dataset && dataset.issues.length > 0 ? (
          <ul className="mb-3 max-h-40 overflow-auto text-xs text-status-tentative">
            {dataset.issues.map((i, n) => (
              <li key={n}>
                {i.code} at {i.path.join('.')}: {i.message}
              </li>
            ))}
          </ul>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => dataset && downloadText(`${dataset.name.replace(/\W+/g, '-')}.json`, JSON.stringify(dataset.data, null, 2), 'application/json')}
          >
            Export data
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() =>
              notice.run(async () => {
                const res = await actions.exportBackup()
                if (res.ok && res.json) downloadText(`followthru-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`, res.json, 'application/json')
                return res
              })
            }
          >
            Export backup
          </Button>
          <Button variant="danger" size="sm" disabled={!isCoordinator} onClick={() => setConfirmReset(true)}>
            Reset all local data
          </Button>
        </div>
        <label className="mt-3 flex flex-col gap-1.5 text-sm font-medium text-text-primary">
          Restore a backup
          <input
            type="file"
            accept=".json,application/json"
            disabled={!isCoordinator}
            aria-label="Restore a backup file"
            onChange={async (e) => {
              const file = e.target.files?.[0]
              if (file) setBackup(validateBackupJson(await file.text()))
            }}
            className="text-sm text-text-muted"
          />
        </label>
      </Card>
      <div className="md:col-span-2">
        <Notice result={notice.result} />
      </div>
      <Dialog open={backup !== null} onClose={() => setBackup(null)} title="Restore this backup?" variant="modal">
        {backup?.ok ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-text-muted">
              Backup from {backup.backup!.exportedAt}: {backup.backup!.decisions.length} decisions, {backup.backup!.tasks.length} tasks, {backup.backup!.drafts.length} drafts,{' '}
              {backup.backup!.audit.length} audit entries. It replaces the data, drafts, decisions, tasks, flows, runs and audit log on this device. Uploaded file contents are kept.
            </p>
            <div className="flex gap-2">
              <Button
                variant="danger"
                onClick={() =>
                  notice.run(async () => {
                    const res = await actions.restoreBackup(backup)
                    setBackup(null)
                    return res
                  })
                }
              >
                Restore
              </Button>
              <Button variant="ghost" onClick={() => setBackup(null)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-2 text-sm">
            <p className="text-status-overdue">This backup cannot be restored:</p>
            <ul className="max-h-48 overflow-auto text-xs text-text-muted">
              {backup?.issues.map((i, n) => (
                <li key={n}>
                  {i.code} at {i.path.join('.') || '(file)'}: {i.message}
                </li>
              ))}
            </ul>
            <Button variant="ghost" onClick={() => setBackup(null)}>
              Close
            </Button>
          </div>
        )}
      </Dialog>
      <Dialog open={confirmReset} onClose={() => setConfirmReset(false)} title="Reset all local data?" variant="modal">
        <p className="mb-4 text-sm text-text-muted">This deletes the data, drafts, decisions, tasks, flows, runs and uploads in this browser. The audit log is kept.</p>
        <div className="flex gap-2">
          <Button
            variant="danger"
            onClick={() =>
              notice.run(async () => {
                const res = await actions.resetAll()
                setConfirmReset(false)
                return res
              })
            }
          >
            Reset
          </Button>
          <Button variant="ghost" onClick={() => setConfirmReset(false)}>
            Keep data
          </Button>
        </div>
      </Dialog>
    </div>
  )
}

export default function Evidence() {
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title="Evidence" description="Scorecard for the three official checks, exports, uploaded proof with hashes, and the full audit trail." />
      <Tabs
        items={[
          { value: 'score', label: 'Scorecard', content: <ScorecardTab /> },
          { value: 'exports', label: 'Exports', content: <ExportsTab /> },
          { value: 'uploads', label: 'Uploads', content: <UploadsTab /> },
          { value: 'audit', label: 'Audit log', content: <AuditTab /> },
          { value: 'data', label: 'Data & settings', content: <DataTab /> },
        ]}
      />
    </div>
  )
}
