import { describe, expect, it } from 'vitest'
import {
  BUG_REPORT_LIMITS,
  sanitizeBugReport,
  type BugReportV1,
} from './contracts'

function validReport(): BugReportV1 {
  return {
    schemaVersion: 1,
    reportId: 'f2d74af8-1469-4cc1-833c-ff61cb7c6bb3',
    createdAt: '2026-07-24T12:00:00.000Z',
    source: 'manual',
    summary: {
      title: 'Golfer stops moving near the green',
      actual: 'The golfer remains idle after reaching the fringe.',
      expected: 'The golfer should continue to the ball.',
      steps: ['Start a new game', 'Advance until the golfer reaches the fringe'],
      severity: 'high',
    },
    consent: {
      diagnostics: true,
      screenshot: false,
    },
    diagnostics: {
      app: {
        environment: 'playtest',
        version: '0.0.0',
      },
      route: '/play',
      game: {
        seed: 'safe-seed',
        week: 3,
        day: 4,
        screen: 'playing',
      },
      recentActions: [
        {
          type: 'advance_day',
          atMs: 1234,
          fields: {
            holeIndex: 2,
          },
        },
      ],
    },
  }
}

describe('sanitizeBugReport', () => {
  it('constructs a new allowlisted report and strips unknown private data', () => {
    const input = {
      ...validReport(),
      cookies: 'session=secret',
      localStorage: { save: 'full-save-data' },
      diagnostics: {
        ...validReport().diagnostics,
        authToken: 'secret',
        game: {
          ...validReport().diagnostics?.game,
          fullSave: { players: ['private'] },
        },
        recentActions: [
          {
            type: 'advance_day',
            atMs: 1234,
            fields: {
              holeIndex: 2,
              playerName: 'private',
            },
          },
        ],
      },
    }

    const result = sanitizeBugReport(input)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(JSON.stringify(result.value)).not.toContain('secret')
    expect(JSON.stringify(result.value)).not.toContain('fullSave')
    expect(JSON.stringify(result.value)).not.toContain('playerName')
    expect(result.value.diagnostics?.recentActions?.[0].fields).toEqual({
      holeIndex: 2,
    })
  })

  it('rejects diagnostics and screenshots that do not have consent', () => {
    const input = {
      ...validReport(),
      consent: { diagnostics: false, screenshot: false },
      screenshot: {
        mime: 'image/png',
        width: 1,
        height: 1,
        bytes: 70,
        dataUrl:
          'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4AWP4z8DwHwAFAAH/e+m+7wAAAABJRU5ErkJggg==',
      },
    }

    const result = sanitizeBugReport(input)

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.issues.map((issue) => issue.code)).toContain('consent_required')
  })

  it('rejects routes containing query strings or fragments', () => {
    const input = validReport()
    if (!input.diagnostics) throw new Error('Expected diagnostics fixture.')
    input.diagnostics.route = '/play?token=private#debug'

    const result = sanitizeBugReport(input)

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        code: 'invalid_format',
        path: 'diagnostics.route',
      }),
    )
  })

  it('rejects action buffers beyond the bounded limit', () => {
    const input = validReport()
    if (!input.diagnostics) throw new Error('Expected diagnostics fixture.')
    input.diagnostics.recentActions = Array.from(
      { length: BUG_REPORT_LIMITS.actionCount + 1 },
      (_, index) => ({ type: 'test', atMs: index }),
    )

    const result = sanitizeBugReport(input)

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        code: 'size_limit',
        path: 'diagnostics.recentActions',
      }),
    )
  })

  it('rejects unknown schema versions and malformed root values', () => {
    expect(sanitizeBugReport(null)).toEqual({
      ok: false,
      issues: [
        expect.objectContaining({
          code: 'invalid_type',
          path: '$',
        }),
      ],
    })

    const input = { ...validReport(), schemaVersion: 2 }
    const result = sanitizeBugReport(input)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        code: 'invalid_value',
        path: 'schemaVersion',
      }),
    )
  })

  it('accepts only a stripped HTTPS sentry.io issue link', () => {
    const input = validReport()
    if (!input.diagnostics) throw new Error('Expected diagnostics fixture.')
    input.diagnostics.error = {
      message: 'Crash',
      sentryIssueUrl:
        'https://sentry.io/organizations/coursecraft/issues/123/?token=private#event',
    }

    const result = sanitizeBugReport(input)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.diagnostics?.error?.sentryIssueUrl).toBe(
      'https://sentry.io/organizations/coursecraft/issues/123/',
    )
  })

  it('accepts a consented, size-matched PNG payload', () => {
    const input = {
      ...validReport(),
      consent: { diagnostics: true, screenshot: true },
      screenshot: {
        mime: 'image/png',
        width: 1,
        height: 1,
        bytes: 70,
        dataUrl:
          'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4AWP4z8DwHwAFAAH/e+m+7wAAAABJRU5ErkJggg==',
      },
    }

    const result = sanitizeBugReport(input)

    if (!result.ok) throw new Error(JSON.stringify(result.issues))
    expect(result.ok).toBe(true)
  })

  it('keeps screenshot consent independent from diagnostics consent', () => {
    const base = validReport()
    const input = {
      ...base,
      consent: { diagnostics: false, screenshot: true },
      diagnostics: undefined,
      screenshot: {
        mime: 'image/png',
        width: 1,
        height: 1,
        bytes: 70,
        dataUrl:
          'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4AWP4z8DwHwAFAAH/e+m+7wAAAABJRU5ErkJggg==',
      },
    }

    const result = sanitizeBugReport(input)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.consent).toEqual({
      diagnostics: false,
      screenshot: true,
    })
    expect(result.value).not.toHaveProperty('diagnostics')
    expect(result.value).toHaveProperty('screenshot')
  })

  it('accepts only bounded, query-free Sentry group metadata', () => {
    const input = validReport()
    input.source = 'sentry-group'
    if (!input.diagnostics) throw new Error('Expected diagnostics fixture.')
    input.diagnostics.sentryGroup = {
      count: 12,
      firstSeen: '2026-07-24T11:00:00.000Z',
      id: 'COURSECRAFT-12',
      lastSeen: '2026-07-24T12:00:00.000Z',
      url: 'https://sentry.io/organizations/example/issues/12/',
    }

    const valid = sanitizeBugReport(input)
    expect(valid.ok).toBe(true)

    input.diagnostics.sentryGroup.url =
      'https://sentry.io/organizations/example/issues/12/?token=private'
    const invalid = sanitizeBugReport(input)
    expect(invalid).toEqual({
      ok: false,
      issues: expect.arrayContaining([
        expect.objectContaining({
          code: 'invalid_format',
          path: 'diagnostics.sentryGroup.url',
        }),
      ]),
    })
  })
})
