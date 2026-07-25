export const BUG_REPORT_SCHEMA_VERSION = 1 as const

export const BUG_REPORT_LIMITS = {
  actionCount: 40,
  actionFieldCount: 8,
  componentStackCharacters: 12_000,
  errorMessageCharacters: 2_000,
  errorStackCharacters: 12_000,
  screenshotBytes: 900_000,
  screenshotHeight: 1_200,
  screenshotWidth: 1_920,
  steps: 12,
  textCharacters: 2_000,
  titleCharacters: 160,
  totalBytes: 1_500_000,
} as const

export const BUG_REPORT_SOURCES = [
  'manual',
  'react-crash',
  'window-error',
  'unhandled-rejection',
  'sentry-group',
] as const

export const BUG_REPORT_SEVERITIES = ['low', 'medium', 'high', 'critical'] as const

export const BUG_REPORT_ENVIRONMENTS = [
  'development',
  'playtest',
  'staging',
  'production',
  'e2e',
  'unknown',
] as const

export const BUG_ACTION_FIELD_KEYS = [
  'buildingType',
  'courseId',
  'holeIndex',
  'kind',
  'obstacleType',
  'parcelId',
  'pinRotation',
  'screen',
  'surface',
  'teeSet',
  'tool',
  'x',
  'y',
] as const

export type BugReportSource = (typeof BUG_REPORT_SOURCES)[number]
export type BugReportSeverity = (typeof BUG_REPORT_SEVERITIES)[number]
export type BugReportEnvironment = (typeof BUG_REPORT_ENVIRONMENTS)[number]
export type BugActionFieldKey = (typeof BUG_ACTION_FIELD_KEYS)[number]
export type BugScalar = boolean | number | string

export interface BugReportSummary {
  title: string
  actual: string
  expected: string
  steps: string[]
  severity: BugReportSeverity
}

export interface BugReportConsent {
  diagnostics: boolean
  screenshot: boolean
}

export interface BugActionRecord {
  type: string
  atMs: number
  fields?: Partial<Record<BugActionFieldKey, BugScalar>>
}

export interface BugGameContext {
  activeCourseId?: string
  camera?: {
    centerX: number
    centerY: number
    rotation: number
    zoom: number
  }
  day?: number
  holeIndex?: number
  modal?: string
  mode?: string
  screen?: string
  seed?: string
  tool?: string
  week?: number
}

export interface BugReportDiagnostics {
  app: {
    commit?: string
    environment: BugReportEnvironment
    release?: string
    version: string
  }
  browser?: {
    name?: string
    platform?: string
    userAgentFamily?: string
    viewport?: {
      devicePixelRatio: number
      height: number
      width: number
    }
  }
  error?: {
    componentStack?: string
    message: string
    name?: string
    sentryEventId?: string
    sentryIssueUrl?: string
    stack?: string
  }
  game?: BugGameContext
  recentActions?: BugActionRecord[]
  route?: string
  sentryGroup?: {
    count: number
    firstSeen: string
    id: string
    lastSeen: string
    url: string
  }
}

export interface BugReportScreenshot {
  bytes: number
  dataUrl: string
  height: number
  mime: 'image/png'
  width: number
}

export interface BugReportV1 {
  schemaVersion: typeof BUG_REPORT_SCHEMA_VERSION
  reportId: string
  createdAt: string
  source: BugReportSource
  summary: BugReportSummary
  consent: BugReportConsent
  diagnostics?: BugReportDiagnostics
  screenshot?: BugReportScreenshot
}

export interface BugReportValidationIssue {
  code:
    | 'consent_required'
    | 'invalid_format'
    | 'invalid_type'
    | 'invalid_value'
    | 'missing'
    | 'size_limit'
  path: string
  message: string
}

