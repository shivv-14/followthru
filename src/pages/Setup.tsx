import { type ChangeEvent, useEffect, useState } from 'react'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { Input, Button, Card, CardHeader, CardTitle } from '../components/ui'
import { Notice, useActionNotice } from '../components/domain/parts'
import { isMockModeEnabled } from '../config/demoMode'
import { AuthLayout } from '../components/shell/AuthLayout'
import { useCloud } from '../cloud/session'
import { validateDataset, validateDatasetJson } from '../schema/validate'
import { messagesFromCsv } from '../schema/io'
import { isSimpleChatCsv, simpleChatCsvToDataset } from '../schema/simpleCsv'
import { pdfLinesToDataset } from '../schema/pdfChat'
import type { ValidationResult } from '../engine/types'
import { useActions, useEngine, type DataSource } from '../store'
import demoDataset from '../mocks/demoDataset.json'

const detectedTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone

// The challenge fixture is bundled only when it exists at data/fixture.json.
const bundledFixture = import.meta.glob('/data/fixture.json', {
  query: '?raw',
  import: 'default',
}) as Record<string, () => Promise<string>>
const fixtureLoader: (() => Promise<string>) | undefined = bundledFixture['/data/fixture.json']

// The fixture has no reference time. Its last line is 16 Oct 2026 13:01 IST and its latest deadline is 23 Oct,
// so this clock is after every deadline: open actions get reminder drafts, closed ones never do.
const FIXTURE_AFTER_DEADLINES = '2026-10-24T09:00:00+05:30'
type FixtureClock = 'after_deadlines' | 'dataset' | 'live'

interface Candidate {
  name: string
  source: DataSource
  validation: ValidationResult
}

