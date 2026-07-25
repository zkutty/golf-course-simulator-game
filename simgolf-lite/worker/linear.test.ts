import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BugReportV1 } from '../src/bug-reporting/contracts'
import {
  createLinearIssue,
  getLinearIssue,
  LinearAmbiguousMutationError,
  LinearIssueMissingError,
  LinearRequestError,
} from './linear'

const screenshotDataUrl =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4AWP4z8DwHwAFAAH/e+m+7wAAAABJRU5ErkJggg=='

function report(): BugReportV1 {
  return {
    schemaVersion: 1,
    reportId: 'f2d74af8-1469-4cc1-833c-ff61cb7c6bb3',
    createdAt: '2026-07-25T00:00:00.000Z',
    source: 'manual',
    summary: {
      actual: 'The golfer stops.',
      expected: 'The golfer continues.',
      severity: 'high',
      steps: ['Advance the day'],
      title: 'Golfer stops',
    },
    consent: { diagnostics: false, screenshot: true },
    screenshot: {
      bytes: 70,
      dataUrl: screenshotDataUrl,
      height: 1,
      mime: 'image/png',
      width: 1,
    },
  }
}

function environment() {
  return {
    LINEAR_API_KEY: 'lin_api_test_only',
    LINEAR_TEAM_ID: 'team',
    LINEAR_PROJECT_ID: 'project',
    LINEAR_BUG_LABEL_IDS: 'bug,qa',
  }
}

afterEach(() => vi.unstubAllGlobals())

describe('Linear issue creation', () => {
  it('falls back once to a text-only issue after an explicit evidence rejection', async () => {
    const descriptions: string[] = []
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as {
        variables: { input: { description: string } }
      }
      descriptions.push(body.variables.input.description)
      if (descriptions.length === 1) {
        return Response.json({ errors: [{ message: 'Image could not be ingested' }] })
      }
      return Response.json({
        data: {
          issueCreate: {
            success: true,
            issue: {
              id: 'issue-id',
              identifier: 'ZK-999',
              state: { type: 'backlog' },
              title: '[Manual] Golfer stops',
              url: 'https://linear.app/example/issue/ZK-999',
            },
          },
        },
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const issue = await createLinearIssue(environment(), report(), 'fingerprint')

    expect(issue.identifier).toBe('ZK-999')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(descriptions[0]).toContain(screenshotDataUrl)
    expect(descriptions[1]).not.toContain(screenshotDataUrl)
    expect(descriptions[1]).toContain('text report was preserved')
  })

  it('never retries a mutation whose network outcome is ambiguous', async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError('socket closed after upload')
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      createLinearIssue(environment(), report(), 'fingerprint'),
    ).rejects.toBeInstanceOf(LinearAmbiguousMutationError)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('classifies confirmed client rejection separately from ambiguous server failure', async () => {
    const withoutScreenshot = {
      ...report(),
      consent: { diagnostics: false, screenshot: false },
      screenshot: undefined,
    } as unknown as BugReportV1
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ error: 'bad input' }, { status: 400 }))
      .mockResolvedValueOnce(Response.json({ error: 'outage' }, { status: 503 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      createLinearIssue(environment(), withoutScreenshot, 'fingerprint-a'),
    ).rejects.toBeInstanceOf(LinearRequestError)
    await expect(
      createLinearIssue(environment(), withoutScreenshot, 'fingerprint-b'),
    ).rejects.toBeInstanceOf(LinearAmbiguousMutationError)
  })

  it('distinguishes a deleted canonical issue from a transient query failure', async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({ data: { issue: null } }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      getLinearIssue(environment(), 'deleted-issue'),
    ).rejects.toBeInstanceOf(LinearIssueMissingError)
  })
})