export type BugReportValidationResult =
  | { ok: true; value: BugReportV1 }
  | { ok: false; issues: BugReportValidationIssue[] }

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const actionTypePattern = /^[a-z0-9:_-]{1,80}$/i
const sentryEventIdPattern = /^[0-9a-f]{32}$/i
const pngDataUrlPattern = /^data:image\/png;base64,([a-z0-9+/]+={0,2})$/i

const sourceSet = new Set<string>(BUG_REPORT_SOURCES)
const severitySet = new Set<string>(BUG_REPORT_SEVERITIES)
const environmentSet = new Set<string>(BUG_REPORT_ENVIRONMENTS)
const actionFieldSet = new Set<string>(BUG_ACTION_FIELD_KEYS)

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function addIssue(
  issues: BugReportValidationIssue[],
  issue: BugReportValidationIssue,
): void {
  issues.push(issue)
}

function readString(
  value: unknown,
  path: string,
  issues: BugReportValidationIssue[],
  options: {
    max: number
    min?: number
    optional?: boolean
    pattern?: RegExp
  },
): string | undefined {
  if (value === undefined && options.optional) {
    return undefined
  }

  if (typeof value !== 'string') {
    addIssue(issues, {
      code: value === undefined ? 'missing' : 'invalid_type',
      path,
      message: 'Expected a string.',
    })
    return undefined
  }

  const result = value.trim()
  if (result.length < (options.min ?? 0) || result.length > options.max) {
    addIssue(issues, {
      code: 'size_limit',
      path,
      message: `Expected between ${options.min ?? 0} and ${options.max} characters.`,
    })
    return undefined
  }

  if (options.pattern && !options.pattern.test(result)) {
    addIssue(issues, {
      code: 'invalid_format',
      path,
      message: 'The value does not match the required format.',
    })
    return undefined
  }

  return result
}

function readFiniteNumber(
  value: unknown,
  path: string,
  issues: BugReportValidationIssue[],
  options: { min: number; max: number; integer?: boolean; optional?: boolean },
): number | undefined {
  if (value === undefined && options.optional) {
    return undefined
  }

  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < options.min ||
    value > options.max ||
    (options.integer && !Number.isInteger(value))
  ) {
    addIssue(issues, {
      code: 'invalid_value',
      path,
      message: `Expected a finite number from ${options.min} to ${options.max}.`,
    })
    return undefined
  }

  return value
}

function readBoolean(
  value: unknown,
  path: string,
  issues: BugReportValidationIssue[],
): boolean | undefined {
  if (typeof value !== 'boolean') {
    addIssue(issues, {
      code: value === undefined ? 'missing' : 'invalid_type',
      path,
      message: 'Expected a boolean.',
    })
    return undefined
  }

  return value
}

function sanitizeRoute(value: unknown, issues: BugReportValidationIssue[]): string | undefined {
  const route = readString(value, 'diagnostics.route', issues, {
    max: 500,
    min: 1,
    optional: true,
  })
  if (!route) {
    return route
  }

  if (
    route.includes('?') ||
    route.includes('#') ||
    route.includes('://') ||
    !route.startsWith('/')
  ) {
    addIssue(issues, {
      code: 'invalid_format',
      path: 'diagnostics.route',
      message: 'Route must be an origin-relative path without a query or fragment.',
    })
    return undefined
  }

  return route
}

function sanitizeSentryIssueUrl(
  value: unknown,
  issues: BugReportValidationIssue[],
): string | undefined {
  const url = readString(value, 'diagnostics.error.sentryIssueUrl', issues, {
    max: 1_000,
    min: 1,
    optional: true,
  })
  if (!url) return url
  try {
    const parsed = new URL(url)
    if (
      parsed.protocol !== 'https:' ||
      (parsed.hostname !== 'sentry.io' && !parsed.hostname.endsWith('.sentry.io'))
    ) {
      throw new Error('unsupported Sentry host')
    }
    parsed.search = ''
    parsed.hash = ''
    return parsed.toString()
  } catch {
    addIssue(issues, {
      code: 'invalid_format',
      path: 'diagnostics.error.sentryIssueUrl',
      message: 'Expected an HTTPS sentry.io issue URL without private parameters.',
    })
    return undefined
  }
}

