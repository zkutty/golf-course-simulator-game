import type { BugActionRecord, BugReportV1 } from '../src/bug-reporting/contracts'
import type { LinearIssueRef } from './types'

const linearEndpoint = 'https://api.linear.app/graphql'
const linearTimeoutMs = 12_000
interface LinearEnvironment {
  LINEAR_API_KEY?: string
  LINEAR_BUG_LABEL_IDS: string
  LINEAR_PROJECT_ID: string
  LINEAR_TEAM_ID: string
}

interface GraphqlEnvelope<T> {
  data?: T
  errors?: Array<{ message?: string }>
}

interface CreateIssueData {
  issueCreate?: {
    success?: boolean
    issue?: {
      id?: string
      identifier?: string
      title?: string
      url?: string
      archivedAt?: string | null
      state?: { type?: string }
    }
  }
}

interface CreateCommentData {
  commentCreate?: { success?: boolean }
}

interface GetIssueData {
  issue?: {
    archivedAt?: string | null
    id?: string
    identifier?: string
    title?: string
    url?: string
    state?: { type?: string }
  }
}

export class LinearConfigurationError extends Error {}
export class LinearRequestError extends Error {}
export class LinearAmbiguousMutationError extends Error {}
export class LinearIssueMissingError extends LinearRequestError {}

function requireApiKey(env: LinearEnvironment): string {
  const apiKey = env.LINEAR_API_KEY?.trim()
  if (!apiKey) throw new LinearConfigurationError('Linear intake is not configured.')
  return apiKey
}

