import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  isBugReportingEnabled,
  resetBugReportingFeatureForTests,
  resolveBugReportingEnabled,
} from './feature'

afterEach(() => {
  resetBugReportingFeatureForTests()
})

describe('bug reporting feature configuration', () => {
  it('enables a production build only from a successful runtime response', async () => {
    const fetchFn = vi.fn(async () => Response.json({ enabled: true }))

    expect(await resolveBugReportingEnabled(fetchFn)).toBe(true)
    expect(isBugReportingEnabled()).toBe(true)
    expect(fetchFn).toHaveBeenCalledWith(
      '/api/bug-reports/config',
      expect.objectContaining({ cache: 'no-store' }),
    )
  })

  it('fails closed when runtime configuration cannot be read', async () => {
    expect(
      await resolveBugReportingEnabled(
        vi.fn(async () => {
          throw new TypeError('offline')
        }),
      ),
    ).toBe(false)
    expect(isBugReportingEnabled()).toBe(false)
  })
})
