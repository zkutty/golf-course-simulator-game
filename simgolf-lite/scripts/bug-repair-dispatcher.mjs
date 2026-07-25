import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import {
  dispatchRepair,
  workflowStateCandidates,
} from './m45-repair-dispatcher-lib.mjs'

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const appDirectory = resolve(scriptDirectory, '..')
const repositoryDirectory = resolve(appDirectory, '..')
const resultSchemaPath = resolve(
  scriptDirectory,
  'm45-repair-result.schema.json',
)
const linearEndpoint = 'https://api.linear.app/graphql'
const execute = process.argv.includes('--execute')
const issueArgumentIndex = process.argv.indexOf('--issue')
const requestedIssue =
  issueArgumentIndex >= 0 ? process.argv[issueArgumentIndex + 1]?.trim() : undefined
const projectId =
  process.env.LINEAR_PROJECT_ID ?? 'cd09f00a-5774-4874-8baa-d968f1067ad9'
const teamId =
  process.env.LINEAR_TEAM_ID ?? '7abe7bd3-d61f-4358-9ee5-071765d3f379'
const baseBranch = process.env.REPAIR_BASE_BRANCH ?? 'develop'
const labelIds = {
  'autofix-ready':
    process.env.REPAIR_AUTOFIX_READY_LABEL_ID ??
    '782fccad-8042-4103-9955-80342907cce1',
  'needs-repro':
    process.env.REPAIR_NEEDS_REPRO_LABEL_ID ??
    '091de474-cb11-4a5d-a98c-b988387e6da1',
  'needs-human-review':
    process.env.REPAIR_NEEDS_HUMAN_LABEL_ID ??
    '4bde7475-3886-48ae-a46e-80f01a6292a0',
}

