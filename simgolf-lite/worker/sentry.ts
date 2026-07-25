import {
  sanitizeBugReport,
  type BugReportEnvironment,
  type BugReportV1,
} from '../src/bug-reporting/contracts'
import { opaqueRateLimitKey } from './fingerprint'

type SentryWebhookResult =
  | { ok: true; report: BugReportV1; groupId: string }
  | { ok: false; reason: string; status: number }

interface SentryFields {
  action: string
  count: number
  createdAt: string
  environment: BugReportEnvironment
  eventId?: string
  firstSeen: string
  groupId: string
  issueUrl?: string
  lastSeen: string
  level: string
  message: string
  release?: string
  title: string
  version: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function recordAt(value: unknown, path: string[]): Record<string, unknown> | undefined {
  let current: unknown = value
  for (const key of path) {
    if (!isRecord(current)) return undefined
    current = current[key]
  }
  return isRecord(current) ? current : undefined
}

function stringAt(value: unknown, paths: string[][], max: number): string | undefined {
  for (const path of paths) {
    let current: unknown = value
    for (const key of path) {
      if (!isRecord(current)) {
        current = undefined
        break
      }
      current = current[key]
    }
    if (typeof current === 'string' && current.trim()) {
      return current.trim().slice(0, max)
    }
  }
  return undefined
}

function numberAt(value: unknown, paths: string[][]): number | undefined {
  for (const path of paths) {
    let current: unknown = value
    for (const key of path) {
      if (!isRecord(current)) {
        current = undefined
        break
      }
      current = current[key]
    }
    if (typeof current === 'number' && Number.isFinite(current) && current >= 0) {
      return Math.floor(current)
    }
    if (typeof current === 'string' && /^\d{1,12}$/.test(current.trim())) {
      const parsed = Number(current)
      if (Number.isSafeInteger(parsed)) return parsed
    }
  }
  return undefined
}

function tagAt(
  source: Record<string, unknown> | undefined,
  key: string,
  max: number,
): string | undefined {
  const tags = source?.tags
  if (isRecord(tags)) {
    const value = tags[key]
    return typeof value === 'string' && value.trim()
      ? value.trim().slice(0, max)
      : undefined
  }
  if (!Array.isArray(tags)) return undefined
  for (const entry of tags) {
    let tagKey: unknown
    let tagValue: unknown
    if (Array.isArray(entry)) {
      tagKey = entry[0]
      tagValue = entry[1]
    } else if (isRecord(entry)) {
      tagKey = entry.key
      tagValue = entry.value
    }
    if (tagKey === key && typeof tagValue === 'string' && tagValue.trim()) {
      return tagValue.trim().slice(0, max)
    }
  }
  return undefined
}

function safeEnvironment(value: string | undefined): BugReportEnvironment {
  if (value === 'development') return 'development'
  if (value === 'playtest') return 'playtest'
  if (value === 'staging') return 'staging'
  if (value === 'production') return 'production'
  if (value === 'e2e') return 'e2e'
  return 'unknown'
}

function safeIsoTimestamp(value: string | undefined): string {
  if (value && !Number.isNaN(Date.parse(value))) return new Date(value).toISOString()
  return new Date().toISOString()
}

function safeSentryUrl(value: string | undefined): string | undefined {
  if (!value) return undefined
  try {
    const url = new URL(value)
    if (
      url.protocol !== 'https:' ||
      (url.hostname !== 'sentry.io' && !url.hostname.endsWith('.sentry.io'))
    ) {
      return undefined
    }
    url.search = ''
    url.hash = ''
    return url.toString()
  } catch {
    return undefined
  }
}

function extractSentryFields(payload: unknown): SentryFields | undefined {
  if (!isRecord(payload)) return undefined
  const issue =
    recordAt(payload, ['data', 'issue']) ??
    recordAt(payload, ['issue']) ??
    recordAt(payload, ['data', 'group'])
  const event =
    recordAt(payload, ['data', 'event']) ?? recordAt(payload, ['event'])
  if (!issue && !event) return undefined

  const action =
    stringAt(payload, [['action'], ['resource']], 80)?.toLowerCase() ?? 'created'
  const groupId = stringAt(
    { issue, event },
    [
      ['issue', 'id'],
      ['issue', 'shortId'],
      ['event', 'groupID'],
      ['event', 'group_id'],
    ],
    160,
  )
  const title = stringAt(
    { issue, event },
    [
      ['issue', 'title'],
      ['event', 'title'],
      ['event', 'metadata', 'title'],
    ],
    160,
  )
  const message = stringAt(
    { issue, event },
    [
      ['event', 'message'],
      ['event', 'title'],
      ['event', 'metadata', 'value'],
      ['issue', 'title'],
    ],
    2_000,
  )
  if (!groupId || !title || !message) return undefined

  const createdAt = safeIsoTimestamp(
    stringAt(
      { issue, event },
      [
        ['event', 'dateCreated'],
        ['event', 'datetime'],
        ['issue', 'lastSeen'],
      ],
      80,
    ),
  )
  return {
    action,
    count:
      numberAt(
        { issue, event },
        [
          ['issue', 'count'],
          ['event', 'issue_count'],
        ],
      ) ?? 1,
    createdAt,
    firstSeen: safeIsoTimestamp(
      stringAt(
        { issue },
        [
          ['issue', 'firstSeen'],
          ['issue', 'first_seen'],
        ],
        80,
      ) ?? createdAt,
    ),
    environment: safeEnvironment(
      stringAt(
        { event },
        [
          ['event', 'environment'],
        ],
        40,
      ) ?? tagAt(event, 'environment', 40),
    ),
    eventId: stringAt(
      { event },
      [
        ['event', 'eventID'],
        ['event', 'event_id'],
        ['event', 'id'],
      ],
      32,
    ),
    groupId,
    issueUrl: safeSentryUrl(
      stringAt(
        { issue },
        [
          ['issue', 'permalink'],
          ['issue', 'web_url'],
        ],
        1_000,
      ),
    ),
    level:
      stringAt(
        { issue, event },
        [
          ['event', 'level'],
          ['issue', 'level'],
        ],
        20,
      )?.toLowerCase() ?? 'error',
    lastSeen: safeIsoTimestamp(
      stringAt(
        { issue },
        [
          ['issue', 'lastSeen'],
          ['issue', 'last_seen'],
        ],
        80,
      ) ?? createdAt,
    ),
    message,
    release: stringAt(
      { event },
      [
        ['event', 'release'],
      ],
      160,
    ) ?? tagAt(event, 'release', 160),
    title,
    version:
      stringAt(
        { event },
        [
          ['event', 'version'],
        ],
        120,
      ) ?? tagAt(event, 'app_version', 120) ?? 'unknown',
  }
}

function qualifies(
  fields: SentryFields,
  minimumOccurrences: number,
  promoted: boolean,
): boolean {
  if (promoted) return true
  if (fields.action.includes('regress') || fields.action.includes('trigger')) return true
  if (fields.level === 'fatal') return true
  return (
    fields.count >= minimumOccurrences &&
    (fields.level === 'error' || fields.level === 'fatal')
  )
}

function hex(bytes: Uint8Array): string {
  return [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('')
}

async function stableUuid(value: string): Promise<string> {
  const bytes = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)),
  ).slice(0, 16)
  bytes[6] = (bytes[6] & 0x0f) | 0x50
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const valueHex = hex(bytes)
  return `${valueHex.slice(0, 8)}-${valueHex.slice(8, 12)}-${valueHex.slice(
    12,
    16,
  )}-${valueHex.slice(16, 20)}-${valueHex.slice(20)}`
}