function sanitizeScalar(
  value: unknown,
  path: string,
  issues: BugReportValidationIssue[],
): BugScalar | undefined {
  if (typeof value === 'boolean') {
    return value
  }

  if (typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 1_000_000_000) {
    return value
  }

  if (typeof value === 'string') {
    return readString(value, path, issues, {
      max: 120,
      min: 1,
    })
  }

  addIssue(issues, {
    code: 'invalid_type',
    path,
    message: 'Action fields may only contain bounded scalar values.',
  })
  return undefined
}

function sanitizeActions(
  value: unknown,
  issues: BugReportValidationIssue[],
): BugActionRecord[] | undefined {
  if (value === undefined) {
    return undefined
  }

  if (!Array.isArray(value)) {
    addIssue(issues, {
      code: 'invalid_type',
      path: 'diagnostics.recentActions',
      message: 'Expected an array.',
    })
    return undefined
  }

  if (value.length > BUG_REPORT_LIMITS.actionCount) {
    addIssue(issues, {
      code: 'size_limit',
      path: 'diagnostics.recentActions',
      message: `At most ${BUG_REPORT_LIMITS.actionCount} actions may be included.`,
    })
    return undefined
  }

  const actions: BugActionRecord[] = []
  value.forEach((candidate, index) => {
    const path = `diagnostics.recentActions.${index}`
    if (!isRecord(candidate)) {
      addIssue(issues, {
        code: 'invalid_type',
        path,
        message: 'Expected an action object.',
      })
      return
    }

    const type = readString(candidate.type, `${path}.type`, issues, {
      max: 80,
      min: 1,
      pattern: actionTypePattern,
    })
    const atMs = readFiniteNumber(candidate.atMs, `${path}.atMs`, issues, {
      integer: true,
      max: Number.MAX_SAFE_INTEGER,
      min: 0,
    })

    let fields: BugActionRecord['fields']
    if (candidate.fields !== undefined) {
      if (!isRecord(candidate.fields)) {
        addIssue(issues, {
          code: 'invalid_type',
          path: `${path}.fields`,
          message: 'Expected an object containing safe scalar fields.',
        })
      } else {
        fields = {}
        let fieldCount = 0
        for (const [key, fieldValue] of Object.entries(candidate.fields)) {
          if (!actionFieldSet.has(key)) {
            continue
          }
          fieldCount += 1
          if (fieldCount > BUG_REPORT_LIMITS.actionFieldCount) {
            addIssue(issues, {
              code: 'size_limit',
              path: `${path}.fields`,
              message: `At most ${BUG_REPORT_LIMITS.actionFieldCount} fields may be included.`,
            })
            break
          }
          const safeValue = sanitizeScalar(fieldValue, `${path}.fields.${key}`, issues)
          if (safeValue !== undefined) {
            fields[key as BugActionFieldKey] = safeValue
          }
        }
        if (Object.keys(fields).length === 0) {
          fields = undefined
        }
      }
    }

    if (type !== undefined && atMs !== undefined) {
      actions.push(fields ? { type, atMs, fields } : { type, atMs })
    }
  })

  return actions
}

