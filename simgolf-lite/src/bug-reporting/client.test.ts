import { afterEach, describe, expect, it, vi } from 'vitest'
import { resetBugReportClientForTests, submitBugReport } from './client'
import type { BugReportV1 } from './contracts'

function report(): BugReportV1 {
  return {
    schemaVersion: 1,
    reportId: 'f2d74af8-1469-4cc1-833c-ff61cb7c6bb3',
    createdAt: '2026-07-24T12:00:00.000Z',
    source: 'manual',
    summary: {
      actual: 'The golfer stopped moving.',
      expected: 'The golfer should continue.',
      severity: 'medium',
      steps: ['Start a round'],
      title: 'Golfer stopped moving',
    },
    consent: { diagnostics: false, screenshot: false },
  }
}

afterEach(() => {
  resetBugReportClientForTests()
  vi.unstubAllGlobals()
})

describe('submitBugReport', () => {
  it('coalesces duplicate clicks for the same report ID', async () => {
    vi.stubGlobal('window', {
      clearTimeout,
      setTimeout,
    })
    vi.stubGlobal('navigator', { onLine: true })
    const fetchFn = vi.fn(async () => Response.json({
      status: 'created',
      issue: {
        id: 'issue-id',
        identifier: 'ZK-999',
        title: 'Bug',
        url: 'https://linear.app/example/ZK-999',
      },
      occurrenceCount: 1,
    }))

    const first = submitBugReport(report(), { fetchFn })
    const second = submitBugReport(report(), { fetchFn })

    await expect(first).resolves.toEqual(await second)
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })

  it('keeps a Worker reconciliation response retryable with the same report ID', async () => {
    vi.stubGlobal('window', {
      clearTimeout,
      setTimeout,
    })
    vi.stubGlobal('navigator', { onLine: true })

    await expect(
      submitBugReport(report(), {
        fetchFn: vi.fn(async () =>
          Response.json(
            {
              status: 'processing',
              retryAfterSeconds: 60,
              message: 'Linear mutation is being reconciled.',
            },
            { status: 202 },
          ),
        ),
      }),
    ).rejects.toMatchObject({
      code: 'processing',
      retryable: true,
    })
  })

  it('keeps an ambiguous network failure retryable', async () => {
    vi.stubGlobal('window', {
      clearTimeout,
      setTimeout,
    })
    vi.stubGlobal('navigator', { onLine: true })

    await expect(submitBugReport(report(), {
      fetchFn: vi.fn(async () => {
        throw new TypeError('network')
      }),
    })).rejects.toMatchObject({
      code: 'network_error',
      retryable: true,
    })
  })

  it('classifies an offline failure without changing the report ID', async () => {
    vi.stubGlobal('window', {
      clearTimeout,
      setTimeout,
    })
    vi.stubGlobal('navigator', { onLine: false })
    const input = report()

    await expect(
      submitBugReport(input, {
        fetchFn: vi.fn(async () => {
          throw new TypeError('offline')
        }),
      }),
    ).rejects.toMatchObject({
      code: 'offline',
      retryable: true,
    })
    expect(input.reportId).toBe('f2d74af8-1469-4cc1-833c-ff61cb7c6bb3')
  })

  it('times out a stalled request and leaves it safely retryable', async () => {
    vi.stubGlobal('window', {
      clearTimeout,
      setTimeout,
    })
    vi.stubGlobal('navigator', { onLine: true })
    const stalledFetch = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            'abort',
            () => reject(new DOMException('Aborted', 'AbortError')),
            { once: true },
          )
        }),
    )

    await expect(
      submitBugReport(report(), { fetchFn: stalledFetch, timeoutMs: 1 }),
    ).rejects.toMatchObject({
      code: 'timeout',
      retryable: true,
    })
  })

  it('honors an explicit cancellation without issuing a second request', async () => {
    vi.stubGlobal('window', {
      clearTimeout,
      setTimeout,
    })
    vi.stubGlobal('navigator', { onLine: true })
    const controller = new AbortController()
    const stalledFetch = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            'abort',
            () => reject(new DOMException('Aborted', 'AbortError')),
            { once: true },
          )
        }),
    )

    const submission = submitBugReport(report(), {
      fetchFn: stalledFetch,
      signal: controller.signal,
    })
    controller.abort('operator-canceled')

    await expect(submission).rejects.toMatchObject({
      code: 'canceled',
      retryable: false,
    })
    expect(stalledFetch).toHaveBeenCalledTimes(1)
  })
})