function hexToBytes(value: string): Uint8Array | undefined {
  if (!/^[0-9a-f]{64}$/i.test(value)) return undefined
  const bytes = new Uint8Array(32)
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16)
  }
  return bytes
}

async function hmac(body: ArrayBuffer, secret: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, body))
}

async function fixedDigest(value: string): Promise<Uint8Array> {
  return new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)),
  )
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false
  let difference = 0
  for (let index = 0; index < left.byteLength; index += 1) {
    difference |= left[index] ^ right[index]
  }
  return difference === 0
}

/** Support either an HMAC gateway signature or Sentry custom-header secret. */
export async function verifySentryWebhook(
  body: ArrayBuffer,
  headers: Headers,
  secret: string,
): Promise<boolean> {
  if (secret.length < 24) return false
  const signature = headers
    .get('X-CourseCraft-Signature')
    ?.replace(/^sha256=/i, '')
    .trim()
  const signatureBytes = signature ? hexToBytes(signature) : undefined
  if (signatureBytes && equalBytes(signatureBytes, await hmac(body, secret))) {
    return true
  }

  const suppliedSecret = headers.get('X-CourseCraft-Webhook-Secret') ?? ''
  return equalBytes(await fixedDigest(suppliedSecret), await fixedDigest(secret))
}

export async function sentryPayloadToReport(
  payload: unknown,
  options: { minimumOccurrences?: number; promoted?: boolean } = {},
): Promise<SentryWebhookResult> {
  const fields = extractSentryFields(payload)
  if (!fields) return { ok: false, reason: 'invalid_sentry_payload', status: 400 }
  const minimumOccurrences = Math.max(
    1,
    Math.min(1_000, Math.floor(options.minimumOccurrences ?? 3)),
  )
  if (!qualifies(fields, minimumOccurrences, options.promoted === true)) {
    return { ok: false, reason: 'below_routing_threshold', status: 202 }
  }

  const reportId = await stableUuid(
    `sentry:v1:${fields.groupId}:${fields.eventId ?? fields.createdAt}:${fields.action}`,
  )
  const input: BugReportV1 = {
    schemaVersion: 1,
    reportId,
    createdAt: fields.createdAt,
    source: 'sentry-group',
    summary: {
      title: fields.title,
      actual: fields.message,
      expected: 'The application should continue without this error.',
      steps: ['Reproduce the activity represented by this Sentry issue group.'],
      severity: fields.level === 'fatal' ? 'critical' : 'high',
    },
    consent: { diagnostics: true, screenshot: false },
    diagnostics: {
      app: {
        environment: fields.environment,
        version: fields.version,
        ...(fields.release ? { release: fields.release } : {}),
      },
      error: {
        message: fields.message,
        ...(fields.eventId && /^[0-9a-f]{32}$/i.test(fields.eventId)
          ? { sentryEventId: fields.eventId }
          : {}),
        ...(fields.issueUrl ? { sentryIssueUrl: fields.issueUrl } : {}),
      },
      ...(fields.issueUrl
        ? {
            sentryGroup: {
              count: fields.count,
              firstSeen: fields.firstSeen,
              id: fields.groupId,
              lastSeen: fields.lastSeen,
              url: fields.issueUrl,
            },
          }
        : {}),
    },
  }
  const validation = sanitizeBugReport(input)
  if (!validation.ok) {
    return { ok: false, reason: 'invalid_sentry_payload', status: 400 }
  }
  return { ok: true, report: validation.value, groupId: fields.groupId }
}

export async function sentryRateKey(groupId: string): Promise<string> {
  return opaqueRateLimitKey(`sentry:${groupId}`)
}
