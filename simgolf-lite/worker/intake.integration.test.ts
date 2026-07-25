import { exports } from 'cloudflare:workers'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BugReportV1 } from '../src/bug-reporting/contracts'

function report(
  reportId: string,
  createdAt: string,
  title = 'Golfer is stuck near the green',
): BugReportV1 {
  return {
    schemaVersion: 1,
    reportId,
    createdAt,
    source: 'manual',
    summary: {
      title,
      actual: 'The golfer remains idle.',
      expected: 'The golfer should continue.',
      severity: 'high',
      steps: ['Start a game', 'Advance the clock'],
    },
    consent: { diagnostics: false, screenshot: false },
  }
}

function request(value: BugReportV1, ipAddress = '192.0.2.10'): Request {
  return new Request('https://playtest.example/api/bug-reports', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'https://playtest.example',
      'CF-Connecting-IP': ipAddress,
    },
    body: JSON.stringify(value),
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('Worker runtime intake and Durable Object coordination', () => {
  it('makes exact retries idempotent and aggregates a stable duplicate', async () => {
    const linearFetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { query: string }
      if (body.query.includes('CourseCraftBugCreate')) {
        return Response.json({
          data: {
            issueCreate: {
              success: true,
              issue: {
                id: 'linear-issue-id',
                identifier: 'ZK-999',
                title: '[Manual] Golfer is stuck near the green',
                url: 'https://linear.app/zkutty/issue/ZK-999',
                state: { type: 'started' },
              },
            },
          },
        })
      }
      if (body.query.includes('CourseCraftBugState')) {
        return Response.json({
          data: {
            issue: {
              id: 'linear-issue-id',
              identifier: 'ZK-999',
              title: '[Manual] Golfer is stuck near the green',
              url: 'https://linear.app/zkutty/issue/ZK-999',
              state: { type: 'started' },
            },
          },
        })
      }
      if (body.query.includes('CourseCraftBugComment')) {
        return Response.json({
          data: { commentCreate: { success: true } },
        })
      }
      return Response.json({ errors: [{ message: 'Unexpected query' }] })
    })
    vi.stubGlobal('fetch', linearFetch)

    const firstReport = report(
      'f2d74af8-1469-4cc1-833c-ff61cb7c6bb3',
      '2026-07-25T00:00:00.000Z',
    )
    const first = await exports.default.fetch(request(firstReport))
    const exactRetry = await exports.default.fetch(request(firstReport))
    const duplicate = await exports.default.fetch(
      request(
        report(
          'f33272b3-d789-4e30-b1c2-5685cb04a086',
          '2026-07-25T00:05:00.000Z',
        ),
      ),
    )

    expect(first.status).toBe(201)
    expect(await first.json()).toEqual(
      expect.objectContaining({ status: 'created', occurrenceCount: 1 }),
    )
    expect(exactRetry.status).toBe(201)
    expect(await exactRetry.json()).toEqual(
      expect.objectContaining({ status: 'created', occurrenceCount: 1 }),
    )
    expect(duplicate.status).toBe(200)
    expect(await duplicate.json()).toEqual(
      expect.objectContaining({ status: 'duplicate', occurrenceCount: 2 }),
    )
    expect(linearFetch).toHaveBeenCalledTimes(3)
  })

  it('serializes concurrent equivalent reports into one canonical issue', async () => {
    let creates = 0
    let comments = 0
    const linearFetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { query: string }
      if (body.query.includes('CourseCraftBugCreate')) {
        creates += 1
        await new Promise((resolve) => setTimeout(resolve, 5))
        return Response.json({
          data: {
            issueCreate: {
              success: true,
              issue: {
                id: 'concurrent-linear-issue',
                identifier: 'ZK-1001',
                title: '[Manual] Concurrent fixture',
                url: 'https://linear.app/zkutty/issue/ZK-1001',
                state: { type: 'started' },
              },
            },
          },
        })
      }
      if (body.query.includes('CourseCraftBugState')) {
        return Response.json({
          data: {
            issue: {
              id: 'concurrent-linear-issue',
              identifier: 'ZK-1001',
              title: '[Manual] Concurrent fixture',
              url: 'https://linear.app/zkutty/issue/ZK-1001',
              state: { type: 'started' },
            },
          },
        })
      }
      if (body.query.includes('CourseCraftBugComment')) {
        comments += 1
        return Response.json({
          data: { commentCreate: { success: true } },
        })
      }
      return Response.json({ errors: [{ message: 'Unexpected query' }] })
    })
    vi.stubGlobal('fetch', linearFetch)

    const reports = Array.from({ length: 5 }, (_, index) =>
      report(
        `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
        `2026-07-25T00:0${index}:00.000Z`,
        'Concurrent fixture',
      ),
    )
    const initialResponses = await Promise.all(
      reports.map((value) =>
        exports.default.fetch(request(value, '198.51.100.10')),
      ),
    )
    const initialPayloads = await Promise.all(
      initialResponses.map(
        (response) => response.json() as Promise<{ status: string }>,
      ),
    )
    const pendingReports = reports.filter(
      (_value, index) => initialPayloads[index].status === 'processing',
    )
    const retryResponses = await Promise.all(
      pendingReports.map((value) =>
        exports.default.fetch(request(value, '198.51.100.10')),
      ),
    )
    const retryPayloads = await Promise.all(
      retryResponses.map(
        (response) => response.json() as Promise<{ status: string }>,
      ),
    )

    expect(creates).toBe(1)
    expect(comments).toBe(4)
    expect(
      initialPayloads.filter((value) => value.status === 'created'),
    ).toHaveLength(1)
    expect(pendingReports).toHaveLength(4)
    expect(
      retryPayloads.filter((value) => value.status === 'duplicate'),
    ).toHaveLength(4)
  })

  it('creates a visible related regression after the canonical issue is completed', async () => {
    const createdDescriptions: string[] = []
    const linearFetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as {
        query: string
        variables?: { input?: { description?: string } }
      }
      if (body.query.includes('CourseCraftBugCreate')) {
        createdDescriptions.push(body.variables?.input?.description ?? '')
        const regression = createdDescriptions.length === 2
        return Response.json({
          data: {
            issueCreate: {
              success: true,
              issue: {
                id: regression ? 'regression-new' : 'regression-old',
                identifier: regression ? 'ZK-1003' : 'ZK-1002',
                title: regression
                  ? '[Regression] Completed fixture'
                  : '[Manual] Completed fixture',
                url: `https://linear.app/zkutty/issue/${
                  regression ? 'ZK-1003' : 'ZK-1002'
                }`,
                state: { type: 'backlog' },
              },
            },
          },
        })
      }
      if (body.query.includes('CourseCraftBugState')) {
        return Response.json({
          data: {
            issue: {
              id: 'regression-old',
              identifier: 'ZK-1002',
              title: '[Manual] Completed fixture',
              url: 'https://linear.app/zkutty/issue/ZK-1002',
              state: { type: 'completed' },
            },
          },
        })
      }
      if (body.query.includes('CourseCraftBugComment')) {
        return Response.json({ data: { commentCreate: { success: true } } })
      }
      return Response.json({ errors: [{ message: 'Unexpected query' }] })
    })
    vi.stubGlobal('fetch', linearFetch)

    const first = await exports.default.fetch(
      request(
        report(
          '10000000-0000-4000-8000-000000000001',
          '2026-07-25T00:00:00.000Z',
          'Completed fixture',
        ),
        '198.51.100.20',
      ),
    )
    const recurrence = await exports.default.fetch(
      request(
        report(
          '10000000-0000-4000-8000-000000000002',
          '2026-07-25T01:00:00.000Z',
          'Completed fixture',
        ),
        '198.51.100.20',
      ),
    )

    expect(first.status).toBe(201)
    expect(recurrence.status).toBe(201)
    expect(await recurrence.json()).toEqual(
      expect.objectContaining({
        status: 'created',
        issue: expect.objectContaining({ identifier: 'ZK-1003' }),
      }),
    )
    expect(createdDescriptions).toHaveLength(2)
    expect(createdDescriptions[1]).toContain('Regression of')
    expect(createdDescriptions[1]).toContain('ZK-1002')
  })

  it('replaces a deleted canonical mapping instead of getting permanently stuck', async () => {
    let creates = 0
    const linearFetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { query: string }
      if (body.query.includes('CourseCraftBugCreate')) {
        creates += 1
        return Response.json({
          data: {
            issueCreate: {
              success: true,
              issue: {
                id: `replacement-${creates}`,
                identifier: creates === 1 ? 'ZK-1004' : 'ZK-1005',
                title: '[Manual] Deleted fixture',
                url: `https://linear.app/zkutty/issue/${
                  creates === 1 ? 'ZK-1004' : 'ZK-1005'
                }`,
                state: { type: 'backlog' },
              },
            },
          },
        })
      }
      if (body.query.includes('CourseCraftBugState')) {
        return Response.json({ data: { issue: null } })
      }
      if (body.query.includes('CourseCraftBugComment')) {
        return Response.json({ data: { commentCreate: { success: true } } })
      }
      return Response.json({ errors: [{ message: 'Unexpected query' }] })
    })
    vi.stubGlobal('fetch', linearFetch)

    await exports.default.fetch(
      request(
        report(
          '20000000-0000-4000-8000-000000000001',
          '2026-07-25T00:00:00.000Z',
          'Deleted fixture',
        ),
        '198.51.100.30',
      ),
    )
    const replacement = await exports.default.fetch(
      request(
        report(
          '20000000-0000-4000-8000-000000000002',
          '2026-07-25T01:00:00.000Z',
          'Deleted fixture',
        ),
        '198.51.100.30',
      ),
    )

    expect(replacement.status).toBe(201)
    expect(await replacement.json()).toEqual(
      expect.objectContaining({
        issue: expect.objectContaining({ identifier: 'ZK-1005' }),
      }),
    )
    expect(creates).toBe(2)
  })

  it('releases a confirmed non-mutation so the same report ID can retry safely', async () => {
    let createAttempts = 0
    const linearFetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { query: string }
      if (body.query.includes('CourseCraftBugCreate')) {
        createAttempts += 1
        if (createAttempts === 1) {
          throw new TypeError('response lost before provider acceptance')
        }
        return Response.json({
          data: {
            issueCreate: {
              success: true,
              issue: {
                id: 'recovered-issue',
                identifier: 'ZK-1006',
                title: '[Manual] Reconciliation release fixture',
                url: 'https://linear.app/zkutty/issue/ZK-1006',
                state: { type: 'backlog' },
              },
            },
          },
        })
      }
      return Response.json({ errors: [{ message: 'Unexpected query' }] })
    })
    vi.stubGlobal('fetch', linearFetch)
    const value = report(
      '30000000-0000-4000-8000-000000000001',
      '2026-07-25T00:00:00.000Z',
      'Reconciliation release fixture',
    )

    const ambiguous = await exports.default.fetch(
      request(value, '198.51.100.40'),
    )
    expect(ambiguous.status).toBe(202)
    expect(await ambiguous.json()).toEqual(
      expect.objectContaining({
        status: 'processing',
        reconciliationRequired: true,
      }),
    )

    const reconciliation = await exports.default.fetch(
      new Request(
        'https://playtest.example/api/bug-reports/reconcile',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'CF-Connecting-IP': '198.51.100.41',
            'X-CourseCraft-Operator-Secret':
              'abcdef0123456789abcdef0123456789',
          },
          body: JSON.stringify({
            outcome: 'not-created',
            reportId: value.reportId,
          }),
        },
      ),
    )
    expect(reconciliation.status).toBe(200)

    const retry = await exports.default.fetch(
      request(value, '198.51.100.40'),
    )
    expect(retry.status).toBe(201)
    expect(await retry.json()).toEqual(
      expect.objectContaining({
        status: 'created',
        issue: expect.objectContaining({ identifier: 'ZK-1006' }),
      }),
    )
    expect(createAttempts).toBe(2)
  })

  it('attaches a confirmed ambiguous mutation without creating a duplicate issue', async () => {
    let createAttempts = 0
    const linearFetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { query: string }
      if (body.query.includes('CourseCraftBugCreate')) {
        createAttempts += 1
        throw new TypeError('response lost after provider acceptance')
      }
      if (body.query.includes('CourseCraftBugState')) {
        return Response.json({
          data: {
            issue: {
              id: 'confirmed-ambiguous-issue',
              identifier: 'ZK-1007',
              title: '[Manual] Confirmed reconciliation fixture',
              url: 'https://linear.app/zkutty/issue/ZK-1007',
              state: { type: 'backlog' },
            },
          },
        })
      }
      return Response.json({ errors: [{ message: 'Unexpected query' }] })
    })
    vi.stubGlobal('fetch', linearFetch)
    const value = report(
      '40000000-0000-4000-8000-000000000001',
      '2026-07-25T00:00:00.000Z',
      'Confirmed reconciliation fixture',
    )

    expect(
      (
        await exports.default.fetch(
          request(value, '198.51.100.50'),
        )
      ).status,
    ).toBe(202)
    const reconciliation = await exports.default.fetch(
      new Request(
        'https://playtest.example/api/bug-reports/reconcile',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'CF-Connecting-IP': '198.51.100.51',
            'X-CourseCraft-Operator-Secret':
              'abcdef0123456789abcdef0123456789',
          },
          body: JSON.stringify({
            issueId: 'confirmed-ambiguous-issue',
            outcome: 'confirmed',
            reportId: value.reportId,
          }),
        },
      ),
    )
    expect(reconciliation.status).toBe(200)

    const retry = await exports.default.fetch(
      request(value, '198.51.100.50'),
    )
    expect(retry.status).toBe(201)
    expect(await retry.json()).toEqual(
      expect.objectContaining({
        status: 'created',
        issue: expect.objectContaining({ identifier: 'ZK-1007' }),
      }),
    )
    expect(createAttempts).toBe(1)
  })
})
