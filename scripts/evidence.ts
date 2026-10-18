// Usage:
//   npm run evidence                         challenge fixture at data/fixture.json
//   npm run evidence -- --input file.json    any dataset in the FollowThru format
//   npm run evidence -- --demo               synthetic demo data (labelled, never scored)
// Options:
//   --label <name>            folder label (default "run")
//   --flags on|off            stale suppression and recipient review (default on)
//   --now <ISO>               evaluation clock (default: the dataset reference time)
//   --simulate-later <ISO>    first run with messages up to this time, then a second run
//                             with all messages and the first run's drafts; writes stale-report.md
//   --simulate-now <ISO>      clock for that first run (default: the cutoff time)
//   --skip-tests              do not write test-report.txt
import { execSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { checkBeforeApproval, evaluate, makeConfig, runEngine } from '../src/engine'
import type { Dataset, EngineResult } from '../src/engine'
import { commitmentsToCsv, draftsToCsv, resultsToJson, suppressionsToCsv } from '../src/schema/io'
import { validateDatasetJson } from '../src/schema/validate'

const args = process.argv.slice(2)
const arg = (name: string) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : undefined
}
// Vitest fails when started from a lowercase drive letter on Windows, so normalise it.
const root = process.cwd().replace(/^[a-z]:/, (d) => d.toUpperCase())
const demo = args.includes('--demo')
const label = (arg('label') ?? 'run').replace(/[^a-z0-9-]/gi, '-')
const flagsOn = (arg('flags') ?? 'on') !== 'off'
const input = resolve(root, demo ? 'src/mocks/demoDataset.json' : (arg('input') ?? 'data/fixture.json'))

if (!existsSync(input)) {
  console.error(`No dataset at ${input}.`)
  console.error('Copy the challenge fixture to data/fixture.json, pass --input <file>, or use --demo for the synthetic demo data.')
  process.exit(2)
}

const validation = validateDatasetJson(readFileSync(input, 'utf8'))
if (!validation.ok || !validation.data) {
  console.error(`Dataset failed validation with ${validation.issues.length} issues:`)
  for (const i of validation.issues) console.error(`  ${i.severity} ${i.code} at ${i.path.join('.') || '(root)'}: ${i.message}`)
  process.exit(1)
}
const data = validation.data
const nowArg = arg('now') ?? data.referenceTime
if (!nowArg) {
  console.error('The dataset has no referenceTime. Pass --now <ISO timestamp> as the evaluation clock.')
  process.exit(1)
}
const now = new Date(nowArg).toISOString()
const flags = { staleSuppression: flagsOn, recipientReview: flagsOn, ai: false }
const config = makeConfig(now, { flags })
const synthetic = demo || data.labels.length === 0
const sourceName = demo ? 'Synthetic demo data (not the challenge fixture, not scored)' : input

// Optional two-step simulation: drafts written at the cutoff, then later messages arrive.
const cutoffArg = arg('simulate-later')
let first: EngineResult | undefined
if (cutoffArg) {
  const cutoff = new Date(cutoffArg).toISOString()
  const early: Dataset = { ...data, messages: data.messages.filter((m) => m.sentAt <= cutoff) }
  const firstNow = arg('simulate-now') ? new Date(arg('simulate-now')!).toISOString() : cutoff
  first = runEngine({ dataset: early }, makeConfig(firstNow, { flags }))
}
const result = runEngine({ dataset: data, previousDrafts: first?.drafts }, config)
const rerun = runEngine({ dataset: data, previousDrafts: result.drafts }, config)
const idempotent = JSON.stringify(rerun.drafts) === JSON.stringify(result.drafts)
const scorecard = evaluate(result.commitments, result.drafts, data.labels, result.runAt)

const stamp = new Date().toISOString().replace('T', '_').replace(/:/g, '-').slice(0, 19)
const dir = join(root, 'evidence', synthetic ? 'demo-runs' : 'runs', `${stamp}_${label}`)
mkdirSync(dir, { recursive: true })

function git(cmd: string): string {
  try {
    return execSync(cmd, { cwd: root, encoding: 'utf8' }).trim()
  } catch {
    return 'unknown'
  }
}
const commit = git('git rev-parse --short HEAD')
const dirty = git('git status --porcelain --untracked-files=no') !== ''

function staleReport(): string {
  if (!first) return ''
  const truth = makeConfig(now)
  const byId = new Map(result.commitments.map((c) => [c.id, c]))
  const lines = [
    `# Stale draft report (${label})`,
    '',
    `- Data: ${sourceName}`,
    `- Drafts written at: ${first.runAt}; later messages up to: ${now}`,
    `- Stale suppression and recipient review: ${flagsOn ? 'ON' : 'OFF'}`,
    '',
    '| Draft | At cutoff | Now | Why it is outdated |',
    '|---|---|---|---|',
  ]
  let outdated = 0
  let wronglySendable = 0
  for (const d0 of first.drafts) {
    const d = result.drafts.find((x) => x.id === d0.id)
    const c = byId.get(d0.commitmentId)
    if (!d) continue
    const check = checkBeforeApproval({ ...d, state: 'pending_review', recipientConfirmed: true }, c, truth)
    const reason = check.suppressWith ? check.blockers[0].message : ''
    if (!reason && d.state === d0.state && d.version === d0.version) continue
    outdated++
    const stillActive = d.state === 'pending_review' || d.state === 'approved'
    if (stillActive && reason) wronglySendable++
    lines.push(`| ${d.id} (${c?.title ?? d.commitmentId}) | ${d0.state} v${d0.version} | ${d.state} v${d.version}${d.suppression ? ` (${d.suppression.reason})` : ''} | ${reason || 'updated'} |`)
  }
  lines.push('', `Outdated drafts: ${outdated}. Still approvable although outdated: ${wronglySendable}.`, '')
  if (!flagsOn) lines.push('Without stale suppression these drafts stay in the queue and approval does not re-check them, so they could be approved and sent wrongly.', '')
  return lines.join('\n')
}

