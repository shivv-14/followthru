// Usage:
//   npm run evidence                      challenge fixture at data/fixture.json
//   npm run evidence -- --input file.json any dataset in the FollowThru format
//   npm run evidence -- --demo            synthetic demo data (labelled as such, never scored)
//   add --now 2026-10-19T05:30:00Z to set the evaluation clock
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { evaluate, makeConfig, runEngine } from '../src/engine'
import { commitmentsToCsv, draftsToCsv, resultsToJson } from '../src/schema/io'
import { validateDatasetJson } from '../src/schema/validate'

const args = process.argv.slice(2)
const arg = (name: string) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : undefined
}
const demo = args.includes('--demo')
const input = resolve(demo ? 'src/mocks/demoDataset.json' : (arg('input') ?? 'data/fixture.json'))

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
const now = arg('now') ?? data.referenceTime
if (!now) {
  console.error('The dataset has no referenceTime. Pass --now <ISO timestamp> as the evaluation clock.')
  process.exit(1)
}

const config = makeConfig(new Date(now).toISOString())
const result = runEngine({ dataset: data }, config)
const rerun = runEngine({ dataset: data, previousDrafts: result.drafts }, config)
const idempotent = JSON.stringify(rerun.drafts) === JSON.stringify(result.drafts)
const scorecard = evaluate(result.commitments, result.drafts, data.labels, result.runAt)

const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const dir = join('evidence', `${demo ? 'demo' : 'run'}-${stamp}`)
mkdirSync(dir, { recursive: true })

const source = demo ? 'Synthetic demo data (not the challenge fixture, not scored)' : input
const lines = [
  '# FollowThru scorecard',
  '',
  `- Generated: ${new Date().toISOString()}`,
  `- Dataset: ${source}`,
  `- Evaluation clock: ${result.runAt}`,
  `- Engine mode: ${result.mode}`,
  `- Validation: ${validation.issues.length} warnings`,
  `- Commitments: ${result.commitments.length}, drafts: ${result.drafts.length}`,
  `- Re-run with previous drafts identical: ${idempotent ? 'yes' : 'NO'}`,
  '',
  '## Official checks',
  '',
  '| Check | Result | Points | Detail |',
  '|---|---|---|---|',
  ...scorecard.checks.map((c) => `| ${c.name} | ${c.pass ? 'PASS' : 'FAIL'} | ${c.points} | ${c.detail} |`),
  '',
  '## Labelled commitments',
  '',
  scorecard.labelChecks.length === 0 ? 'No labels in this dataset.' : '| Source message | Expected owner / due / status | Actual | OK | Evidence |',
  ...(scorecard.labelChecks.length === 0 ? [] : ['|---|---|---|---|---|']),
  ...scorecard.labelChecks.map(
    (l) =>
      `| ${l.sourceMessageId} | ${l.expected.ownerId} / ${l.expected.dueAt ?? 'none'} / ${l.expected.status} | ${l.actual ? `${l.actual.ownerId} / ${l.actual.dueAt ?? 'none'} / ${l.actual.status}` : 'not found'} | ${[l.ownerOk ? 'owner' : '', l.deadlineOk ? 'deadline' : '', l.statusOk ? 'status' : ''].filter(Boolean).join(', ') || 'none'} | ${l.evidenceMessageIds.join(', ')} |`,
  ),
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
  'validation.json': JSON.stringify(validation.issues, null, 2),
}
const manifest = Object.entries(files).map(([name, content]) => {
  writeFileSync(join(dir, name), content)
  return { name, bytes: Buffer.byteLength(content), sha256: createHash('sha256').update(content).digest('hex') }
})
writeFileSync(join(dir, 'manifest.json'), JSON.stringify({ generatedAt: new Date().toISOString(), dataset: source, files: manifest }, null, 2))

console.log(`Evidence written to ${dir}`)
for (const c of scorecard.checks) console.log(`  ${c.pass ? 'PASS' : 'FAIL'} ${c.name}: ${c.detail}`)
if (!idempotent) process.exitCode = 1
