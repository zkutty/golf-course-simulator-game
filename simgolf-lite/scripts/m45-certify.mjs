import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'

const root = new URL('../', import.meta.url)
const manifest = JSON.parse(
  readFileSync(new URL('release/m45-certification.json', root), 'utf8'),
)
const required = [
  'contract-and-privacy',
  'worker-intake-runtime',
  'dispatcher-dry-runs',
  'reporter-and-crash-e2e',
  'build-lint-unit',
  'pwa-performance-deploy',
  'manual-staging-golden-path',
  'sentry-staging-group',
  'human-approved-draft-repair',
]
const errors = []
const byId = new Map(manifest.gates.map((gate) => [gate.id, gate]))
for (const id of required) {
  if (!byId.has(id)) errors.push(`Missing gate: ${id}`)
}
for (const gate of manifest.gates) {
  if (gate.kind === 'automated' && !gate.command) {
    errors.push(`${gate.id}: automated gate lacks a command`)
  }
  if (gate.kind === 'automated' && gate.status === 'passed' && !gate.evidence) {
    errors.push(`${gate.id}: automated pass lacks test evidence`)
  }
  if (gate.kind === 'external' && gate.status === 'passed' && !gate.evidence) {
    errors.push(`${gate.id}: external pass lacks provider evidence`)
  }
}
const externalRecordRequirements = {
  'manual-staging-golden-path': ['linearIssue', 'stagingDeployment'],
  'sentry-staging-group': ['sentryGroup'],
  'human-approved-draft-repair': ['draftPullRequest'],
}
for (const [gateId, recordKeys] of Object.entries(externalRecordRequirements)) {
  if (byId.get(gateId)?.status !== 'passed') continue
  for (const key of recordKeys) {
    if (!manifest.records[key]) {
      errors.push(`${gateId}: certification record ${key} is required`)
    }
  }
}
const externalGates = manifest.gates.filter((gate) => gate.kind === 'external')
if (
  externalGates.length > 0 &&
  externalGates.every((gate) => gate.status === 'passed') &&
  !manifest.records.cleanupDisposition
) {
  errors.push('Certification record cleanupDisposition is required for GO')
}

const head = execFileSync('git', ['rev-parse', 'HEAD'], {
  cwd: new URL('.', root),
  encoding: 'utf8',
}).trim()
const dirty = Boolean(
  execFileSync('git', ['status', '--short'], {
    cwd: new URL('.', root),
    encoding: 'utf8',
  }).trim(),
)
const blockers = manifest.gates
  .filter((gate) => gate.status !== 'passed')
  .map((gate) => gate.id)
if (dirty) blockers.unshift('uncommitted-workspace')
const decision = blockers.length === 0 ? 'GO' : 'HOLD'
if (manifest.decision !== decision) {
  errors.push(`Manifest decision must be ${decision} with ${blockers.length} blockers`)
}
const report = {
  ok: errors.length === 0,
  schemaVersion: manifest.schemaVersion,
  milestone: manifest.milestone,
  decision,
  generatedAt: new Date().toISOString(),
  source: { commit: head, dirty },
  blockers,
  errors,
  records: manifest.records,
  gates: manifest.gates,
}
mkdirSync(new URL('artifacts/m45/', root), { recursive: true })
writeFileSync(
  new URL('artifacts/m45/certification-report.json', root),
  `${JSON.stringify(report, null, 2)}\n`,
)
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
if (!report.ok) process.exitCode = 1
