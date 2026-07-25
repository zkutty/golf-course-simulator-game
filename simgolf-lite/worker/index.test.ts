import { describe, expect, it, vi } from 'vitest'
import {
  BUG_REPORT_LIMITS,
  type BugReportV1,
} from '../src/bug-reporting/contracts'
import { handleRequest } from './index'
import type { WorkerEnv } from './types'

function report(): BugReportV1 {
  return {
    schemaVersion: 1,
    reportId: 'f2d74af8-1469-4cc1-833c-ff61cb7c6bb3',
    createdAt: '2026-07-25T00:00:00.000Z',
    source: 'manual',
    summary: {
      title: 'Golfer is stuck near the green',
      actual: 'The golfer remains idle.',
      expected: 'The golfer should continue.',
      severity: 'high',
      steps: ['Start a game', 'Advance the clock'],
    },
    consent: { diagnostics: false, screenshot: false },
  }
}

function environment(options: {
  enabled?: boolean
  rateLimited?: boolean
  sentryEnabled?: boolean
  submitRequest?: ReturnType<typeof vi.fn>
} = {}): WorkerEnv {
  const submitRequest =
    options.submitRequest ??
    vi.fn().mockResolvedValue({
      status: 'created',
      occurrenceCount: 1,
      issue: {
        id: 'issue-id',
        identifier: 'ZK-999',
        title: 'Bug',
        url: 'https://linear.app/zkutty/issue/ZK-999',
      },
    })
  return {
    BUG_REPORT_OPERATOR_SECRET: 'abcdef0123456789abcdef0123456789',
    BUG_REPORTING_ENABLED: options.enabled === false ? 'false' : 'true',
    SENTRY_ROUTING_ENABLED: options.sentryEnabled ? 'true' : 'false',
    SENTRY_WEBHOOK_SECRET: '0123456789abcdef0123456789abcdef',
    LINEAR_TEAM_ID: '7abe7bd3-d61f-4358-9ee5-071765d3f379',
    LINEAR_PROJECT_ID: 'cd09f00a-5774-4874-8baa-d968f1067ad9',
    LINEAR_BUG_LABEL_IDS:
      'd1cb9894-4a96-4f05-893f-1ea74b63acda,c0fc2566-fa7e-4876-a052-b2ae8770e7fd',
    BUG_REPORT_RATE_LIMIT: {
      limit: vi.fn().mockResolvedValue({ success: !options.rateLimited }),
    },
    BUG_REPORT_COORDINATOR: {
      getByName: vi.fn().mockReturnValue({ submitRequest }),
    },
    ASSETS: {
      fetch: vi.fn().mockResolvedValue(new Response('asset')),
    },
  } as unknown as WorkerEnv
}

function post(body: unknown, headers: HeadersInit = {}): Request {
  return new Request('https://playtest.example/api/bug-reports', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'https://playtest.example',
      'CF-Connecting-IP': '192.0.2.1',
      ...headers,
    },
    body: JSON.stringify(body),
  })
}

