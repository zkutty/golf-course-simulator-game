import {
  BUG_REPORT_LIMITS,
  sanitizeBugReport,
} from '../src/bug-reporting/contracts'
import { BugReportCoordinator } from './bug-report-coordinator'
import { validatePngEvidence } from './evidence'
import { fingerprintBugReport, opaqueRateLimitKey } from './fingerprint'
import { getLinearIssue } from './linear'
import {
  sentryPayloadToReport,
  sentryRateKey,
  verifySentryWebhook,
} from './sentry'
import type { SubmissionResult, WorkerEnv } from './types'

export { BugReportCoordinator }

const apiHeaders = {
  'Cache-Control': 'no-store',
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
} as const

function json(value: unknown, status = 200, extraHeaders?: HeadersInit): Response {
  return Response.json(value, {
    status,
    headers: {
      ...apiHeaders,
      ...extraHeaders,
    },
  })
}

function methodNotAllowed(allow: string): Response {
  return json({ error: 'method_not_allowed' }, 405, { Allow: allow })
}

function sameOrigin(request: Request): boolean {
  const origin = request.headers.get('Origin')
  return Boolean(origin && origin === new URL(request.url).origin)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function secretsEqual(left: string, right: string): Promise<boolean> {
  if (right.length < 24) return false
  const digest = async (value: string): Promise<Uint8Array> =>
    new Uint8Array(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)),
    )
  const [leftDigest, rightDigest] = await Promise.all([digest(left), digest(right)])
  let difference = 0
  for (let index = 0; index < leftDigest.length; index += 1) {
    difference |= leftDigest[index] ^ rightDigest[index]
  }
  return difference === 0
}

async function readBoundedBody(
  request: Request,
  maximumBytes = BUG_REPORT_LIMITS.totalBytes + 4_096,
): Promise<ArrayBuffer> {
  const contentLength = request.headers.get('Content-Length')
  if (contentLength) {
    const declaredLength = Number(contentLength)
    if (
      !Number.isSafeInteger(declaredLength) ||
      declaredLength < 0 ||
      declaredLength > maximumBytes
    ) {
      throw new Error('body_too_large')
    }
  }
  if (!request.body) return new ArrayBuffer(0)

  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let totalBytes = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      totalBytes += value.byteLength
      if (totalBytes > maximumBytes) {
        await reader.cancel('body_too_large')
        throw new Error('body_too_large')
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }

  const result = new Uint8Array(totalBytes)
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.byteLength
  }
  return result.buffer
}

function parseJsonBody(body: ArrayBuffer): unknown {
  try {
    return JSON.parse(new TextDecoder().decode(body)) as unknown
  } catch {
    throw new Error('invalid_json')
  }
}

async function coordinateReport(
  report: import('../src/bug-reporting/contracts').BugReportV1,
  env: WorkerEnv,
): Promise<Response> {
  const fingerprint = await fingerprintBugReport(report)
  const stub = env.BUG_REPORT_COORDINATOR.getByName(
    `request:${report.reportId}`,
  ) as DurableObjectStub<BugReportCoordinator>
  const result = await stub.submitRequest({ fingerprint, report })
  console.log(
    JSON.stringify({
      event: 'bug_report_intake',
      occurrenceCount: result.occurrenceCount,
      outcome: result.status,
      source: report.source,
    }),
  )
  return responseForSubmission(result)
}

function responseForSubmission(result: SubmissionResult): Response {
  if (result.status === 'created') return json(result, 201)
  if (result.status === 'duplicate') return json(result)
  if (result.status === 'processing') {
    return json(result, 202, {
      'Retry-After': String(result.retryAfterSeconds ?? 60),
    })
  }
  return json(result, 502)
}

