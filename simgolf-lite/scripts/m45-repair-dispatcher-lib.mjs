const activeStateTypes = new Set(['backlog', 'unstarted', 'started'])
const unsafePattern =
  /\b(security|privacy|authentication|authorization|access control|account takeover|login bypass|permission bypass|credential|password|passkey|token|secret exposure|encryption|cryptograph(?:y|ic)|injection|cross-site scripting|xss|csrf|ssrf|remote code execution|rce|personally identifiable information|pii|save corruption|corrupt(?:ed)? save|save (?:was )?(?:overwritten|deleted|lost)|data loss|database migration|schema migration|destructive migration|breaking migration|ambiguous design|product decision)\b/i
const requiredSections = ['Observed', 'Expected', 'Reproduction', 'Acceptance']

export const claimMarkerPrefix = '<!-- coursecraft-repair-claim:v1'
export const finishMarkerPrefix = '<!-- coursecraft-repair-finish:v1'
export const cancelMarkerPrefix = '<!-- coursecraft-repair-cancel:v1'

export function workflowStateCandidates(state) {
  return state === 'Triage' ? ['Triage', 'Backlog'] : [state]
}

export class DispatchRefusal extends Error {
  constructor(code, message, classification = 'needs-human-review') {
    super(message)
    this.name = 'DispatchRefusal'
    this.code = code
    this.classification = classification
  }
}

function labelNames(issue) {
  return new Set((issue.labels ?? []).map((label) => String(label.name ?? label).toLowerCase()))
}

function section(description, heading) {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = description.match(
    new RegExp(`(?:^|\\n)##\\s+${escaped}\\s*\\n([\\s\\S]*?)(?=\\n##\\s+|$)`, 'i'),
  )
  return match?.[1]?.trim() ?? ''
}

function humanApproval(issue, approverIds) {
  return (issue.comments ?? []).find((comment) => {
    const body = String(comment.body ?? '').trim()
    return (
      /^\/autofix approve(?:\s|$)/i.test(body) &&
      approverIds.has(String(comment.user?.id ?? '')) &&
      comment.user?.isBot !== true
    )
  })
}

export function claimState(comments = []) {
  const claims = new Map()
  const terminal = new Set()
  const canceled = new Set()
  for (const comment of comments) {
    const body = String(comment.body ?? '')
    const claim = body.match(
      /<!-- coursecraft-repair-claim:v1 issue=([A-Z]+-\d+) attempt=([a-z0-9-]+) -->/i,
    )
    const finish = body.match(
      /<!-- coursecraft-repair-finish:v1 attempt=([a-z0-9-]+) status=([a-z-]+) -->/i,
    )
    const cancel = body.match(
      /<!-- coursecraft-repair-cancel:v1 attempt=([a-z0-9-]+) -->/i,
    )
    if (claim) claims.set(claim[2], { attemptId: claim[2], issueIdentifier: claim[1] })
    if (finish) terminal.add(finish[1])
    if (cancel) canceled.add(cancel[1])
  }
  return {
    active: [...claims.values()].filter(
      (claim) => !terminal.has(claim.attemptId) && !canceled.has(claim.attemptId),
    ),
    canceled,
    terminal,
  }
}