let testsPassed = true
let testReport = 'Skipped (--skip-tests).'
if (!args.includes('--skip-tests')) {
  const t = spawnSync('npx vitest run --reporter=verbose', { cwd: root, shell: true, encoding: 'utf8' })
  testsPassed = t.status === 0
  testReport = `${t.stdout ?? ''}${t.stderr ?? ''}`.replace(/\x1b\[[0-9;]*m/g, '')
}

const lines = [
  `# FollowThru scorecard (${label})`,
  '',
  `- Generated: ${new Date().toISOString()}`,
  `- Dataset: ${sourceName}${synthetic && !demo ? ' (no labels, so not scored)' : ''}`,
  `- Evaluation clock: ${result.runAt}`,
  `- Engine mode: ${result.mode} (official evidence always runs the rules)`,
  `- Stale suppression and recipient review: ${flagsOn ? 'ON' : 'OFF'}`,
  `- Git commit: ${commit}${dirty ? ' (working tree had uncommitted changes)' : ''}`,
  `- Validation: ${validation.issues.length} warnings`,
  `- Commitments: ${result.commitments.length}, drafts: ${result.drafts.length}`,
  `- Re-run with previous drafts identical: ${idempotent ? 'yes' : 'NO'}`,
  `- Test suite: ${args.includes('--skip-tests') ? 'skipped' : testsPassed ? 'passed (test-report.txt)' : 'FAILED (see test-report.txt)'}`,
  '',
  '## Official checks',
  '',
  '| Check | Result | Points | Detail |',
  '|---|---|---|---|',
  ...scorecard.checks.map((c) => `| ${c.name} | ${c.pass ? 'PASS' : 'FAIL'} | ${c.points} | ${c.detail} |`),
  '',
  '## Labelled commitments',
  '',
  scorecard.labelChecks.length === 0 ? 'No labels in this dataset.' : '| Action | Source message | Expected owner / due / status | Actual | OK | Reminder eligibility | Active draft | Evidence |',
  ...(scorecard.labelChecks.length === 0 ? [] : ['|---|---|---|---|---|---|---|---|']),
  ...scorecard.labelChecks.map((l) => {
    const c = result.commitments.find((x) => x.sourceMessageId === l.sourceMessageId)
    const d = c ? result.drafts.find((x) => x.commitmentId === c.id) : undefined
    const eligible = l.expected.reminderEligible === undefined ? 'not labelled' : `${l.expected.reminderEligible ? 'eligible' : 'not eligible'}: ${l.reminderOk ? 'agrees' : 'DISAGREES'}`
    return `| ${l.expected.actionKey ?? ''} | ${l.sourceMessageId} | ${l.expected.ownerId} / ${l.expected.dueDate ?? l.expected.dueAt ?? 'none'} / ${l.expected.status} | ${l.actual ? `${l.actual.ownerId} / ${l.actual.dueAt ?? 'none'} / ${l.actual.status}` : 'not found'} | ${[l.ownerOk ? 'owner' : '', l.deadlineOk ? 'deadline' : '', l.statusOk ? 'status' : ''].filter(Boolean).join(', ') || 'none'} | ${eligible} | ${d ? `${d.state} v${d.version}` : 'none'} | ${l.evidenceMessageIds.join(', ')} |`
  }),
  '',
  '## Suppressed or closed work',
  '',
  ...result.commitments.filter((c) => c.status !== 'open').map((c) => `- ${c.id} ${c.status}: ${c.title} (evidence ${c.events.at(-1)?.evidence?.messageId || 'decision'})`),
  '',
]

const files: Record<string, string> = {
  'scorecard.md': lines.join('\n'),
  'results.json': resultsToJson(result),
  'commitments.csv': commitmentsToCsv(result.commitments),
  'drafts.csv': draftsToCsv(result.drafts),
  'suppressions.csv': suppressionsToCsv(result.drafts),
  'validation.json': JSON.stringify(validation.issues, null, 2),
  'test-report.txt': testReport,
}
const report = staleReport()
if (report) files['stale-report.md'] = report

const manifest = Object.entries(files).map(([name, content]) => {
  writeFileSync(join(dir, name), content)
  return { name, bytes: Buffer.byteLength(content), sha256: createHash('sha256').update(content).digest('hex') }
})
writeFileSync(
  join(dir, 'manifest.json'),
  JSON.stringify(
    { generatedAt: new Date().toISOString(), label, dataset: sourceName, synthetic, flags, engineMode: result.mode, evaluationClock: result.runAt, gitCommit: commit, dirtyTree: dirty, files: manifest },
    null,
    2,
  ),
)

const latest = join(root, 'evidence', 'latest')
rmSync(latest, { recursive: true, force: true })
cpSync(dir, latest, { recursive: true })

console.log(`Evidence written to ${dir} (copied to evidence/latest)`)
for (const c of scorecard.checks) console.log(`  ${c.pass ? 'PASS' : 'FAIL'} ${c.name}: ${c.detail}`)
if (report) console.log(`  stale report: ${report.split('\n').find((l) => l.startsWith('Outdated drafts'))}`)
if (!testsPassed) console.log('  Test suite FAILED, see test-report.txt')
if (!idempotent || !testsPassed) process.exitCode = 1
