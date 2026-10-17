import { type ChangeEvent, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Input, Button, Card, CardHeader, CardTitle } from '../components/ui'
import { Notice, useActionNotice } from '../components/domain/parts'
import { isMockModeEnabled } from '../config/demoMode'
import { validateDataset, validateDatasetJson } from '../schema/validate'
import { messagesFromCsv } from '../schema/io'
import type { ValidationResult } from '../engine/types'
import { useActions, useEngine, type DataSource } from '../store'
import demoDataset from '../mocks/demoDataset.json'

const detectedTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone

// The challenge fixture is bundled only when it exists at data/fixture.json.
const bundledFixture = import.meta.glob('/data/fixture.json', { query: '?raw', import: 'default' }) as Record<string, () => Promise<string>>
const fixtureLoader: (() => Promise<string>) | undefined = bundledFixture['/data/fixture.json']

interface Candidate {
  name: string
  source: DataSource
  validation: ValidationResult
}

export default function Setup() {
  const navigate = useNavigate()
  const state = useEngine()
  const actions = useActions()
  const notice = useActionNotice()
  const [name, setName] = useState(state.settings.userName)
  const [nameError, setNameError] = useState('')
  const [candidate, setCandidate] = useState<Candidate | null>(null)

  async function loadFixture() {
    if (!fixtureLoader) return
    setCandidate({ name: 'C14 challenge fixture', source: 'fixture', validation: validateDatasetJson(await fixtureLoader()) })
  }

  async function onFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    const text = await file.text()
    if (file.name.toLowerCase().endsWith('.csv')) {
      const csv = messagesFromCsv(text)
      if (!state.dataset) {
        setCandidate({ name: file.name, source: 'import', validation: { ok: false, issues: [...csv.issues, { code: 'missing_field', severity: 'error', path: ['people'], message: 'A messages CSV needs people with timezones. Load a JSON dataset first, then import CSV messages into it.' }] } })
        return
      }
      const base = state.dataset.data
      const validation = csv.issues.length > 0 ? { ok: false, issues: csv.issues } : validateDataset({ people: base.people, threads: base.threads, messages: csv.messages, labels: [] })
      setCandidate({ name: `${file.name} (people from ${state.dataset.name})`, source: 'import', validation })
      return
    }
    setCandidate({ name: file.name, source: 'import', validation: validateDatasetJson(text) })
  }

  function loadDemo() {
    setCandidate({ name: 'Synthetic demo data', source: 'demo', validation: validateDataset(demoDataset) })
  }

  async function confirm() {
    if (!name.trim()) {
      setNameError('Enter your name to continue')
      return
    }
    setNameError('')
    if (!candidate) return
    await notice.run(async () => {
      const res = await actions.loadDataset(candidate.name, candidate.source, candidate.validation)
      if (res.ok) {
        await actions.updateSettings({ userName: name.trim() })
        navigate('/profiles')
      }
      return res
    })
  }

  const errors = candidate?.validation.issues.filter((i) => i.severity === 'error') ?? []
  const warnings = candidate?.validation.issues.filter((i) => i.severity === 'warning') ?? []
  const data = candidate?.validation.data

  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col justify-center gap-4 px-4 py-10">
      <div>
        <h1 className="mb-1 font-display text-2xl font-semibold text-text-primary">Set up FollowThru</h1>
        <p className="text-sm text-text-muted">Data stays in this browser. Reminders are drafted for review only; nothing is ever sent.</p>
      </div>

      {state.dataset ? (
        <Card>
          <CardHeader>
            <CardTitle>Current data</CardTitle>
            <Link to="/profiles" className="text-sm text-accent hover:underline">
              Continue →
            </Link>
          </CardHeader>
          <p className="text-sm text-text-muted">
            {state.dataset.name} ({state.dataset.source}) · {state.dataset.data.messages.length} messages · {state.dataset.data.people.length} people ·{' '}
            {state.dataset.data.labels.length} labels
          </p>
          <p className="mt-2 text-xs text-text-faint">Loading new data below replaces it and clears drafts, decisions and tasks. The audit log is kept.</p>
        </Card>
      ) : null}

      <Card>
        <div className="flex flex-col gap-4">
          <Input label="Your name" value={name} onChange={(event) => setName(event.target.value)} error={nameError} placeholder="Priya Sharma" />
          <Input label="Timezone" value={detectedTimezone} readOnly hint="Detected from your browser. Deadlines also show the owner's own time." />
        </div>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Choose data</CardTitle>
        </CardHeader>
        <div className="flex flex-col gap-3">
          {fixtureLoader ? (
            <Button variant="secondary" onClick={loadFixture}>
              Load the C14 challenge fixture
            </Button>
          ) : (
            <p className="rounded-md border border-dashed border-surface-border p-3 text-sm text-text-muted">
              Challenge fixture not found. Copy <code>Starter_Data/C14/fixture.json</code> to <code>data/fixture.json</code> and restart to load it here.
            </p>
          )}
          <label className="flex flex-col gap-1.5 text-sm font-medium text-text-primary">
            Import a JSON dataset or a messages CSV
            <input type="file" accept=".json,.csv,application/json,text/csv" onChange={onFile} className="text-sm text-text-muted file:mr-3 file:rounded-md file:border-0 file:bg-surface-hover file:px-3 file:py-2 file:text-text-primary" />
          </label>
          {isMockModeEnabled() ? (
            <Button variant="ghost" onClick={loadDemo}>
              Use synthetic demo data (not the challenge fixture)
            </Button>
          ) : null}
        </div>
      </Card>

      {candidate ? (
        <Card aria-live="polite">
          <CardHeader>
            <CardTitle>Validation: {candidate.name}</CardTitle>
            <span className={errors.length ? 'text-sm text-status-overdue' : 'text-sm text-status-done'}>
              {errors.length ? `${errors.length} errors` : 'Ready to load'}
            </span>
          </CardHeader>
          {data ? (
            <p className="mb-3 text-sm text-text-muted">
              {data.people.length} people · {data.threads.length} threads · {data.messages.length} messages · {data.labels.length} labelled commitments
              {data.referenceTime ? ` · evaluation clock ${data.referenceTime}` : ' · no reference time (live clock will be used)'}
            </p>
          ) : null}
          {candidate.source === 'demo' ? <p className="mb-3 text-sm text-status-tentative">Synthetic data written for the demo. It has no labels and is never scored.</p> : null}
          {[...errors, ...warnings].length > 0 ? (
            <div className="mb-3 max-h-60 overflow-auto rounded-md border border-surface-border">
              <table className="w-full text-left text-xs">
                <thead className="text-text-faint">
                  <tr>
                    <th className="p-2">Level</th>
                    <th className="p-2">Code</th>
                    <th className="p-2">Where</th>
                    <th className="p-2">Message</th>
                  </tr>
                </thead>
                <tbody>
                  {[...errors, ...warnings].map((i, n) => (
                    <tr key={n} className="border-t border-surface-border">
                      <td className={i.severity === 'error' ? 'p-2 text-status-overdue' : 'p-2 text-status-tentative'}>{i.severity}</td>
                      <td className="p-2 font-mono">{i.code}</td>
                      <td className="p-2 font-mono">{i.path.join('.') || '(file)'}</td>
                      <td className="p-2 text-text-muted">{i.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          <Button className="w-full" onClick={confirm} disabled={errors.length > 0 || notice.busy}>
            {errors.length > 0 ? 'Fix the errors to continue' : 'Load and continue'}
          </Button>
        </Card>
      ) : null}
      <Notice result={notice.result} />
    </main>
  )
}