export function evaluateRepairIssue(issue, config) {
  const reasons = []
  const labels = labelNames(issue)
  const description = String(issue.description ?? '')
  if (issue.project?.id !== config.projectId) reasons.push('wrong_project')
  if (issue.team?.id !== config.teamId) reasons.push('wrong_team')
  if (!activeStateTypes.has(String(issue.state?.type ?? '').toLowerCase())) {
    reasons.push('inactive_state')
  }
  if (!labels.has('bug')) reasons.push('missing_bug_label')
  if (!labels.has('autofix-ready')) reasons.push('missing_autofix_ready')
  if (labels.has('needs-repro')) reasons.push('needs_repro')
  if (labels.has('needs-human-review')) reasons.push('needs_human_review')
  if (!description.includes('<!-- coursecraft-bug-fingerprint:')) {
    reasons.push('missing_workflow_marker')
  }
  for (const heading of requiredSections) {
    if (!section(description, heading)) {
      reasons.push(`missing_${heading.toLowerCase()}_section`)
    }
  }
  const scopedText = [
    issue.title,
    section(description, 'Observed'),
    section(description, 'Expected'),
    section(description, 'Reproduction'),
    section(description, 'Acceptance'),
  ].join('\n')
  if (unsafePattern.test(scopedText)) reasons.push('unsafe_scope')
  if ((issue.attachments ?? []).some((attachment) => attachment.kind === 'unknown')) {
    reasons.push('unknown_attachment')
  }
  if (!humanApproval(issue, config.approverIds)) reasons.push('missing_human_approval')
  if (!issue.branchName || !/^[a-z0-9][a-z0-9/._-]{2,180}$/i.test(issue.branchName)) {
    reasons.push('invalid_branch_name')
  }
  return {
    eligible: reasons.length === 0,
    reasons,
    sections: Object.fromEntries(
      requiredSections.map((heading) => [heading.toLowerCase(), section(description, heading)]),
    ),
  }
}

export function buildCodexPrompt(issue, plan) {
  return `You are repairing ${issue.identifier} in an isolated git worktree on branch ${issue.branchName}.

Safety contract:
- Work only inside the current repository and only within this issue's stated scope.
- Do not read or use environment credentials, contact Linear, merge, deploy, close issues, or delete branches.
- Stop with status "needs-human-review" for security/privacy, save corruption, destructive migrations, ambiguous design, missing authority, or expanded scope.
- First reproduce the bug. Then add a regression test and demonstrate that it fails for the expected reason before changing implementation code.
- Preserve unrelated files. Run focused checks and commit the scoped repair. Do not push or open a pull request; the dispatcher owns those gates.
- Return only the JSON required by the supplied output schema.

Issue title:
${issue.title}

Observed:
${plan.sections.observed}

Expected:
${plan.sections.expected}

Reproduction:
${plan.sections.reproduction}

Acceptance:
${plan.sections.acceptance}
`
}

function finishMarker(attemptId, status) {
  return `${finishMarkerPrefix} attempt=${attemptId} status=${status} -->`
}

async function finish(linear, issue, attemptId, status, message, transition = {}) {
  await linear.addComment(
    issue.id,
    `${finishMarker(attemptId, status)}\n\n${message}`,
  )
  if (Object.keys(transition).length) await linear.transition(issue, transition)
}

function validateCodexSuccess(result, issue) {
  if (result?.status !== 'success') return
  if (
    typeof result.regressionTest !== 'string' ||
    !result.regressionTest.trim() ||
    !Array.isArray(result.targetedTests) ||
    result.targetedTests.length === 0 ||
    typeof result.summary !== 'string' ||
    !result.summary.trim()
  ) {
    throw new DispatchRefusal(
      'invalid_codex_result',
      'Codex did not return the required regression and test evidence.',
    )
  }
  if (result.branch && result.branch !== issue.branchName) {
    throw new DispatchRefusal('branch_mismatch', 'Codex reported a different branch.')
  }
}

/**
 * All side effects are injected. Dry-run evaluation therefore exercises the
 * exact production eligibility logic without a network, git, or Codex call.
 */
