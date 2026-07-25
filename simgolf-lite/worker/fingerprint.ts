import type { BugReportV1 } from '../src/bug-reporting/contracts'

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, '<id>')
    .replace(/\b\d+(?:\.\d+)?\b/g, '<n>')
    .replace(/\s+/g, ' ')
    .trim()
}

function normalizeStack(stack: string | undefined): string {
  if (!stack) return ''
  return stack
    .split('\n')
    .slice(0, 8)
    .map((line) =>
      line
        .replace(/:\d+:\d+/g, ':<line>')
        .replace(/[?#].*$/g, '')
        .trim(),
    )
    .filter(Boolean)
    .join('\n')
}

function hex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('')
}

export function fingerprintMaterial(report: BugReportV1): string {
  const diagnostics = report.diagnostics
  if (report.source === 'sentry-group' && diagnostics?.sentryGroup?.id) {
    return JSON.stringify({
      version: report.schemaVersion,
      source: 'sentry-group',
      group: normalizeText(diagnostics.sentryGroup.id),
    })
  }
  return JSON.stringify({
    version: report.schemaVersion,
    title: normalizeText(report.summary.title),
    observed: normalizeText(report.summary.actual),
    expected: normalizeText(report.summary.expected),
    error: diagnostics?.error
      ? {
          name: normalizeText(diagnostics.error.name ?? ''),
          message: normalizeText(diagnostics.error.message),
          stack: normalizeStack(diagnostics.error.stack),
        }
      : undefined,
    location: {
      route: diagnostics?.route,
      screen: diagnostics?.game?.screen,
      mode: diagnostics?.game?.mode,
      tool: diagnostics?.game?.tool,
      // Including an available deterministic seed is deliberately conservative:
      // seed-specific failures must never be merged across incompatible runs.
      seed: diagnostics?.game?.seed,
    },
  })
}

export async function fingerprintBugReport(report: BugReportV1): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(fingerprintMaterial(report)),
  )
  return hex(digest)
}

export async function opaqueRateLimitKey(ipAddress: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`coursecraft-bug-rate:v1:${ipAddress}`),
  )
  return hex(digest)
}
