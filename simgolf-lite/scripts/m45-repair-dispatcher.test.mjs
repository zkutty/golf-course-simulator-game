import assert from 'node:assert/strict'
import test from 'node:test'
import {
  claimMarkerPrefix,
  dispatchRepair,
  evaluateRepairIssue,
  workflowStateCandidates,
} from './m45-repair-dispatcher-lib.mjs'

const config = {
  approverIds: new Set(['human-1']),
  baseBranch: 'develop',
  enabled: true,
  projectId: 'project',
  teamId: 'team',
}

function issue(overrides = {}) {
  return {
    id: 'issue-id',
    identifier: 'ZK-999',
    title: 'Golfer freezes after advancing the day',
    branchName: 'zkutty/zk-999-golfer-freeze',
    description: `<!-- coursecraft-bug-fingerprint:abc -->

## Observed
Golfer freezes.

## Expected
Golfer advances.

## Reproduction
1. Advance the day.

## Acceptance
A regression test advances the day without freezing.`,
    project: { id: 'project' },
    team: { id: 'team' },
    state: { type: 'backlog' },
    labels: [{ name: 'Bug' }, { name: 'autofix-ready' }],
    comments: [
      {
        body: '/autofix approve — reproduction confirmed',
        user: { id: 'human-1', isBot: false },
      },
    ],
    attachments: [],
    ...overrides,
  }
}

function harness(overrides = {}) {
  const calls = []
  return {
    calls,
    linear: {
      addComment: async (_id, body) => calls.push(['comment', body]),
      transition: async (_issue, transition) => calls.push(['transition', transition]),
    },
    git: {
      claimBranch: async () => ({
        claimed: true,
        commit: 'abc1234',
        worktree: '/tmp/worktree',
      }),
      pushRepair: async () => calls.push(['push']),
    },
    codex: {
      run: async () => ({
        branch: 'zkutty/zk-999-golfer-freeze',
        regressionTest: 'src/game/freeze.test.ts',
        status: 'success',
        summary: 'Fix the frozen state transition.',
        targetedTests: ['npm test -- freeze.test.ts'],
      }),
    },
    checks: {
      runRequired: async () => ['build: pass', 'lint: pass', 'tests: pass'],
    },
    pullRequests: {
      openDraft: async () => 'https://github.com/example/repo/pull/123',
    },
    ...overrides,
  }
}

test('eligible requires the active project, workflow, labels, sections, and human approval', () => {
  assert.equal(evaluateRepairIssue(issue(), config).eligible, true)
  const result = evaluateRepairIssue(
    issue({
      title: 'Ambiguous design decision',
      labels: [{ name: 'Bug' }],
      comments: [],
      description: 'Ambiguous design and no sections.',
    }),
    config,
  )
  assert.equal(result.eligible, false)
  assert.ok(result.reasons.includes('missing_autofix_ready'))
  assert.ok(result.reasons.includes('missing_human_approval'))
  assert.ok(result.reasons.includes('unsafe_scope'))
})

test('common authentication and access-control bugs always require human review', () => {
  for (const title of [
    'Login bypass permits account takeover',
    'Authorization check allows permission bypass',
    'Stored XSS in course title',
    'Password reset token remains valid',
  ]) {
    const result = evaluateRepairIssue(issue({ title }), config)
    assert.equal(result.eligible, false, title)
    assert.ok(result.reasons.includes('unsafe_scope'), title)
  }
})

test('needs-repro transitions use Backlog when the team has no Triage state', () => {
  assert.deepEqual(workflowStateCandidates('Triage'), ['Triage', 'Backlog'])
  assert.deepEqual(workflowStateCandidates('In Review'), ['In Review'])
})

test('dry-run performs no mutations', async () => {
  const mocks = harness()
  const result = await dispatchRepair({
    issue: issue(),
    config,
    dryRun: true,
    attemptId: 'attempt-1',
    ...mocks,
  })
  assert.equal(result.status, 'dry-run')
  assert.match(result.prompt, /Observed:\nGolfer freezes\./)
  assert.deepEqual(mocks.calls, [])
})