function sanitizeGameContext(
  value: unknown,
  issues: BugReportValidationIssue[],
): BugGameContext | undefined {
  if (value === undefined) {
    return undefined
  }
  if (!isRecord(value)) {
    addIssue(issues, {
      code: 'invalid_type',
      path: 'diagnostics.game',
      message: 'Expected a game context object.',
    })
    return undefined
  }

  const result: BugGameContext = {}
  const optionalStrings = [
    ['activeCourseId', 120],
    ['modal', 80],
    ['mode', 80],
    ['screen', 80],
    ['seed', 120],
    ['tool', 80],
  ] as const

  for (const [key, max] of optionalStrings) {
    const safeValue = readString(value[key], `diagnostics.game.${key}`, issues, {
      max,
      min: 1,
      optional: true,
    })
    if (safeValue !== undefined) {
      result[key] = safeValue
    }
  }

  const optionalIntegers = [
    ['day', 0, 1_000_000],
    ['holeIndex', 0, 99],
    ['week', 0, 100_000],
  ] as const
  for (const [key, min, max] of optionalIntegers) {
    const safeValue = readFiniteNumber(value[key], `diagnostics.game.${key}`, issues, {
      integer: true,
      max,
      min,
      optional: true,
    })
    if (safeValue !== undefined) {
      result[key] = safeValue
    }
  }

  if (value.camera !== undefined) {
    if (!isRecord(value.camera)) {
      addIssue(issues, {
        code: 'invalid_type',
        path: 'diagnostics.game.camera',
        message: 'Expected a bounded camera summary.',
      })
    } else {
      const centerX = readFiniteNumber(
        value.camera.centerX,
        'diagnostics.game.camera.centerX',
        issues,
        { max: 1_000_000, min: -1_000_000 },
      )
      const centerY = readFiniteNumber(
        value.camera.centerY,
        'diagnostics.game.camera.centerY',
        issues,
        { max: 1_000_000, min: -1_000_000 },
      )
      const rotation = readFiniteNumber(
        value.camera.rotation,
        'diagnostics.game.camera.rotation',
        issues,
        { max: 360, min: -360 },
      )
      const zoom = readFiniteNumber(value.camera.zoom, 'diagnostics.game.camera.zoom', issues, {
        max: 100,
        min: 0.01,
      })
      if (
        centerX !== undefined &&
        centerY !== undefined &&
        rotation !== undefined &&
        zoom !== undefined
      ) {
        result.camera = { centerX, centerY, rotation, zoom }
      }
    }
  }

  return Object.keys(result).length > 0 ? result : undefined
}