export async function dispatchRepair({
  issue,
  config,
  dryRun = true,
  attemptId,
  linear,
  git,
  codex,
  checks,
  pullRequests,
  isCanceled = async () => false,
}) {
  const plan = evaluateRepairIssue(issue, config)
  if (!plan.eligible) {
    return { status: 'ineligible', reasons: plan.reasons }
  }
  const existingClaims = claimState(issue.comments)
  if (existingClaims.active.length) {
    return {
      status: 'duplicate',
      attemptId: existingClaims.active[0].attemptId,
    }
  }
  if (dryRun) {
    return {
      status: 'dry-run',
      branch: issue.branchName,
      prompt: buildCodexPrompt(issue, plan),
    }
  }
  if (!config.enabled) {
    return { status: 'disabled' }
  }
  if (await isCanceled(issue.identifier)) return { status: 'canceled' }

  const claim = await git.claimBranch({
    attemptId,
    baseBranch: config.baseBranch,
    branch: issue.branchName,
    issue,
  })
  if (!claim.claimed) return { status: 'duplicate', reason: 'branch_already_claimed' }

  await linear.addComment(
    issue.id,
    `${claimMarkerPrefix} issue=${issue.identifier} attempt=${attemptId} -->\n\nRepair dispatcher claimed this issue on \`${issue.branchName}\`. The branch claim commit is \`${claim.commit}\`.`,
  )
  await linear.transition(issue, { state: 'In Progress' })

  if (await isCanceled(issue.identifier)) {
    await finish(
      linear,
      issue,
      attemptId,
      'canceled',
      'The operator canceled this attempt before Codex started.',
      { addLabel: 'needs-human-review', removeLabel: 'autofix-ready' },
    )
    return { status: 'canceled' }
  }

  let result
  try {
    result = await codex.run({
      attemptId,
      issue,
      prompt: buildCodexPrompt(issue, plan),
      worktree: claim.worktree,
    })
    validateCodexSuccess(result, issue)
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Codex failed without a classified error.'
    await finish(
      linear,
      issue,
      attemptId,
      'failed',
      `Repair stopped before review: ${message}`,
      { addLabel: 'needs-human-review', removeLabel: 'autofix-ready' },
    )
    return { status: 'failed', classification: 'needs-human-review', message }
  }

  if (result.status === 'needs-repro') {
    await finish(
      linear,
      issue,
      attemptId,
      'needs-repro',
      `The stated reproduction could not be confirmed. Evidence:\n\n${result.evidence}`,
      { addLabel: 'needs-repro', removeLabel: 'autofix-ready', state: 'Triage' },
    )
    return { status: 'needs-repro' }
  }
  if (result.status !== 'success') {
    const message = result.evidence || result.summary || 'Codex refused the repair.'
    await finish(
      linear,
      issue,
      attemptId,
      'needs-human-review',
      message,
      { addLabel: 'needs-human-review', removeLabel: 'autofix-ready' },
    )
    return { status: 'needs-human-review' }
  }

  if (await isCanceled(issue.identifier)) {
    await finish(
      linear,
      issue,
      attemptId,
      'canceled',
      'The operator canceled this attempt before required checks.',
      { addLabel: 'needs-human-review', removeLabel: 'autofix-ready' },
    )
    return { status: 'canceled' }
  }

  let checkEvidence
  try {
    checkEvidence = await checks.runRequired(claim.worktree)
    await git.pushRepair(claim.worktree, issue.branchName)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'A required check failed.'
    await finish(
      linear,
      issue,
      attemptId,
      'failed',
      `Repair code remains on the claimed branch, but required gates failed:\n\n${message}`,
      { addLabel: 'needs-human-review', removeLabel: 'autofix-ready' },
    )
    return { status: 'failed', classification: 'checks', message }
  }

  let prUrl
  try {
    prUrl = await pullRequests.openDraft({
      baseBranch: config.baseBranch,
      branch: issue.branchName,
      issue,
      summary: result.summary,
      worktree: claim.worktree,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Draft PR creation failed.'
    await finish(
      linear,
      issue,
      attemptId,
      'failed',
      `The repair and checks succeeded on \`${issue.branchName}\`, but no draft PR was created: ${message}`,
      { addLabel: 'needs-human-review', removeLabel: 'autofix-ready' },
    )
    return { status: 'failed', classification: 'pull-request', message }
  }

  await finish(
    linear,
    issue,
    attemptId,
    'success',
    `Draft repair: ${prUrl}

Regression test: ${result.regressionTest}

Targeted tests:
${result.targetedTests.map((test) => `- \`${test}\``).join('\n')}

Required gates:
${checkEvidence.map((check) => `- ${check}`).join('\n')}

Human review, merge, deployment, reporter verification, and closure are still required.`,
    { removeLabel: 'autofix-ready', state: 'In Review' },
  )
  return { status: 'success', prUrl }
}
