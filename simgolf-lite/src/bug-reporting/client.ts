import {
  sanitizeBugReport,
  type BugReportV1,
  type BugReportValidationIssue,
} from './contracts'

export interface BugReportSubmission {
  canonical: boolean
  duplicate: boolean
  issueId: string
  issueIdentifier: string
  issueUrl: string
  occurrenceCount: number
  reportId: string
}

export class BugReportClientError extends Error {
  readonly code: string
  readonly retryable: boolean
  readonly validationIssues?: BugReportValidationIssue[]

  constructor(
    message: string,
    options: {
      code?: string
      retryable?: boolean
      validationIssues?: BugReportValidationIssue[]
    } = {},
  ) {
    super(message)
    this.name = 'BugReportClientError'
    this.code = options.code ?? 'request_failed'
    this.retryable = options.retryable ?? false
    this.validationIssues = options.validationIssues
  }
}

interface ErrorPayload {
  error?: unknown
  code?: unknown
  message?: unknown
  retryable?: unknown
  issues?: unknown
}

interface ServerSubmission {
  status?: unknown
  issue?: unknown
  occurrenceCount?: unknown
  retryAfterSeconds?: unknown
  message?: unknown
}

const inFlight = new Map<string, Promise<BugReportSubmission>>()

function parseErrorPayload(value: unknown): ErrorPayload {
  return typeof value === 'object' && value !== null ? value as ErrorPayload : {}
}

async function readJson(response: Response): Promise<unknown> {
  const contentType = response.headers.get('content-type') ?? ''
  if (!contentType.toLowerCase().includes('application/json')) return undefined
  try {
    return await response.json()
  } catch {
    return undefined
  }
}

function parseSubmission(
  value: unknown,
  reportId: string,
): BugReportSubmission | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const candidate = value as ServerSubmission
  if (candidate.status !== 'created' && candidate.status !== 'duplicate') {
    return undefined
  }
  if (typeof candidate.issue !== 'object' || candidate.issue === null) return undefined
  const issue = candidate.issue as Record<string, unknown>
  if (
    typeof issue.id !== 'string' ||
    typeof issue.identifier !== 'string' ||
    typeof issue.url !== 'string' ||
    typeof candidate.occurrenceCount !== 'number'
  ) {
    return undefined
  }
  return {
    canonical: candidate.status === 'created',
    duplicate: candidate.status === 'duplicate',
    issueId: issue.id,
    issueIdentifier: issue.identifier,
    issueUrl: issue.url,
    occurrenceCount: candidate.occurrenceCount,
    reportId,
  }
}

async function postBugReport(
  report: BugReportV1,
  options: { fetchFn?: typeof fetch; signal?: AbortSignal; timeoutMs?: number },
): Promise<BugReportSubmission> {
  const validation = sanitizeBugReport(report)
  if (!validation.ok) {
    throw new BugReportClientError('Review the highlighted report fields.', {
      code: 'validation_failed',
      validationIssues: validation.issues,
    })
  }

  const fetchFn = options.fetchFn ?? fetch
  const timeoutController = new AbortController()
  const timeoutMs = options.timeoutMs ?? 15_000
  const timeout = window.setTimeout(() => timeoutController.abort('timeout'), timeoutMs)
  const onAbort = (): void => timeoutController.abort(options.signal?.reason ?? 'canceled')
  options.signal?.addEventListener('abort', onAbort, { once: true })

  try {
    const response = await fetchFn('/api/bug-reports', {
      body: JSON.stringify(validation.value),
      credentials: 'same-origin',
      headers: {
        'content-type': 'application/json',
        'x-coursecraft-report-id': validation.value.reportId,
      },
      method: 'POST',
      signal: timeoutController.signal,
    })
    const payload = await readJson(response)
    const serverPayload =
      typeof payload === 'object' && payload !== null
        ? (payload as ServerSubmission)
        : undefined
    if (response.status === 202 && serverPayload?.status === 'processing') {
      throw new BugReportClientError(
        typeof serverPayload.message === 'string'
          ? serverPayload.message
          : 'The report is being reconciled. You can safely retry.',
        {
          code: 'processing',
          retryable: true,
        },
      )
    }
    if (!response.ok) {
      const error = parseErrorPayload(payload)
      throw new BugReportClientError(
        typeof error.message === 'string'
          ? error.message
          : 'The report could not be submitted.',
        {
          code:
            typeof error.code === 'string'
              ? error.code
              : typeof error.error === 'string'
                ? error.error
                : `http_${response.status}`,
          retryable: error.retryable === true,
          validationIssues: Array.isArray(error.issues)
            ? error.issues as BugReportValidationIssue[]
            : undefined,
        },
      )
    }
    const submission = parseSubmission(payload, validation.value.reportId)
    if (!submission) {
      throw new BugReportClientError('The server returned an invalid response.', {
        code: 'invalid_response',
        retryable: true,
      })
    }
    return submission
  } catch (error) {
    if (error instanceof BugReportClientError) throw error
    if (timeoutController.signal.aborted) {
      const canceled = options.signal?.aborted === true
      throw new BugReportClientError(
        canceled ? 'Submission canceled.' : 'The report timed out. You can safely retry.',
        {
          code: canceled ? 'canceled' : 'timeout',
          retryable: !canceled,
        },
      )
    }
    throw new BugReportClientError(
      navigator.onLine
        ? 'The report service is unavailable. You can safely retry.'
        : 'You are offline. Reconnect and retry without closing this dialog.',
      { code: navigator.onLine ? 'network_error' : 'offline', retryable: true },
    )
  } finally {
    window.clearTimeout(timeout)
    options.signal?.removeEventListener('abort', onAbort)
  }
}

/**
 * Repeated submits for the same report ID share one in-flight request. A
 * completed retry reuses the same report ID so Worker idempotency remains the
 * authority across network ambiguity and page processes.
 */
export function submitBugReport(
  report: BugReportV1,
  options: { fetchFn?: typeof fetch; signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<BugReportSubmission> {
  const existing = inFlight.get(report.reportId)
  if (existing) return existing
  const request = postBugReport(report, options).finally(() => {
    if (inFlight.get(report.reportId) === request) inFlight.delete(report.reportId)
  })
  inFlight.set(report.reportId, request)
  return request
}

export function resetBugReportClientForTests(): void {
  inFlight.clear()
}