function sanitizeDiagnostics(
  value: unknown,
  issues: BugReportValidationIssue[],
): BugReportDiagnostics | undefined {
  if (!isRecord(value)) {
    addIssue(issues, {
      code: 'invalid_type',
      path: 'diagnostics',
      message: 'Expected a diagnostics object.',
    })
    return undefined
  }

  if (!isRecord(value.app)) {
    addIssue(issues, {
      code: 'missing',
      path: 'diagnostics.app',
      message: 'Diagnostics must identify the application build.',
    })
    return undefined
  }

  const version = readString(value.app.version, 'diagnostics.app.version', issues, {
    max: 120,
    min: 1,
  })
  const environment = readString(
    value.app.environment,
    'diagnostics.app.environment',
    issues,
    { max: 40, min: 1 },
  )
  const release = readString(value.app.release, 'diagnostics.app.release', issues, {
    max: 160,
    min: 1,
    optional: true,
  })
  const commit = readString(value.app.commit, 'diagnostics.app.commit', issues, {
    max: 64,
    min: 7,
    optional: true,
    pattern: /^[0-9a-f]+$/i,
  })

  if (environment && !environmentSet.has(environment)) {
    addIssue(issues, {
      code: 'invalid_value',
      path: 'diagnostics.app.environment',
      message: 'Unknown application environment.',
    })
  }

  if (!version || !environment || !environmentSet.has(environment)) {
    return undefined
  }

  const diagnostics: BugReportDiagnostics = {
    app: {
      environment: environment as BugReportEnvironment,
      version,
      ...(commit ? { commit } : {}),
      ...(release ? { release } : {}),
    },
  }

  diagnostics.route = sanitizeRoute(value.route, issues)
  diagnostics.game = sanitizeGameContext(value.game, issues)
  diagnostics.recentActions = sanitizeActions(value.recentActions, issues)

  if (value.browser !== undefined) {
    if (!isRecord(value.browser)) {
      addIssue(issues, {
        code: 'invalid_type',
        path: 'diagnostics.browser',
        message: 'Expected a browser summary.',
      })
    } else {
      const browser: NonNullable<BugReportDiagnostics['browser']> = {}
      for (const key of ['name', 'platform', 'userAgentFamily'] as const) {
        const safeValue = readString(
          value.browser[key],
          `diagnostics.browser.${key}`,
          issues,
          { max: 160, min: 1, optional: true },
        )
        if (safeValue) {
          browser[key] = safeValue
        }
      }
      if (value.browser.viewport !== undefined) {
        if (!isRecord(value.browser.viewport)) {
          addIssue(issues, {
            code: 'invalid_type',
            path: 'diagnostics.browser.viewport',
            message: 'Expected a viewport summary.',
          })
        } else {
          const width = readFiniteNumber(
            value.browser.viewport.width,
            'diagnostics.browser.viewport.width',
            issues,
            { integer: true, max: 20_000, min: 1 },
          )
          const height = readFiniteNumber(
            value.browser.viewport.height,
            'diagnostics.browser.viewport.height',
            issues,
            { integer: true, max: 20_000, min: 1 },
          )
          const devicePixelRatio = readFiniteNumber(
            value.browser.viewport.devicePixelRatio,
            'diagnostics.browser.viewport.devicePixelRatio',
            issues,
            { max: 10, min: 0.1 },
          )
          if (
            width !== undefined &&
            height !== undefined &&
            devicePixelRatio !== undefined
          ) {
            browser.viewport = { devicePixelRatio, height, width }
          }
        }
      }
      if (Object.keys(browser).length > 0) {
        diagnostics.browser = browser
      }
    }
  }

  if (value.error !== undefined) {
    if (!isRecord(value.error)) {
      addIssue(issues, {
        code: 'invalid_type',
        path: 'diagnostics.error',
        message: 'Expected an error summary.',
      })
    } else {
      const message = readString(value.error.message, 'diagnostics.error.message', issues, {
        max: BUG_REPORT_LIMITS.errorMessageCharacters,
        min: 1,
      })
      const name = readString(value.error.name, 'diagnostics.error.name', issues, {
        max: 160,
        min: 1,
        optional: true,
      })
      const stack = readString(value.error.stack, 'diagnostics.error.stack', issues, {
        max: BUG_REPORT_LIMITS.errorStackCharacters,
        min: 1,
        optional: true,
      })
      const componentStack = readString(
        value.error.componentStack,
        'diagnostics.error.componentStack',
        issues,
        {
          max: BUG_REPORT_LIMITS.componentStackCharacters,
          min: 1,
          optional: true,
        },
      )
      const sentryEventId = readString(
        value.error.sentryEventId,
        'diagnostics.error.sentryEventId',
        issues,
        {
          max: 32,
          min: 32,
          optional: true,
          pattern: sentryEventIdPattern,
        },
      )
      const sentryIssueUrl = sanitizeSentryIssueUrl(
        value.error.sentryIssueUrl,
        issues,
      )
      if (message) {
        diagnostics.error = {
          message,
          ...(componentStack ? { componentStack } : {}),
          ...(name ? { name } : {}),
          ...(sentryEventId ? { sentryEventId } : {}),
          ...(sentryIssueUrl ? { sentryIssueUrl } : {}),
          ...(stack ? { stack } : {}),
        }
      }
    }
  }

  if (value.sentryGroup !== undefined) {
    if (!isRecord(value.sentryGroup)) {
      addIssue(issues, {
        code: 'invalid_type',
        path: 'diagnostics.sentryGroup',
        message: 'Expected a Sentry group summary.',
      })
    } else {
      const id = readString(value.sentryGroup.id, 'diagnostics.sentryGroup.id', issues, {
        max: 120,
        min: 1,
        pattern: /^[a-z0-9:._-]+$/i,
      })
      const url = readString(value.sentryGroup.url, 'diagnostics.sentryGroup.url', issues, {
        max: 500,
        min: 1,
      })
      const firstSeen = readString(
        value.sentryGroup.firstSeen,
        'diagnostics.sentryGroup.firstSeen',
        issues,
        { max: 35, min: 20 },
      )
      const lastSeen = readString(
        value.sentryGroup.lastSeen,
        'diagnostics.sentryGroup.lastSeen',
        issues,
        { max: 35, min: 20 },
      )
      const count = readFiniteNumber(
        value.sentryGroup.count,
        'diagnostics.sentryGroup.count',
        issues,
        { integer: true, max: 1_000_000_000, min: 1 },
      )
      let safeUrl: string | undefined
      if (url) {
        try {
          const parsed = new URL(url)
          if (
            parsed.protocol !== 'https:' ||
            parsed.username ||
            parsed.password ||
            parsed.search ||
            parsed.hash
          ) {
            throw new Error('unsafe')
          }
          safeUrl = parsed.toString()
        } catch {
          addIssue(issues, {
            code: 'invalid_format',
            path: 'diagnostics.sentryGroup.url',
            message: 'Expected an HTTPS Sentry group URL without credentials, query, or fragment.',
          })
        }
      }
      if (firstSeen && Number.isNaN(Date.parse(firstSeen))) {
        addIssue(issues, {
          code: 'invalid_format',
          path: 'diagnostics.sentryGroup.firstSeen',
          message: 'Expected an ISO-8601 timestamp.',
        })
      }
      if (lastSeen && Number.isNaN(Date.parse(lastSeen))) {
        addIssue(issues, {
          code: 'invalid_format',
          path: 'diagnostics.sentryGroup.lastSeen',
          message: 'Expected an ISO-8601 timestamp.',
        })
      }
      if (
        id &&
        safeUrl &&
        firstSeen &&
        lastSeen &&
        count !== undefined &&
        !Number.isNaN(Date.parse(firstSeen)) &&
        !Number.isNaN(Date.parse(lastSeen))
      ) {
        diagnostics.sentryGroup = {
          count,
          firstSeen: new Date(firstSeen).toISOString(),
          id,
          lastSeen: new Date(lastSeen).toISOString(),
          url: safeUrl,
        }
      }
    }
  }

  if (diagnostics.route === undefined) delete diagnostics.route
  if (diagnostics.game === undefined) delete diagnostics.game
  if (diagnostics.recentActions === undefined) delete diagnostics.recentActions
  if (diagnostics.sentryGroup === undefined) delete diagnostics.sentryGroup

  return diagnostics
}