test('an active claim suppresses a duplicate scheduler run', async () => {
  const mocks = harness()
  const claimed = issue({
    comments: [
      ...issue().comments,
      {
        body: `${claimMarkerPrefix} issue=ZK-999 attempt=attempt-1 -->`,
        user: { id: 'bot' },
      },
    ],
  })
  const result = await dispatchRepair({
    issue: claimed,
    config,
    dryRun: false,
    attemptId: 'attempt-2',
    ...mocks,
  })
  assert.equal(result.status, 'duplicate')
  assert.deepEqual(mocks.calls, [])
})

test('a distributed branch claim loss stops a concurrent run', async () => {
  const mocks = harness({
    git: {
      claimBranch: async () => ({ claimed: false }),
      pushRepair: async () => assert.fail('must not push'),
    },
  })
  const result = await dispatchRepair({
    issue: issue(),
    config,
    dryRun: false,
    attemptId: 'attempt-2',
    ...mocks,
  })
  assert.equal(result.status, 'duplicate')
  assert.deepEqual(mocks.calls, [])
})

test('a canceled attempt does not claim or mutate', async () => {
  const mocks = harness()
  const result = await dispatchRepair({
    issue: issue(),
    config,
    dryRun: false,
    attemptId: 'attempt-1',
    isCanceled: async () => true,
    ...mocks,
  })
  assert.equal(result.status, 'canceled')
  assert.deepEqual(mocks.calls, [])
})

test('a failed reproduction routes to needs-repro without checks or PR', async () => {
  const mocks = harness({
    codex: {
      run: async () => ({
        status: 'needs-repro',
        evidence: 'The described transition completed 20/20 times.',
      }),
    },
    checks: {
      runRequired: async () => assert.fail('must not run checks'),
    },
    pullRequests: {
      openDraft: async () => assert.fail('must not open PR'),
    },
  })
  const result = await dispatchRepair({
    issue: issue(),
    config,
    dryRun: false,
    attemptId: 'attempt-1',
    ...mocks,
  })
  assert.equal(result.status, 'needs-repro')
  assert.ok(
    mocks.calls.some(
      ([kind, value]) => kind === 'transition' && value.addLabel === 'needs-repro',
    ),
  )
})

test('a failed required gate stops before a draft PR and routes to human review', async () => {
  const mocks = harness({
    checks: {
      runRequired: async () => {
        throw new Error('focused regression failed')
      },
    },
    pullRequests: {
      openDraft: async () => assert.fail('must not open PR after a failed gate'),
    },
  })
  const result = await dispatchRepair({
    issue: issue(),
    config,
    dryRun: false,
    attemptId: 'attempt-1',
    ...mocks,
  })

  assert.equal(result.status, 'failed')
  assert.equal(result.classification, 'checks')
  assert.ok(
    mocks.calls.some(
      ([kind, value]) =>
        kind === 'transition' &&
        value.addLabel === 'needs-human-review' &&
        value.removeLabel === 'autofix-ready',
    ),
  )
  assert.equal(mocks.calls.some(([kind]) => kind === 'push'), false)
})

test('a successful attempt stops at a draft PR and human review state', async () => {
  const mocks = harness()
  const result = await dispatchRepair({
    issue: issue(),
    config,
    dryRun: false,
    attemptId: 'attempt-1',
    ...mocks,
  })
  assert.deepEqual(result, {
    status: 'success',
    prUrl: 'https://github.com/example/repo/pull/123',
  })
  assert.ok(mocks.calls.some(([kind]) => kind === 'push'))
  assert.ok(
    mocks.calls.some(
      ([kind, value]) => kind === 'transition' && value.state === 'In Review',
    ),
  )
  assert.equal(
    mocks.calls.some(([, value]) => value?.state === 'Done'),
    false,
  )
})