export default function Setup() {
  const navigate = useNavigate()
  const state = useEngine()
  const cloud = useCloud()
  const actions = useActions()
  const notice = useActionNotice()
  const [name, setName] = useState(state.settings.userName)
  const [nameError, setNameError] = useState('')
  const [candidate, setCandidate] = useState<Candidate | null>(null)
  const [fixtureClock, setFixtureClock] = useState<FixtureClock>('after_deadlines')
  const [params] = useSearchParams()

  async function loadFixture() {
    if (!fixtureLoader) return
    setCandidate({
      name: 'C14 challenge fixture (fixture.json)',
      source: 'fixture',
      validation: validateDatasetJson(await fixtureLoader()),
    })
  }

  async function downloadFixture() {
    if (!fixtureLoader) return
    const url = URL.createObjectURL(new Blob([await fixtureLoader()], { type: 'application/json' }))
    const a = document.createElement('a')
    a.href = url
    a.download = 'C14-fixture-SYNTHETIC.json'
    a.click()
    URL.revokeObjectURL(url)
  }

  useEffect(() => {
    if (params.get('fixture') === '1') void loadFixture()
  }, [])

  async function onFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    if (file.size > 10 * 1024 * 1024) {
      setCandidate({ name: file.name, source: 'import', validation: { ok: false, issues: [{ code: 'invalid_value', severity: 'error', path: ['file'], message: 'Files must be 10 MB or smaller' }] } })
      return
    }
    if (file.name.toLowerCase().endsWith('.pdf')) {
      try {
        const { pdfTextLines } = await import('../lib/pdfText')
        setCandidate({ name: file.name, source: 'import', validation: pdfLinesToDataset(await pdfTextLines(await file.arrayBuffer()), file.name, detectedTimezone) })
      } catch {
        setCandidate({ name: file.name, source: 'import', validation: { ok: false, issues: [{ code: 'invalid_value', severity: 'error', path: ['pdf'], message: 'This PDF could not be opened. Check that it is not password-protected or damaged.' }] } })
      }
      return
    }
    const text = await file.text()
    if (file.name.toLowerCase().endsWith('.csv') && isSimpleChatCsv(text)) {
      setCandidate({ name: file.name, source: 'import', validation: simpleChatCsvToDataset(text, detectedTimezone) })
      return
    }
    if (file.name.toLowerCase().endsWith('.csv')) {
      const csv = messagesFromCsv(text)
      if (!state.dataset) {
        setCandidate({
          name: file.name,
          source: 'import',
          validation: {
            ok: false,
            issues: [
              ...csv.issues,
              {
                code: 'missing_field',
                severity: 'error',
                path: ['people'],
                message: 'A messages CSV needs people with timezones. Load a JSON dataset first, then import CSV messages into it.',
              },
            ],
          },
        })
        return
      }
      const base = state.dataset.data
      const validation =
        csv.issues.length > 0
          ? { ok: false, issues: csv.issues }
          : validateDataset({
              people: base.people,
              threads: base.threads,
              messages: csv.messages,
              labels: [],
            })
      setCandidate({
        name: `${file.name} (people from ${state.dataset.name})`,
        source: 'import',
        validation,
      })
      return
    }
    setCandidate({
      name: file.name,
      source: 'import',
      validation: validateDatasetJson(text),
    })
  }

  // Bring the check result and the "Load and continue" button into view (matters on a phone)
  useEffect(() => {
    if (candidate) document.getElementById('validation-result')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [candidate])

  function loadDemo() {
    setCandidate({
      name: 'Synthetic demo data',
      source: 'demo',
      validation: validateDataset(demoDataset),
    })
  }

  async function confirm() {
    if (!cloud && !name.trim()) {
      setNameError('Enter your name to continue')
      return
    }
    setNameError('')
    if (!candidate) return
    await notice.run(async () => {
      const res = await actions.loadDataset(candidate.name, candidate.source, candidate.validation)
      if (res.ok) {
        if (!cloud) await actions.updateSettings({ userName: name.trim() })
        if (candidate.source === 'fixture') {
          await actions.updateSettings(
            fixtureClock === 'after_deadlines' ? { clockMode: 'custom', customNow: new Date(FIXTURE_AFTER_DEADLINES).toISOString() } : { clockMode: fixtureClock },
          )
        }
        navigate(cloud ? '/dashboard' : '/login')
      }
      return res
    })
  }

  if (cloud?.status === 'signed_out') return <Navigate to="/login" replace state={{ from: '/setup' }} />
  if (cloud?.me && cloud.me.profile.role !== 'coordinator') return <Navigate to="/dashboard" replace />

  const errors = candidate?.validation.issues.filter((i) => i.severity === 'error') ?? []
  const warnings = candidate?.validation.issues.filter((i) => i.severity === 'warning') ?? []
  const data = candidate?.validation.data

  return (
    <AuthLayout
      aside={
        <Link
          to={cloud ? '/dashboard' : '/login'}
          className="rounded-full bg-pill px-5 py-2.5 text-sm font-medium text-pill-text shadow-[0_4px_14px_rgba(0,0,0,0.16)] hover:bg-[#323234] hover:text-white"
        >
          {cloud ? 'Back to the app' : 'Sign in'}
        </Link>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="mb-2 text-center">
          <h1 className="font-dot text-4xl leading-tight text-white sm:text-5xl">{cloud ? 'Import conversations' : 'Set up FollowThru'}</h1>
          <p className="mx-auto mt-3 max-w-md text-[15px] text-white/75">
            {cloud
              ? `Data is saved to your ${cloud.me?.org?.name ?? ''} workspace in the cloud. Reminders are drafted for review only; nothing is sent outside the app.`
              : 'Data stays in this browser. Reminders are drafted for review only; nothing is ever sent.'}
          </p>
        </div>

        {state.dataset && state.dataset.data.messages.length > 0 ? (
          <Card>
            <CardHeader>
              <CardTitle>Current data</CardTitle>
              <Link to={cloud ? '/dashboard' : '/login'} className="text-sm text-accent hover:underline">
                Continue →
              </Link>
            </CardHeader>
            <p className="text-sm text-text-muted">
              {state.dataset.name} ({state.dataset.source}) · {state.dataset.data.messages.length} messages · {state.dataset.data.people.length} people · {state.dataset.data.labels.length} labels
            </p>
            <p className="mt-2 text-xs text-text-faint">
              {cloud
                ? 'New imports are added to it; the same file twice is refused. To start over, use Reset workspace data under Evidence, Data & settings.'
                : 'Loading new data below replaces it and clears drafts, decisions and tasks. The audit log is kept.'}
            </p>
          </Card>
        ) : null}

        {cloud ? null : (
          <Card>
            <div className="flex flex-col gap-4">
              <Input label="Your name" value={name} onChange={(event) => setName(event.target.value)} error={nameError} placeholder="Priya Sharma" />
              <Input label="Timezone" value={detectedTimezone} readOnly hint="Detected from your browser. Deadlines also show the owner's own time." />
            </div>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Choose data</CardTitle>
          </CardHeader>
          <ol className="flex flex-col gap-5">
            {cloud || isMockModeEnabled() ? (
              <li>
                <p className="mb-1 text-sm font-semibold text-text-primary">1. Quickest: use the demo team</p>
                <p className="mb-2 text-sm text-text-muted">A made-up team of 6 people with 23 chat messages. One tap and you can try every screen.</p>
                <Button onClick={loadDemo}>Use the demo team (synthetic data)</Button>
              </li>
            ) : null}
            <li>
              <p className="mb-1 text-sm font-semibold text-text-primary">{cloud || isMockModeEnabled() ? '2.' : '1.'} Or download a ready-made file, then upload it below</p>
              <p className="mb-2 text-sm text-text-muted">All files are made-up (synthetic) team chats. Works on a phone too: download, then pick the file in step 3.</p>
              <div className="flex flex-wrap gap-2">
                <a className="rounded-full border border-pill-border bg-pill px-4 py-2 text-sm text-pill-text hover:text-white" href="/samples/demo-team-chat-SYNTHETIC.csv" download>
                  Demo team chat (CSV)
                </a>
                <a className="rounded-full border border-pill-border bg-pill px-4 py-2 text-sm text-pill-text hover:text-white" href="/samples/product-team-chat-SYNTHETIC.csv" download>
                  Product team chat (CSV)
                </a>
                <a className="rounded-full border border-pill-border bg-pill px-4 py-2 text-sm text-pill-text hover:text-white" href="/samples/product-team-chat-SYNTHETIC.pdf" download>
                  Product team chat (PDF)
                </a>
                <a className="rounded-full border border-pill-border bg-pill px-4 py-2 text-sm text-pill-text hover:text-white" href="/samples/template.csv" download>
                  Blank template (CSV)
                </a>
              </div>
            </li>
            <li>
              <label className="flex flex-col gap-1.5 text-sm font-semibold text-text-primary">
                {cloud || isMockModeEnabled() ? '3.' : '2.'} Upload your file (CSV, JSON or PDF)
                <input
                  type="file"
                  accept=".csv,.json,.pdf,text/csv,application/json,application/pdf"
                  onChange={onFile}
                  className="text-sm font-normal text-text-muted file:mr-3 file:rounded-full file:border-0 file:bg-white file:px-4 file:py-2 file:font-semibold file:text-black"
                />
              </label>
              <details className="mt-2 text-sm text-text-muted">
                <summary className="cursor-pointer text-accent">Make your own file in Excel or Google Sheets</summary>
                <p className="mt-2">One row per chat message, with these columns:</p>
                <ul className="mt-1 list-disc pl-5">
                  <li><b>time</b>: like 2026-10-20 10:00 (in the sender's own time)</li>
                  <li><b>thread</b>: the chat or channel name, for example Website launch</li>
                  <li><b>from</b>: who wrote it, for example Asha Rao</li>
                  <li><b>timezone</b>: for example Asia/Kolkata</li>
                  <li><b>message</b>: what they wrote</li>
                  <li>Optional: <b>role</b> (coordinator or member), <b>team</b>, <b>reply_to</b> (the row number of the message being answered)</li>
                </ul>
                <p className="mt-1">Save as CSV and upload. People and threads are created from their names automatically.</p>
                <p className="mt-2">
                  <b>PDF:</b> one message per line, like <code>2026-10-20 10:00 | Website launch | Asha Rao | Asia/Kolkata | message</code>, or a WhatsApp chat export saved as PDF (<code>20/10/2026, 10:00 - Asha Rao: message</code>). Scanned PDFs (pictures of text) cannot be read.
                </p>
              </details>
            </li>
            {fixtureLoader ? (
              <li>
                <p className="mb-1 text-sm font-semibold text-text-primary">C14 challenge fixture (fixture.json)</p>
                <p className="mb-2 text-sm text-text-muted">
                  The official synthetic starter data: 12 messages, 10 labelled actions. Loading it scores owner, deadline and status on the Evidence page. You can also upload the same JSON file in the step above.
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button variant="secondary" onClick={loadFixture}>
                    Import fixture.json
                  </Button>
                  <Button variant="ghost" onClick={downloadFixture}>
                    Download fixture.json
                  </Button>
                </div>
              </li>
            ) : null}
          </ol>
        </Card>

        {candidate ? (
          <Card aria-live="polite" id="validation-result">
            <CardHeader>
              <CardTitle>Validation: {candidate.name}</CardTitle>
              <span className={errors.length ? 'text-sm text-status-overdue' : 'text-sm text-status-done'}>{errors.length ? `${errors.length} errors` : 'Ready to load'}</span>
            </CardHeader>
            {data ? (
              <p className="mb-3 text-sm text-text-muted">
                {data.people.length} people · {data.threads.length} threads · {data.messages.length} messages · {data.labels.length} labelled commitments
                {data.referenceTime ? ` · evaluation clock ${data.referenceTime}` : candidate.source === 'fixture' ? ' · no reference time (choose a clock below)' : ' · no reference time (live clock will be used)'}
              </p>
            ) : null}
            {candidate.source === 'demo' ? <p className="mb-3 text-sm text-status-tentative">Synthetic data written for the demo. It has no labels and is never scored.</p> : null}
            {candidate.source === 'fixture' && data ? (
              <fieldset className="mb-3 flex flex-col gap-1.5 text-sm text-text-muted">
                <legend className="mb-1 font-semibold text-text-primary">Evaluation clock (the file has none)</legend>
                <label className="flex items-start gap-2">
                  <input type="radio" name="fixture-clock" checked={fixtureClock === 'after_deadlines'} onChange={() => setFixtureClock('after_deadlines')} />
                  <span>24 Oct 2026, 09:00 IST: after every deadline, so each open action gets one reminder draft</span>
                </label>
                <label className="flex items-start gap-2">
                  <input type="radio" name="fixture-clock" checked={fixtureClock === 'dataset'} onChange={() => setFixtureClock('dataset')} />
                  <span>Last message in the file (16 Oct 2026, 13:01 IST): nothing is overdue yet</span>
                </label>
                <label className="flex items-start gap-2">
                  <input type="radio" name="fixture-clock" checked={fixtureClock === 'live'} onChange={() => setFixtureClock('live')} />
                  <span>Live clock (now)</span>
                </label>
                <span className="text-xs text-text-faint">You can change it later from the clock in the top bar.</span>
              </fieldset>
            ) : null}
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
      </div>
    </AuthLayout>
  )
}