async function submitBugReport(
  request: Request,
  env: WorkerEnv,
): Promise<Response> {
  if (env.BUG_REPORTING_ENABLED !== 'true') {
    return json(
      {
        error: 'bug_reporting_disabled',
        message: 'Bug reporting is temporarily disabled.',
        retryable: true,
      },
      503,
    )
  }
  if (request.method !== 'POST') return methodNotAllowed('POST')
  if (!sameOrigin(request)) return json({ error: 'origin_not_allowed' }, 403)

  const contentType = request.headers.get('Content-Type')?.split(';', 1)[0].trim()
  if (contentType !== 'application/json') {
    return json({ error: 'unsupported_media_type' }, 415)
  }

  const ipAddress = request.headers.get('CF-Connecting-IP') ?? 'unknown'
  const rateResult = await env.BUG_REPORT_RATE_LIMIT.limit({
    key: await opaqueRateLimitKey(ipAddress),
  })
  if (!rateResult.success) {
    return json(
      {
        error: 'rate_limited',
        message: 'Too many reports were submitted. Wait a minute and retry.',
        retryable: true,
      },
      429,
      { 'Retry-After': '60' },
    )
  }

  let input: unknown
  try {
    input = parseJsonBody(await readBoundedBody(request))
  } catch (error) {
    const code = error instanceof Error ? error.message : 'invalid_request'
    return json({ error: code }, code === 'body_too_large' ? 413 : 400)
  }

  const validation = sanitizeBugReport(input)
  if (!validation.ok) {
    return json(
      {
        error: 'invalid_bug_report',
        issues: validation.issues.map(({ code, path }) => ({ code, path })),
      },
      400,
    )
  }
  if (validation.value.source === 'sentry-group') {
    return json({ error: 'reserved_report_source' }, 400)
  }

  let report = validation.value
  if (report.screenshot) {
    const evidence = validatePngEvidence(report.screenshot)
    if (!evidence.ok) {
      return json({ error: 'invalid_screenshot', reason: evidence.reason }, 400)
    }
    report = { ...report, screenshot: evidence.screenshot }
  }

  return coordinateReport(report, env)
}

async function routeSentryIssue(
  request: Request,
  env: WorkerEnv,
): Promise<Response> {
  if (env.SENTRY_ROUTING_ENABLED !== 'true') {
    return json({ error: 'sentry_routing_disabled' }, 503)
  }
  if (request.method !== 'POST') return methodNotAllowed('POST')
  const contentType = request.headers.get('Content-Type')?.split(';', 1)[0].trim()
  if (contentType !== 'application/json') {
    return json({ error: 'unsupported_media_type' }, 415)
  }
  const secret = env.SENTRY_WEBHOOK_SECRET?.trim()
  if (!secret) return json({ error: 'sentry_routing_unconfigured' }, 503)

  let body: ArrayBuffer
  try {
    body = await readBoundedBody(request, 128_000)
  } catch {
    return json({ error: 'body_too_large' }, 413)
  }
  if (!(await verifySentryWebhook(body, request.headers, secret))) {
    return json({ error: 'invalid_webhook_signature' }, 401)
  }

  let payload: unknown
  try {
    payload = parseJsonBody(body)
  } catch {
    return json({ error: 'invalid_json' }, 400)
  }
  const configuredMinimum = Number(env.SENTRY_MIN_OCCURRENCES ?? '3')
  const minimumOccurrences =
    Number.isSafeInteger(configuredMinimum) && configuredMinimum > 0
      ? configuredMinimum
      : 3
  const converted = await sentryPayloadToReport(payload, {
    minimumOccurrences,
    promoted: request.headers.get('X-CourseCraft-Promote') === 'true',
  })
  if (!converted.ok) {
    return json(
      {
        status: converted.status === 202 ? 'ignored' : 'rejected',
        reason: converted.reason,
      },
      converted.status,
    )
  }

  const rateResult = await env.BUG_REPORT_RATE_LIMIT.limit({
    key: await sentryRateKey(converted.groupId),
  })
  if (!rateResult.success) {
    return json({ error: 'rate_limited' }, 429, { 'Retry-After': '60' })
  }
  return coordinateReport(converted.report, env)
}

