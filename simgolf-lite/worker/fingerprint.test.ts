import { describe, expect, it } from 'vitest'
import type { BugReportV1 } from '../src/bug-reporting/contracts'
import { fingerprintBugReport, fingerprintMaterial } from './fingerprint'

function report(message: string, reportId: string): BugReportV1 {
  return {
    schemaVersion: 1,
    reportId,
    createdAt: '2026-07-25T00:00:00.000Z',
    source: 'react-crash',
    summary: {
      title: 'Crash on week 14',
      actual: 'Game crashed for golfer 22',
      expected: 'Game continues',
      severity: 'high',
      steps: ['Advance time'],
    },
    consent: { diagnostics: true, screenshot: false },
    diagnostics: {
      app: { environment: 'staging', version: '1.0.0' },
      route: '/play',
      game: { screen: 'game', mode: 'PAINT' },
      error: {
        message,
        stack: 'Error: failed\n    at update (/src/App.tsx:100:20)',
      },
    },
  }
}

describe('bug fingerprints', () => {
  it('ignore report IDs, timestamps, line numbers, and varying numeric entities', async () => {
    const first = report(
      'Golfer 22 failed at 912.5',
      'f2d74af8-1469-4cc1-833c-ff61cb7c6bb3',
    )
    const second = report(
      'Golfer 44 failed at 1050.7',
      'f33272b3-d789-4e30-b1c2-5685cb04a086',
    )

    expect(fingerprintMaterial(first)).toBe(fingerprintMaterial(second))
    expect(await fingerprintBugReport(first)).toBe(await fingerprintBugReport(second))
  })

  it('changes when the stable error signature changes', async () => {
    const first = report(
      'Golfer 22 failed',
      'f2d74af8-1469-4cc1-833c-ff61cb7c6bb3',
    )
    const second = report(
      'Weather update failed',
      'f33272b3-d789-4e30-b1c2-5685cb04a086',
    )

    expect(await fingerprintBugReport(first)).not.toBe(await fingerprintBugReport(second))
  })

  it('does not merge deterministic reports from different seeds', async () => {
    const first = report(
      'Golfer 22 failed',
      'f2d74af8-1469-4cc1-833c-ff61cb7c6bb3',
    )
    const second = report(
      'Golfer 22 failed',
      'f33272b3-d789-4e30-b1c2-5685cb04a086',
    )
    if (!first.diagnostics?.game || !second.diagnostics?.game) {
      throw new Error('Expected deterministic game fixtures.')
    }
    first.diagnostics.game.seed = 'seed-a'
    second.diagnostics.game.seed = 'seed-b'

    expect(await fingerprintBugReport(first)).not.toBe(await fingerprintBugReport(second))
  })
})