export function base64ByteLength(base64: string): number | undefined {
  if (base64.length === 0 || base64.length % 4 !== 0 || !/^[a-z0-9+/]+={0,2}$/i.test(base64)) {
    return undefined
  }
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0
  return (base64.length / 4) * 3 - padding
}

function sanitizeScreenshot(
  value: unknown,
  issues: BugReportValidationIssue[],
): BugReportScreenshot | undefined {
  if (!isRecord(value)) {
    addIssue(issues, {
      code: 'invalid_type',
      path: 'screenshot',
      message: 'Expected a screenshot object.',
    })
    return undefined
  }

  if (value.mime !== 'image/png') {
    addIssue(issues, {
      code: 'invalid_value',
      path: 'screenshot.mime',
      message: 'Only PNG screenshots are accepted.',
    })
  }

  const width = readFiniteNumber(value.width, 'screenshot.width', issues, {
    integer: true,
    max: BUG_REPORT_LIMITS.screenshotWidth,
    min: 1,
  })
  const height = readFiniteNumber(value.height, 'screenshot.height', issues, {
    integer: true,
    max: BUG_REPORT_LIMITS.screenshotHeight,
    min: 1,
  })
  const bytes = readFiniteNumber(value.bytes, 'screenshot.bytes', issues, {
    integer: true,
    max: BUG_REPORT_LIMITS.screenshotBytes,
    min: 1,
  })
  const dataUrl = readString(value.dataUrl, 'screenshot.dataUrl', issues, {
    max: Math.ceil((BUG_REPORT_LIMITS.screenshotBytes * 4) / 3) + 32,
    min: 32,
    pattern: pngDataUrlPattern,
  })

  const match = dataUrl?.match(pngDataUrlPattern)
  const actualBytes = match ? base64ByteLength(match[1]) : undefined
  if (bytes !== undefined && actualBytes !== undefined && bytes !== actualBytes) {
    addIssue(issues, {
      code: 'invalid_value',
      path: 'screenshot.bytes',
      message: 'Declared screenshot size does not match its encoded data.',
    })
  }

  if (
    value.mime === 'image/png' &&
    width !== undefined &&
    height !== undefined &&
    bytes !== undefined &&
    dataUrl !== undefined &&
    bytes === actualBytes
  ) {
    return { bytes, dataUrl, height, mime: 'image/png', width }
  }

  return undefined
}