async function reconcileBugReport(
  request: Request,
  env: WorkerEnv,
): Promise<Response> {
  if (request.method !== 'POST') return methodNotAllowed('POST')
  const contentType = request.headers.get('Content-Type')?.split(';', 1)[0].trim()
  if (contentType !== 'application/json') {
    return json({ error: 'unsupported_media_type' }, 415)
  }
  const configuredSecret = env.BUG_REPORT_OPERATOR_SECRET?.trim()
  if (!configuredSecret) {
    return json({ error: 'operator_reconciliation_unconfigured' }, 503)
  }
  const ipAddress = request.headers.get('CF-Connecting-IP') ?? 'unknown'
  const rateResult = await env.BUG_REPORT_RATE_LIMIT.limit({
    key: await opaqueRateLimitKey(`operator-reconciliation:${ipAddress}`),
  })
  if (!rateResult.success) {
    return json({ error: 'rate_limited' }, 429, { 'Retry-After': '60' })
  }
  if (
    !(await secretsEqual(
      request.headers.get('X-CourseCraft-Operator-Secret') ?? '',
      configuredSecret,
    ))
  ) {
    return json({ error: 'operator_authentication_failed' }, 401)
  }

  let input: unknown
  try {
    input = parseJsonBody(await readBoundedBody(request, 16_384))
  } catch (error) {
    const code = error instanceof Error ? error.message : 'invalid_request'
    return json({ error: code }, code === 'body_too_large' ? 413 : 400)
  }
  const reportId = isRecord(input) ? input.reportId : undefined
  const outcome = isRecord(input) ? input.outcome : undefined
  const issueId = isRecord(input) ? input.issueId : undefined
  const confirmedIssueId =
    typeof issueId === 'string' && issueId.trim() ? issueId.trim() : undefined
  if (
    typeof reportId !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      reportId,
    ) ||
    (outcome !== 'confirmed' && outcome !== 'not-created') ||
    (outcome === 'confirmed' && !confirmedIssueId)
  ) {
    return json({ error: 'invalid_reconciliation_request' }, 400)
  }

  const requestStub = env.BUG_REPORT_COORDINATOR.getByName(
    `request:${reportId}`,
  ) as DurableObjectStub<BugReportCoordinator>
  const state = await requestStub.getRequestReconciliation(reportId)
  if (!state) {
    return json({ error: 'report_not_awaiting_reconciliation' }, 409)
  }

  let issue
  if (outcome === 'confirmed') {
    try {
      issue = await getLinearIssue(env, confirmedIssueId!)
    } catch {
      return json({ error: 'confirmed_issue_not_found' }, 409)
    }
  }
  const fingerprintStub = env.BUG_REPORT_COORDINATOR.getByName(
    `fingerprint:${state.fingerprint}`,
  ) as DurableObjectStub<BugReportCoordinator>
  const reconciled = await fingerprintStub.reconcileFingerprint({
    ...(issue ? { issue } : {}),
    outcome,
    reportId,
  })
  if (!reconciled.accepted) {
    return json({ error: 'reconciliation_state_conflict' }, 409)
  }
  if (
    !(await requestStub.applyRequestReconciliation(
      reportId,
      reconciled.result,
    ))
  ) {
    return json({ error: 'request_reconciliation_conflict' }, 409)
  }
  return json({
    status: 'reconciled',
    outcome,
    ...(reconciled.result ? { submission: reconciled.result } : {}),
  })
}

async function handleApiRequest(request: Request, env: WorkerEnv): Promise<Response> {
  const pathname = new URL(request.url).pathname
  if (pathname === '/api/bug-reports/config') {
    if (request.method !== 'GET') return methodNotAllowed('GET')
    return json({
      enabled: env.BUG_REPORTING_ENABLED === 'true',
      schemaVersion: 1,
      limits: {
        totalBytes: BUG_REPORT_LIMITS.totalBytes,
        screenshotBytes: BUG_REPORT_LIMITS.screenshotBytes,
        screenshotWidth: BUG_REPORT_LIMITS.screenshotWidth,
        screenshotHeight: BUG_REPORT_LIMITS.screenshotHeight,
      },
    })
  }
  if (pathname === '/api/bug-reports') return submitBugReport(request, env)
  if (pathname === '/api/bug-reports/reconcile') {
    return reconcileBugReport(request, env)
  }
  if (pathname === '/api/sentry/issues') return routeSentryIssue(request, env)
  return json({ error: 'not_found' }, 404)
}

export async function handleRequest(
  request: Request,
  env: WorkerEnv,
): Promise<Response> {
  if (new URL(request.url).pathname.startsWith('/api/')) {
    return handleApiRequest(request, env)
  }
  return env.ASSETS.fetch(request)
}

export default {
  fetch(request: Request, env: WorkerEnv): Promise<Response> {
    return handleRequest(request, env)
  },
} satisfies ExportedHandler<WorkerEnv>