async function queryLinear<T>(
  env: LinearEnvironment,
  query: string,
  variables: Record<string, unknown>,
  mutation: boolean,
): Promise<T> {
  const apiKey = requireApiKey(env)
  let response: Response
  try {
    response = await fetch(linearEndpoint, {
      method: 'POST',
      headers: {
        Authorization: apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(linearTimeoutMs),
    })
  } catch {
    if (mutation) {
      throw new LinearAmbiguousMutationError(
        'Linear mutation outcome is unknown; automatic retry was stopped.',
      )
    }
    throw new LinearRequestError('Linear could not be reached.')
  }

  let envelope: GraphqlEnvelope<T>
  try {
    envelope = (await response.json()) as GraphqlEnvelope<T>
  } catch {
    throw mutation && response.ok
      ? new LinearAmbiguousMutationError(
          'Linear returned an unreadable mutation response; automatic retry was stopped.',
        )
      : new LinearRequestError('Linear returned an unreadable response.')
  }

  if (!response.ok) {
    if (mutation && (response.status === 408 || response.status >= 500)) {
      throw new LinearAmbiguousMutationError(
        'Linear mutation outcome is unknown; automatic retry was stopped.',
      )
    }
    throw new LinearRequestError(`Linear request failed with HTTP ${response.status}.`)
  }

  if (envelope.errors?.length && !envelope.data) {
    const detail =
      envelope.errors
        ?.map((error) => error.message)
        .filter(Boolean)
        .join('; ')
        .slice(0, 500) || 'Linear rejected the request.'
    throw new LinearRequestError(detail)
  }
  if (!envelope.data) throw new LinearRequestError('Linear returned no data.')

  return envelope.data
}

function issueRef(
  issue:
    | {
        id?: string
        identifier?: string
        title?: string
        url?: string
        archivedAt?: string | null
        state?: { type?: string }
      }
    | undefined,
): LinearIssueRef {
  if (!issue?.id || !issue.identifier || !issue.title || !issue.url) {
    throw new LinearRequestError('Linear returned an incomplete issue.')
  }
  return {
    ...(issue.archivedAt ? { archived: true } : {}),
    id: issue.id,
    identifier: issue.identifier,
    title: issue.title,
    url: issue.url,
    ...(issue.state?.type ? { stateType: issue.state.type } : {}),
  }
}

function markdownText(value: string): string {
  return value
    .replace(/\0/g, '')
    .replace(/<!--/g, '&lt;!--')
    .replace(/-->/g, '--&gt;')
}

function oneLine(value: string): string {
  return markdownText(value).replace(/\s+/g, ' ').trim()
}

function sourceLabel(source: BugReportV1['source']): string {
  switch (source) {
    case 'manual':
      return 'Manual'
    case 'react-crash':
      return 'React crash'
    case 'window-error':
      return 'Window error'
    case 'unhandled-rejection':
      return 'Unhandled rejection'
    case 'sentry-group':
      return 'Sentry group'
  }
}

function formatAction(action: BugActionRecord): string {
  const fields = action.fields
    ? Object.entries(action.fields)
        .map(([key, value]) => `${key}=${String(value)}`)
        .join(', ')
    : ''
  return `- ${action.type}${fields ? ` (${fields})` : ''}`
}

function formatDiagnostics(report: BugReportV1): string {
  const diagnostics = report.diagnostics
  if (!diagnostics) return '_Not included by consent._'

  const lines = [
    `- Build: ${[
      diagnostics.app.version,
      diagnostics.app.release,
      diagnostics.app.commit,
      diagnostics.app.environment,
    ]
      .filter(Boolean)
      .join(' / ')}`,
    diagnostics.route ? `- Route: ${diagnostics.route}` : undefined,
    diagnostics.browser
      ? `- Runtime: ${[
          diagnostics.browser.name,
          diagnostics.browser.platform,
          diagnostics.browser.viewport
            ? `${diagnostics.browser.viewport.width}×${diagnostics.browser.viewport.height} @ ${diagnostics.browser.viewport.devicePixelRatio}x`
            : undefined,
        ]
          .filter(Boolean)
          .join(' / ')}`
      : undefined,
    diagnostics.game
      ? `- Game: ${Object.entries(diagnostics.game)
          .filter(([key]) => key !== 'camera')
          .map(([key, value]) => `${key}=${String(value)}`)
          .join(', ')}`
      : undefined,
    diagnostics.game?.camera
      ? `- Camera: x=${diagnostics.game.camera.centerX}, y=${diagnostics.game.camera.centerY}, zoom=${diagnostics.game.camera.zoom}, rotation=${diagnostics.game.camera.rotation}`
      : undefined,
    diagnostics.error
      ? `- Error: ${oneLine(
          `${diagnostics.error.name ?? 'Error'}: ${diagnostics.error.message}`,
        )}`
      : undefined,
    diagnostics.error?.sentryEventId
      ? `- Sentry event: ${diagnostics.error.sentryEventId}`
      : undefined,
    diagnostics.error?.sentryIssueUrl
      ? `- Sentry issue: ${diagnostics.error.sentryIssueUrl}`
      : undefined,
  ].filter((line): line is string => Boolean(line))

  if (diagnostics.error?.stack) {
    lines.push(
      '',
      '<details><summary>Bounded stack</summary>',
      '',
      '```text',
      markdownText(diagnostics.error.stack).replace(/```/g, "'''"),
      '```',
      '</details>',
    )
  }
  if (diagnostics.error?.componentStack) {
    lines.push(
      '',
      '<details><summary>React component stack</summary>',
      '',
      '```text',
      markdownText(diagnostics.error.componentStack).replace(/```/g, "'''"),
      '```',
      '</details>',
    )
  }
  if (diagnostics.recentActions?.length) {
    lines.push(
      '',
      '<details><summary>Recent safe actions</summary>',
      '',
      ...diagnostics.recentActions.map(formatAction),
      '',
      '</details>',
    )
  }

  return lines.join('\n')
}

export function linearPriorityFor(report: BugReportV1): 2 | 3 | 4 {
  if (report.summary.severity === 'critical' || report.summary.severity === 'high') {
    return 2
  }
  if (report.summary.severity === 'medium') return 3
  return 4
}

export function formatIssueTitle(report: BugReportV1, regression = false): string {
  const prefix = regression ? '[Regression]' : `[${sourceLabel(report.source)}]`
  return `${prefix} ${oneLine(report.summary.title)}`.slice(0, 255)
}

export function formatIssueDescription(
  report: BugReportV1,
  fingerprint: string,
  regressionOf?: LinearIssueRef,
  evidenceFailure?: string,
): string {
  const evidence = report.screenshot
    ? `![Consented CourseCraft screenshot](${report.screenshot.dataUrl})`
    : evidenceFailure
      ? `_Screenshot omitted: ${oneLine(evidenceFailure)}_`
      : '_No screenshot included._'
  const regression = regressionOf
    ? `\n- Regression of: [${regressionOf.identifier}](${regressionOf.url})`
    : ''

  return `<!-- coursecraft-bug-fingerprint:${fingerprint} -->
<!-- coursecraft-report-id:${report.reportId} -->

## Observed

${markdownText(report.summary.actual)}

## Expected

${markdownText(report.summary.expected)}

## Reproduction

${report.summary.steps
  .map((step, index) => `${index + 1}. ${markdownText(step)}`)
  .join('\n')}

## Acceptance

- [ ] A focused regression test reproduces this report before the fix and passes after it.
- [ ] ${markdownText(report.summary.expected)}
- [ ] No save data, privacy boundary, or unrelated deterministic simulation behavior regresses.

## Safe diagnostic capsule

${formatDiagnostics(report)}

## Evidence

${evidence}

## Intake

- Source: ${sourceLabel(report.source)}
- Reporter severity: ${report.summary.severity}
- Report ID: ${report.reportId}
- First occurrence: ${report.createdAt}
- Diagnostics consent: ${report.consent.diagnostics ? 'yes' : 'no'}
- Screenshot consent: ${report.consent.screenshot ? 'yes' : 'no'}${regression}
`
}

export function formatOccurrenceComment(
  report: BugReportV1,
  occurrenceCount: number,
): string {
  const diagnostics = report.diagnostics
  return `Duplicate occurrence #${occurrenceCount}

- Report ID: ${report.reportId}
- Occurred: ${report.createdAt}
- Reporter severity: ${report.summary.severity}
- Build: ${diagnostics?.app.version ?? 'not consented'}${
    diagnostics?.app.commit ? ` / ${diagnostics.app.commit}` : ''
  }
- Location: ${[
    diagnostics?.route,
    diagnostics?.game?.screen,
    diagnostics?.game?.mode,
    diagnostics?.game?.tool,
  ]
    .filter(Boolean)
    .join(' / ') || 'not consented'}

Screenshot and full stack are intentionally not duplicated.`
}

export async function createLinearIssue(
  env: LinearEnvironment,
  report: BugReportV1,
  fingerprint: string,
  regressionOf?: LinearIssueRef,
): Promise<LinearIssueRef> {
  const create = async (
    candidate: BugReportV1,
    evidenceFailure?: string,
  ): Promise<LinearIssueRef> => {
    const data = await queryLinear<CreateIssueData>(
      env,
      `mutation CourseCraftBugCreate($input: IssueCreateInput!) {
        issueCreate(input: $input) {
          success
          issue { id identifier title url archivedAt state { type } }
        }
      }`,
      {
        input: {
          teamId: env.LINEAR_TEAM_ID,
          projectId: env.LINEAR_PROJECT_ID,
          labelIds: env.LINEAR_BUG_LABEL_IDS.split(',').map((value) => value.trim()),
          title: formatIssueTitle(candidate, Boolean(regressionOf)),
          description: formatIssueDescription(
            candidate,
            fingerprint,
            regressionOf,
            evidenceFailure,
          ),
          priority: linearPriorityFor(candidate),
        },
      },
      true,
    )
    if (!data.issueCreate?.success) {
      throw new LinearRequestError('Linear did not create the issue.')
    }
    return issueRef(data.issueCreate.issue)
  }

  try {
    return await create(report)
  } catch (error) {
    if (!(error instanceof LinearRequestError) || !report.screenshot) throw error
    // A GraphQL validation failure is a confirmed non-mutation. Retry once
    // without the image so the text report survives provider evidence limits.
    const { screenshot: _screenshot, ...withoutScreenshot } = report
    return create(
      withoutScreenshot,
      'Linear rejected the consented image; the text report was preserved for triage.',
    )
  }
}

export async function addLinearComment(
  env: LinearEnvironment,
  issueId: string,
  body: string,
): Promise<void> {
  const data = await queryLinear<CreateCommentData>(
    env,
    `mutation CourseCraftBugComment($input: CommentCreateInput!) {
      commentCreate(input: $input) { success }
    }`,
    { input: { issueId, body } },
    true,
  )
  if (!data.commentCreate?.success) {
    throw new LinearRequestError('Linear did not create the occurrence comment.')
  }
}

export async function getLinearIssue(
  env: LinearEnvironment,
  issueId: string,
): Promise<LinearIssueRef> {
  const data = await queryLinear<GetIssueData>(
    env,
    `query CourseCraftBugState($id: String!) {
      issue(id: $id) { id identifier title url archivedAt state { type } }
    }`,
    { id: issueId },
    false,
  )
  if (!data.issue) {
    throw new LinearIssueMissingError(
      'The canonical Linear issue was deleted or is no longer accessible.',
    )
  }
  return issueRef(data.issue)
}