function requireSecret(name) {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is required.`)
  return value
}

async function linearQuery(query, variables) {
  const response = await fetch(linearEndpoint, {
    method: 'POST',
    headers: {
      Authorization: requireSecret('LINEAR_API_KEY'),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(15_000),
  })
  const envelope = await response.json()
  if (!response.ok || envelope.errors?.length || !envelope.data) {
    const detail =
      envelope.errors?.map((error) => error.message).join('; ') ??
      `HTTP ${response.status}`
    throw new Error(`Linear request failed: ${detail}`)
  }
  return envelope.data
}

function allowedAttachment(urlValue) {
  try {
    const url = new URL(urlValue)
    return (
      url.protocol === 'https:' &&
      [
        'linear.app',
        'uploads.linear.app',
        'sentry.io',
        'github.com',
        'githubusercontent.com',
      ].some(
        (host) =>
          url.hostname === host || url.hostname.endsWith(`.${host}`),
      )
    )
  } catch {
    return false
  }
}

function normalizeIssue(issue) {
  return {
    ...issue,
    branchName: issue.branchName,
    labels: issue.labels?.nodes ?? [],
    comments: issue.comments?.nodes ?? [],
    attachments: (issue.attachments?.nodes ?? []).map((attachment) => ({
      ...attachment,
      kind: allowedAttachment(attachment.url) ? 'trusted-link' : 'unknown',
    })),
  }
}

async function candidateIssues() {
  const data = await linearQuery(
    `query CourseCraftRepairCandidates($projectId: ID!) {
      issues(
        first: 50
        filter: {
          project: { id: { eq: $projectId } }
          labels: { name: { eq: "autofix-ready" } }
          state: { type: { nin: ["completed", "canceled"] } }
        }
      ) {
        nodes {
          id identifier title description url branchName
          project { id }
          team { id }
          state { type }
          labels { nodes { id name } }
          attachments { nodes { id title url } }
          comments(last: 100) {
            nodes { body user { id name } }
          }
        }
      }
    }`,
    { projectId },
  )
  return data.issues.nodes
    .map(normalizeIssue)
    .filter((issue) => !requestedIssue || issue.identifier === requestedIssue)
}

async function addComment(issueId, body) {
  await linearQuery(
    `mutation CourseCraftRepairComment($input: CommentCreateInput!) {
      commentCreate(input: $input) { success }
    }`,
    { input: { issueId, body } },
  )
}

async function workflowStateId(name) {
  const data = await linearQuery(
    `query CourseCraftRepairState($teamId: ID!, $name: String!) {
      workflowStates(
        first: 10
        filter: { team: { id: { eq: $teamId } }, name: { eq: $name } }
      ) { nodes { id name } }
    }`,
    { name, teamId },
  )
  return data.workflowStates.nodes[0]?.id
}

async function transitionIssue(issue, transition) {
  const current = new Map(issue.labels.map((label) => [label.name, label.id]))
  if (transition.removeLabel) current.delete(transition.removeLabel)
  if (transition.addLabel) {
    const id = labelIds[transition.addLabel]
    if (!id) throw new Error(`Unknown repair label ${transition.addLabel}.`)
    current.set(transition.addLabel, id)
  }
  const input = { labelIds: [...current.values()] }
  if (transition.state) {
    let stateId
    for (const candidate of workflowStateCandidates(transition.state)) {
      stateId = await workflowStateId(candidate)
      if (stateId) break
    }
    if (!stateId) {
      throw new Error(
        `Linear state ${transition.state} and its documented fallback were not found.`,
      )
    }
    input.stateId = stateId
  }
  await linearQuery(
    `mutation CourseCraftRepairTransition($id: String!, $input: IssueUpdateInput!) {
      issueUpdate(id: $id, input: $input) { success }
    }`,
    { id: issue.id, input },
  )
  issue.labels = [...current].map(([name, id]) => ({ id, name }))
}

function run(command, args, options = {}) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? repositoryDirectory,
      env: options.env ?? process.env,
      stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    })
    let output = ''
    let settled = false
    const timeout = setTimeout(() => {
      if (settled) return
      child.kill('SIGTERM')
      setTimeout(() => child.kill('SIGKILL'), 5_000).unref()
    }, options.timeoutMs ?? 15 * 60_000)
    if (options.capture) {
      child.stdout.on('data', (chunk) => {
        output += chunk
      })
      child.stderr.on('data', (chunk) => {
        output += chunk
      })
    }
    child.on('error', (error) => {
      settled = true
      clearTimeout(timeout)
      rejectPromise(error)
    })
    child.on('exit', (code) => {
      settled = true
      clearTimeout(timeout)
      if (code === 0) {
        resolvePromise(output.trim())
      } else {
        rejectPromise(
          new Error(
            `${command} exited with code ${code}${
              output.trim() ? `: ${output.trim().slice(-1_000)}` : ''
            }`,
          ),
        )
      }
    })
  })
}

function safeCodexEnvironment() {
  return Object.fromEntries(
    Object.entries(process.env).filter(([name]) => {
      if (name === 'CODEX_API_KEY') return true
      return !/(?:TOKEN|SECRET|API_KEY|PASSWORD|COOKIE|AUTHORIZATION)/i.test(
        name,
      )
    }),
  )
}

async function remoteBranchExists(branch) {
  const output = await run(
    'git',
    ['ls-remote', '--heads', 'origin', `refs/heads/${branch}`],
    { capture: true },
  )
  return Boolean(output)
}

function gitAdapter(worktreeRootRef) {
  return {
    async claimBranch({ attemptId, branch, issue }) {
      await run('git', ['ls-remote', 'origin', 'HEAD'], {
        capture: true,
        timeoutMs: 60_000,
      })
      if (await remoteBranchExists(branch)) {
        if (process.env.REPAIR_RESUME_ISSUE !== issue.identifier) {
          return { claimed: false }
        }
      }
      const temporaryRoot = await mkdtemp(
        resolve(tmpdir(), 'coursecraft-repair-worktree-'),
      )
      const worktree = resolve(temporaryRoot, 'repo')
      try {
        const resume = await remoteBranchExists(branch)
        await run('git', [
          'worktree',
          'add',
          '--detach',
          worktree,
          resume ? `origin/${branch}` : `origin/${baseBranch}`,
        ])
        await run(
          'git',
          [
            'commit',
            '--allow-empty',
            '-m',
            `chore(${issue.identifier.toLowerCase()}): claim repair ${attemptId}`,
          ],
          { cwd: worktree },
        )
        try {
          await run('git', ['push', 'origin', `HEAD:refs/heads/${branch}`], {
            cwd: worktree,
            capture: true,
          })
        } catch (error) {
          if (await remoteBranchExists(branch)) {
            await run('git', ['worktree', 'remove', '--force', worktree])
            await rm(temporaryRoot, { force: true, recursive: true })
            return { claimed: false }
          }
          throw error
        }
        const commit = await run('git', ['rev-parse', 'HEAD'], {
          cwd: worktree,
          capture: true,
        })
        worktreeRootRef.value = temporaryRoot
        return { claimed: true, commit, worktree }
      } catch (error) {
        await rm(temporaryRoot, { force: true, recursive: true })
        throw error
      }
    },

    async pushRepair(worktree, branch) {
      const status = await run('git', ['status', '--porcelain'], {
        cwd: worktree,
        capture: true,
      })
      if (status) {
        throw new Error(
          'Codex left uncommitted changes; the dispatcher will not stage or push them.',
        )
      }
      const commits = Number(
        await run(
          'git',
          ['rev-list', '--count', `origin/${baseBranch}..HEAD`],
          { cwd: worktree, capture: true },
        ),
      )
      if (commits < 2) {
        throw new Error('Codex produced no repair commit after the claim commit.')
      }
      await run('git', ['push', 'origin', `HEAD:refs/heads/${branch}`], {
        cwd: worktree,
      })
    },
  }
}

const codexAdapter = {
  async run({ prompt, worktree }) {
    const temporaryRoot = await mkdtemp(resolve(tmpdir(), 'coursecraft-codex-'))
    const resultPath = resolve(temporaryRoot, 'result.json')
    try {
      // The isolated worktree does not share the caller's node_modules. Prepare
      // dependencies before the credential-scrubbed Codex process attempts the
      // required failing regression test.
      await run('npm', ['ci'], {
        cwd: resolve(worktree, 'simgolf-lite'),
        timeoutMs: 15 * 60_000,
      })
      await run('codex', [
        'exec',
        '--cd',
        worktree,
        '--sandbox',
        'workspace-write',
        '--ephemeral',
        '--output-schema',
        resultSchemaPath,
      '--output-last-message',
      resultPath,
      prompt,
      ], {
        env: safeCodexEnvironment(),
        timeoutMs: Number(process.env.REPAIR_CODEX_TIMEOUT_MS ?? 30 * 60_000),
      })
      return JSON.parse(await readFile(resultPath, 'utf8'))
    } finally {
      await rm(temporaryRoot, { force: true, recursive: true })
    }
  },
}

const checksAdapter = {
  async runRequired(worktree) {
    const cwd = resolve(worktree, 'simgolf-lite')
    await run('npm', ['ci'], { cwd })
    await run('npm', ['test'], { cwd })
    await run('npm', ['run', 'build'], { cwd })
    await run('npm', ['run', 'lint'], { cwd })
    return [
      'fresh `npm ci`: pass',
      '`npm test`: pass',
      '`npm run build`: pass',
      '`npm run lint`: pass',
    ]
  },
}

const pullRequestAdapter = {
  async openDraft({ baseBranch: base, branch, issue, summary, worktree }) {
    const output = await run(
      'gh',
      [
        'pr',
        'create',
        '--draft',
        '--base',
        base,
        '--head',
        branch,
        '--title',
        `${issue.identifier}: ${issue.title}`,
        '--body',
        `Draft repair for [${issue.identifier}](${issue.url}).\n\n${summary}\n\nHuman review, CI, merge, deployment, verification, and closure remain required.`,
      ],
      { capture: true, cwd: worktree },
    )
    return output.split(/\s+/).at(-1)
  },
}

async function canceled(issueIdentifier) {
  const data = await linearQuery(
    `query CourseCraftRepairCancellation($id: String!) {
      issue(id: $id) { comments(last: 20) { nodes { body } } }
    }`,
    { id: issueIdentifier },
  )
  return data.issue.comments.nodes.some((comment) =>
    /^\/autofix cancel(?:\s|$)/im.test(comment.body),
  )
}

async function main() {
  if (execute && process.env.REPAIR_DISPATCH_ENABLED !== 'true') {
    throw new Error(
      'Execution is disabled. Set REPAIR_DISPATCH_ENABLED=true after staging certification.',
    )
  }
  const approverIds = new Set(
    (process.env.REPAIR_APPROVER_IDS ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
  )
  if (!approverIds.size) {
    throw new Error('REPAIR_APPROVER_IDS must contain a human Linear user ID.')
  }

  const config = {
    approverIds,
    baseBranch,
    enabled: process.env.REPAIR_DISPATCH_ENABLED === 'true',
    projectId,
    teamId,
  }
  const issues = await candidateIssues()
  const noSideEffects = {
    checks: {},
    codex: {},
    git: {},
    linear: {},
    pullRequests: {},
  }

  if (!execute) {
    for (const issue of issues) {
      const result = await dispatchRepair({
        attemptId: 'dry-run',
        config,
        dryRun: true,
        issue,
        ...noSideEffects,
      })
      console.log(
        `${issue.identifier}: ${
          result.status === 'dry-run'
            ? `eligible; branch ${result.branch}`
            : `${result.status}: ${(result.reasons ?? []).join(', ')}`
        }`,
      )
    }
    return
  }

  for (const issue of issues) {
    const audit = await dispatchRepair({
      attemptId: 'dry-run',
      config,
      dryRun: true,
      issue,
      ...noSideEffects,
    })
    if (audit.status !== 'dry-run') continue

    const worktreeRootRef = { value: undefined }
    let result
    try {
      result = await dispatchRepair({
        attemptId: randomUUID(),
        checks: checksAdapter,
        codex: codexAdapter,
        config,
        dryRun: false,
        git: gitAdapter(worktreeRootRef),
        isCanceled: canceled,
        issue,
        linear: {
          addComment,
          transition: transitionIssue,
        },
        pullRequests: pullRequestAdapter,
      })
      console.log(`${issue.identifier}: ${result.status}`)
    } finally {
      if (
        worktreeRootRef.value &&
        ['success', 'needs-repro', 'canceled'].includes(result?.status)
      ) {
        const worktree = resolve(worktreeRootRef.value, 'repo')
        await run('git', ['worktree', 'remove', '--force', worktree]).catch(
          () => undefined,
        )
        await rm(worktreeRootRef.value, { force: true, recursive: true })
      } else if (worktreeRootRef.value) {
        console.error(
          `${issue.identifier}: retained investigation worktree at ${resolve(
            worktreeRootRef.value,
            'repo',
          )}`,
        )
      }
    }
    return
  }
}

await main()