export function estimateBugReportBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength
}

export function sanitizeBugReport(input: unknown): BugReportValidationResult {
  const issues: BugReportValidationIssue[] = []
  if (!isRecord(input)) {
    return {
      ok: false,
      issues: [
        {
          code: 'invalid_type',
          path: '$',
          message: 'Expected a bug report object.',
        },
      ],
    }
  }

  if (input.schemaVersion !== BUG_REPORT_SCHEMA_VERSION) {
    addIssue(issues, {
      code: 'invalid_value',
      path: 'schemaVersion',
      message: `Only schema version ${BUG_REPORT_SCHEMA_VERSION} is accepted.`,
    })
  }

  const reportId = readString(input.reportId, 'reportId', issues, {
    max: 36,
    min: 36,
    pattern: uuidPattern,
  })
  const createdAt = readString(input.createdAt, 'createdAt', issues, {
    max: 35,
    min: 20,
  })
  if (createdAt && Number.isNaN(Date.parse(createdAt))) {
    addIssue(issues, {
      code: 'invalid_format',
      path: 'createdAt',
      message: 'Expected an ISO-8601 timestamp.',
    })
  }

  const source = readString(input.source, 'source', issues, { max: 40, min: 1 })
  if (source && !sourceSet.has(source)) {
    addIssue(issues, {
      code: 'invalid_value',
      path: 'source',
      message: 'Unknown bug report source.',
    })
  }

  let summary: BugReportSummary | undefined
  if (!isRecord(input.summary)) {
    addIssue(issues, {
      code: 'missing',
      path: 'summary',
      message: 'A bug summary is required.',
    })
  } else {
    const title = readString(input.summary.title, 'summary.title', issues, {
      max: BUG_REPORT_LIMITS.titleCharacters,
      min: 4,
    })
    const actual = readString(input.summary.actual, 'summary.actual', issues, {
      max: BUG_REPORT_LIMITS.textCharacters,
      min: 1,
    })
    const expected = readString(input.summary.expected, 'summary.expected', issues, {
      max: BUG_REPORT_LIMITS.textCharacters,
      min: 1,
    })
    const severity = readString(input.summary.severity, 'summary.severity', issues, {
      max: 20,
      min: 1,
    })
    if (severity && !severitySet.has(severity)) {
      addIssue(issues, {
        code: 'invalid_value',
        path: 'summary.severity',
        message: 'Unknown reporter severity.',
      })
    }

    const steps: string[] = []
    if (!Array.isArray(input.summary.steps)) {
      addIssue(issues, {
        code: 'invalid_type',
        path: 'summary.steps',
        message: 'Expected a list of reproduction steps.',
      })
    } else if (
      input.summary.steps.length === 0 ||
      input.summary.steps.length > BUG_REPORT_LIMITS.steps
    ) {
      addIssue(issues, {
        code: 'size_limit',
        path: 'summary.steps',
        message: `Provide between 1 and ${BUG_REPORT_LIMITS.steps} reproduction steps.`,
      })
    } else {
      input.summary.steps.forEach((step, index) => {
        const safeStep = readString(step, `summary.steps.${index}`, issues, {
          max: 1_000,
          min: 1,
        })
        if (safeStep) steps.push(safeStep)
      })
    }

    if (
      title &&
      actual &&
      expected &&
      severity &&
      severitySet.has(severity) &&
      steps.length > 0
    ) {
      summary = {
        actual,
        expected,
        severity: severity as BugReportSeverity,
        steps,
        title,
      }
    }
  }

  let consent: BugReportConsent | undefined
  if (!isRecord(input.consent)) {
    addIssue(issues, {
      code: 'missing',
      path: 'consent',
      message: 'Explicit consent choices are required.',
    })
  } else {
    const diagnostics = readBoolean(input.consent.diagnostics, 'consent.diagnostics', issues)
    const screenshot = readBoolean(input.consent.screenshot, 'consent.screenshot', issues)
    if (diagnostics !== undefined && screenshot !== undefined) {
      consent = { diagnostics, screenshot }
    }
  }

  let diagnostics: BugReportDiagnostics | undefined
  if (input.diagnostics !== undefined) {
    if (!consent?.diagnostics) {
      addIssue(issues, {
        code: 'consent_required',
        path: 'diagnostics',
        message: 'Diagnostics were supplied without explicit consent.',
      })
    } else {
      diagnostics = sanitizeDiagnostics(input.diagnostics, issues)
    }
  }
  if (diagnostics?.sentryGroup && source !== 'sentry-group') {
    addIssue(issues, {
      code: 'invalid_value',
      path: 'diagnostics.sentryGroup',
      message: 'Sentry group metadata is reserved for the authenticated Sentry route.',
    })
  }

  let screenshot: BugReportScreenshot | undefined
  if (input.screenshot !== undefined) {
    if (!consent?.screenshot) {
      addIssue(issues, {
        code: 'consent_required',
        path: 'screenshot',
        message: 'A screenshot was supplied without explicit consent.',
      })
    } else {
      screenshot = sanitizeScreenshot(input.screenshot, issues)
    }
  }

  if (consent?.diagnostics && input.diagnostics === undefined) {
    addIssue(issues, {
      code: 'missing',
      path: 'diagnostics',
      message: 'Diagnostics consent is enabled, but no diagnostics were supplied.',
    })
  }
  if (consent?.screenshot && input.screenshot === undefined) {
    addIssue(issues, {
      code: 'missing',
      path: 'screenshot',
      message: 'Screenshot consent is enabled, but no screenshot was supplied.',
    })
  }

  if (
    issues.length > 0 ||
    input.schemaVersion !== BUG_REPORT_SCHEMA_VERSION ||
    !reportId ||
    !createdAt ||
    !source ||
    !sourceSet.has(source) ||
    !summary ||
    !consent
  ) {
    return { ok: false, issues }
  }

  const report: BugReportV1 = {
    consent,
    createdAt: new Date(createdAt).toISOString(),
    reportId,
    schemaVersion: BUG_REPORT_SCHEMA_VERSION,
    source: source as BugReportSource,
    summary,
    ...(diagnostics ? { diagnostics } : {}),
    ...(screenshot ? { screenshot } : {}),
  }

  if (estimateBugReportBytes(report) > BUG_REPORT_LIMITS.totalBytes) {
    return {
      ok: false,
      issues: [
        {
          code: 'size_limit',
          path: '$',
          message: `Bug reports may not exceed ${BUG_REPORT_LIMITS.totalBytes} bytes.`,
        },
      ],
    }
  }

  return { ok: true, value: report }
}