describe('bug intake Worker', () => {
  it('exposes runtime configuration without secrets', async () => {
    const response = await handleRequest(
      new Request('https://playtest.example/api/bug-reports/config'),
      environment(),
    )
    const body = await response.clone().text()

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(
      expect.objectContaining({ enabled: true, schemaVersion: 1 }),
    )
    expect(body).not.toContain('LINEAR')
  })

  it('validates and routes a same-origin report by request ID', async () => {
    const submitRequest = vi.fn().mockResolvedValue({
      status: 'created',
      occurrenceCount: 1,
      issue: {
        id: 'issue-id',
        identifier: 'ZK-999',
        title: 'Bug',
        url: 'https://linear.app/zkutty/issue/ZK-999',
      },
    })
    const env = environment({ submitRequest })
    const response = await handleRequest(post(report()), env)

    expect(response.status).toBe(201)
    expect(env.BUG_REPORT_COORDINATOR.getByName).toHaveBeenCalledWith(
      `request:${report().reportId}`,
    )
    expect(submitRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        fingerprint: expect.stringMatching(/^[0-9a-f]{64}$/),
        report: expect.objectContaining({ reportId: report().reportId }),
      }),
    )
  })

  it('rejects cross-origin, malformed, and rate-limited intake', async () => {
    expect(
      (
        await handleRequest(
          post(report(), { Origin: 'https://attacker.example' }),
          environment(),
        )
      ).status,
    ).toBe(403)

    expect((await handleRequest(post({ schemaVersion: 99 }), environment())).status).toBe(
      400,
    )

    expect(
      (await handleRequest(post(report()), environment({ rateLimited: true }))).status,
    ).toBe(429)
  })

  it('fails closed for disabled, wrong-method, unsupported, and oversized intake', async () => {
    expect(
      (await handleRequest(post(report()), environment({ enabled: false }))).status,
    ).toBe(503)

    expect(
      (
        await handleRequest(
          new Request('https://playtest.example/api/bug-reports', {
            method: 'GET',
            headers: { Origin: 'https://playtest.example' },
          }),
          environment(),
        )
      ).status,
    ).toBe(405)

    expect(
      (
        await handleRequest(
          new Request('https://playtest.example/api/bug-reports', {
            method: 'POST',
            headers: {
              'Content-Type': 'text/plain',
              Origin: 'https://playtest.example',
            },
            body: '{}',
          }),
          environment(),
        )
      ).status,
    ).toBe(415)

    const oversized = new Request('https://playtest.example/api/bug-reports', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://playtest.example',
      },
      body: JSON.stringify({
        padding: 'x'.repeat(BUG_REPORT_LIMITS.totalBytes + 4_097),
      }),
    })
    expect((await handleRequest(oversized, environment())).status).toBe(413)
  })

  it('reserves the Sentry source and validates screenshot bytes server-side', async () => {
    expect(
      (
        await handleRequest(
          post({ ...report(), source: 'sentry-group' }),
          environment(),
        )
      ).status,
    ).toBe(400)

    const invalidScreenshot = {
      ...report(),
      consent: { diagnostics: false, screenshot: true },
      screenshot: {
        bytes: 4,
        dataUrl: 'data:image/png;base64,AAAAAA==',
        height: 1,
        mime: 'image/png',
        width: 1,
      },
    }
    expect(
      (await handleRequest(post(invalidScreenshot), environment())).status,
    ).toBe(400)
  })

  it('maps reconciliation and provider failures to safe response semantics', async () => {
    const processing = await handleRequest(
      post(report()),
      environment({
        submitRequest: vi.fn().mockResolvedValue({
          status: 'processing',
          retryAfterSeconds: 60,
        }),
      }),
    )
    expect(processing.status).toBe(202)
    expect(processing.headers.get('Retry-After')).toBe('60')

    const failed = await handleRequest(
      post(report()),
      environment({
        submitRequest: vi.fn().mockResolvedValue({
          status: 'failed',
          retryable: true,
        }),
      }),
    )
    expect(failed.status).toBe(502)
  })

  it('protects operator reconciliation and rejects reports that are not pinned', async () => {
    const env = environment()
    const unauthenticated = await handleRequest(
      new Request('https://playtest.example/api/bug-reports/reconcile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          outcome: 'not-created',
          reportId: report().reportId,
        }),
      }),
      env,
    )
    expect(unauthenticated.status).toBe(401)

    const requestStub = {
      getRequestReconciliation: vi.fn().mockResolvedValue(undefined),
    }
    ;(
      env.BUG_REPORT_COORDINATOR.getByName as unknown as ReturnType<typeof vi.fn>
    ).mockReturnValue(requestStub)
    const notPinned = await handleRequest(
      new Request('https://playtest.example/api/bug-reports/reconcile', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CourseCraft-Operator-Secret':
            'abcdef0123456789abcdef0123456789',
        },
        body: JSON.stringify({
          outcome: 'not-created',
          reportId: report().reportId,
        }),
      }),
      env,
    )
    expect(notPinned.status).toBe(409)
    expect(requestStub.getRequestReconciliation).toHaveBeenCalledWith(
      report().reportId,
    )
  })

  it('delegates non-API requests to the static asset binding', async () => {
    const env = environment()
    const response = await handleRequest(
      new Request('https://playtest.example/play'),
      env,
    )

    expect(await response.text()).toBe('asset')
    expect(env.ASSETS.fetch).toHaveBeenCalledOnce()
  })

  it('authenticates and routes qualifying Sentry groups through the same coordinator', async () => {
    const submitRequest = vi.fn().mockResolvedValue({
      status: 'created',
      occurrenceCount: 1,
      issue: {
        id: 'issue-id',
        identifier: 'ZK-999',
        title: 'Bug',
        url: 'https://linear.app/zkutty/issue/ZK-999',
      },
    })
    const response = await handleRequest(
      new Request('https://playtest.example/api/sentry/issues', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CourseCraft-Webhook-Secret':
            '0123456789abcdef0123456789abcdef',
        },
        body: JSON.stringify({
          action: 'triggered',
          data: {
            issue: {
              id: 'sentry-group-1',
              title: 'TypeError in simulation',
              count: 4,
            },
            event: {
              eventID: '1234567890abcdef1234567890abcdef',
              message: 'Cannot read properties of undefined',
              level: 'error',
              environment: 'staging',
            },
          },
        }),
      }),
      environment({ sentryEnabled: true, submitRequest }),
    )

    expect(response.status).toBe(201)
    expect(submitRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        report: expect.objectContaining({ source: 'sentry-group' }),
      }),
    )
  })
})
