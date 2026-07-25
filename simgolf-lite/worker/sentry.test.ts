import { describe, expect, it } from 'vitest'
import {
  sentryPayloadToReport,
  verifySentryWebhook,
} from './sentry'

const secret = '0123456789abcdef0123456789abcdef'

describe('Sentry routing', () => {
  it('accepts only the configured custom header or valid HMAC', async () => {
    const body = new TextEncoder().encode('{"safe":true}').buffer
    expect(
      await verifySentryWebhook(
        body,
        new Headers({ 'X-CourseCraft-Webhook-Secret': secret }),
        secret,
      ),
    ).toBe(true)
    expect(
      await verifySentryWebhook(
        body,
        new Headers({ 'X-CourseCraft-Webhook-Secret': 'wrong-secret-value' }),
        secret,
      ),
    ).toBe(false)

    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    )
    const signature = [...new Uint8Array(
      await crypto.subtle.sign('HMAC', key, body),
    )]
      .map((value) => value.toString(16).padStart(2, '0'))
      .join('')
    expect(
      await verifySentryWebhook(
        body,
        new Headers({
          'X-CourseCraft-Signature': `sha256=${signature}`,
        }),
        secret,
      ),
    ).toBe(true)
  })

  it('builds a bounded report from a qualifying issue alert', async () => {
    const result = await sentryPayloadToReport({
      action: 'triggered',
      data: {
        issue: {
          id: '123',
          title: 'TypeError in simulation',
          count: 8,
          permalink: 'https://sentry.io/organizations/coursecraft/issues/123/?secret=no',
        },
        event: {
          eventID: '1234567890abcdef1234567890abcdef',
          message: 'Cannot read properties of undefined',
          level: 'error',
          environment: 'staging',
          release: 'coursecraft@1.0.0',
          tags: { app_version: '1.0.0', user_email: 'must-not-copy@example.com' },
        },
      },
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.report.source).toBe('sentry-group')
    expect(result.report.diagnostics?.error?.sentryIssueUrl).toBe(
      'https://sentry.io/organizations/coursecraft/issues/123/',
    )
    expect(JSON.stringify(result.report)).not.toContain('user_email')
    expect(JSON.stringify(result.report)).not.toContain('must-not-copy')
  })

  it('acknowledges low-volume nonfatal events without routing them', async () => {
    const result = await sentryPayloadToReport({
      action: 'created',
      data: {
        issue: { id: '123', title: 'One warning', count: 1 },
        event: { message: 'One warning', level: 'warning' },
      },
    })

    expect(result).toEqual({
      ok: false,
      reason: 'below_routing_threshold',
      status: 202,
    })
  })

  it('accepts Sentry numeric-string counts and allowlisted array tags', async () => {
    const result = await sentryPayloadToReport({
      action: 'created',
      data: {
        issue: {
          id: 'string-count',
          title: 'RangeError in golfer update',
          count: '5',
          permalink: 'https://sentry.io/organizations/coursecraft/issues/string-count/',
        },
        event: {
          message: 'Maximum call stack exceeded',
          level: 'error',
          tags: [
            ['environment', 'staging'],
            ['app_version', '1.2.3'],
            ['user_email', 'must-not-copy@example.com'],
          ],
        },
      },
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.report.diagnostics?.app).toEqual(
      expect.objectContaining({
        environment: 'staging',
        version: '1.2.3',
      }),
    )
    expect(result.report.diagnostics?.sentryGroup?.count).toBe(5)
    expect(JSON.stringify(result.report)).not.toContain('must-not-copy')
  })
})
