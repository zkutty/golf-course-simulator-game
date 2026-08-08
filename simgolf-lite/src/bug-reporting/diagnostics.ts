import {
  BUG_ACTION_FIELD_KEYS,
  BUG_REPORT_LIMITS,
  type BugActionFieldKey,
  type BugActionRecord,
  type BugGameContext,
  type BugReportDiagnostics,
  type BugReportEnvironment,
  type BugReportSource,
  type BugScalar,
} from './contracts'

interface CapturedError {
  componentStack?: string
  message: string
  name?: string
  sentryEventId?: string
  source: Exclude<BugReportSource, 'manual' | 'sentry-group'>
  stack?: string
}

const actionFieldSet = new Set<string>(BUG_ACTION_FIELD_KEYS)
const resetActionTypes = new Set(['NEW_GAME', 'LOAD_GAME'])

let gameContext: BugGameContext = {}
let recentActions: BugActionRecord[] = []
let capturedError: CapturedError | undefined

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function safeScalar(value: unknown): BugScalar | undefined {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 1_000_000_000) {
    return value
  }
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed ? trimmed.slice(0, 120) : undefined
  }
  return undefined
}

function safeInteger(value: unknown, min: number, max: number): number | undefined {
  return typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= min &&
    value <= max
    ? value
    : undefined
}

function safeNumber(value: unknown, min: number, max: number): number | undefined {
  return typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= min &&
    value <= max
    ? value
    : undefined
}

function compactString(value: unknown, max = 120): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed ? trimmed.slice(0, max) : undefined
}

function inferBrowserFamily(userAgent: string): string | undefined {
  if (/\bEdg\//.test(userAgent)) return 'Edge'
  if (/\bFirefox\//.test(userAgent)) return 'Firefox'
  if (/\b(?:Chrome|CriOS)\//.test(userAgent)) return 'Chrome'
  if (/\bSafari\//.test(userAgent) && /\bVersion\//.test(userAgent)) return 'Safari'
  return undefined
}

function runtimeEnvironment(): BugReportEnvironment {
  if (import.meta.env.MODE === 'test' || import.meta.env.MODE === 'e2e') return 'e2e'
  if (import.meta.env.DEV) return 'development'
  const configured = import.meta.env.VITE_APP_ENVIRONMENT?.trim()
  if (
    configured === 'playtest' ||
    configured === 'staging' ||
    configured === 'production' ||
    configured === 'e2e'
  ) {
    return configured
  }
  return import.meta.env.PROD ? 'production' : 'unknown'
}

function errorFromUnknown(value: unknown): Error {
  if (value instanceof Error) return value
  if (typeof value === 'string' && value.trim()) return new Error(value.trim())
  return new Error('Unhandled rejection')
}

function safeGameContext(value: BugGameContext): BugGameContext {
  const safe: BugGameContext = {}
  const activeCourseId = compactString(value.activeCourseId)
  const modal = compactString(value.modal, 80)
  const mode = compactString(value.mode, 80)
  const screen = compactString(value.screen, 80)
  const seed = compactString(value.seed)
  const tool = compactString(value.tool, 80)
  const day = safeInteger(value.day, 0, 1_000_000)
  const holeIndex = safeInteger(value.holeIndex, 0, 99)
  const week = safeInteger(value.week, 0, 100_000)
  if (activeCourseId) safe.activeCourseId = activeCourseId
  if (modal) safe.modal = modal
  if (mode) safe.mode = mode
  if (screen) safe.screen = screen
  if (seed) safe.seed = seed
  if (tool) safe.tool = tool
  if (day !== undefined) safe.day = day
  if (holeIndex !== undefined) safe.holeIndex = holeIndex
  if (week !== undefined) safe.week = week

  if (value.camera) {
    const centerX = safeNumber(value.camera.centerX, -1_000_000, 1_000_000)
    const centerY = safeNumber(value.camera.centerY, -1_000_000, 1_000_000)
    const rotation = safeNumber(value.camera.rotation, -360, 360)
    const zoom = safeNumber(value.camera.zoom, 0.01, 100)
    if (
      centerX !== undefined &&
      centerY !== undefined &&
      rotation !== undefined &&
      zoom !== undefined
    ) {
      safe.camera = { centerX, centerY, rotation, zoom }
    }
  }
  return safe
}

/** Store only an allowlisted, bounded view of the current game state. */
export function updateBugDiagnosticContext(next: BugGameContext): void {
  gameContext = safeGameContext(next)
}

/**
 * Record a reducer action without retaining payload objects such as saves,
 * courses, worlds, tile arrays, or property commands.
 */
export function recordBugAction(action: unknown, atMs = Date.now()): void {
  if (!isRecord(action) || typeof action.type !== 'string' || !action.type.trim()) return
  const type = action.type.trim().slice(0, 80)
  if (resetActionTypes.has(type)) recentActions = []

  const fields: Partial<Record<BugActionFieldKey, BugScalar>> = {}
  for (const [key, value] of Object.entries(action)) {
    if (!actionFieldSet.has(key)) continue
    const scalar = safeScalar(value)
    if (scalar !== undefined) fields[key as BugActionFieldKey] = scalar
  }

  if (isRecord(action.position)) {
    const x = safeScalar(action.position.x)
    const y = safeScalar(action.position.y)
    if (x !== undefined) fields.x = x
    if (y !== undefined) fields.y = y
  }

  const record: BugActionRecord = {
    atMs: Math.max(0, Math.floor(atMs)),
    type,
    ...(Object.keys(fields).length ? { fields } : {}),
  }
  recentActions = [...recentActions, record].slice(-BUG_REPORT_LIMITS.actionCount)
}

export function captureBugError(
  source: CapturedError['source'],
  value: unknown,
  options: { componentStack?: string | null; sentryEventId?: string } = {},
): void {
  const error = errorFromUnknown(source === 'unhandled-rejection' ? undefined : value)
  capturedError = {
    message: (error.message || error.name || 'Unknown error').slice(
      0,
      BUG_REPORT_LIMITS.errorMessageCharacters,
    ),
    source,
    ...(error.name ? { name: error.name.slice(0, 160) } : {}),
    ...(error.stack
      ? { stack: error.stack.slice(0, BUG_REPORT_LIMITS.errorStackCharacters) }
      : {}),
    ...(options.componentStack
      ? {
          componentStack: options.componentStack.slice(
            0,
            BUG_REPORT_LIMITS.componentStackCharacters,
          ),
        }
      : {}),
    ...(options.sentryEventId ? { sentryEventId: options.sentryEventId.slice(0, 32) } : {}),
  }
}

export function installGlobalBugCapture(): () => void {
  const onError = (event: ErrorEvent): void => {
    captureBugError('window-error', event.error ?? event.message)
  }
  const onUnhandledRejection = (): void => {
    // A rejected value can itself be hostile or contain private game state.
    // The local draft needs only the fixed source and fallback error marker.
    captureBugError('unhandled-rejection', undefined)
  }
  window.addEventListener('error', onError)
  window.addEventListener('unhandledrejection', onUnhandledRejection)
  return () => {
    window.removeEventListener('error', onError)
    window.removeEventListener('unhandledrejection', onUnhandledRejection)
  }
}

export function latestBugSource(): BugReportSource {
  return capturedError?.source ?? 'manual'
}

export function createBugDiagnostics(): BugReportDiagnostics {
  const userAgent = typeof navigator === 'undefined' ? '' : navigator.userAgent
  const platform =
    typeof navigator === 'undefined' ? undefined : compactString(navigator.platform, 160)
  const diagnostics: BugReportDiagnostics = {
    app: {
      environment: runtimeEnvironment(),
      version: __APP_VERSION__,
      ...(typeof __APP_RELEASE__ === 'string' && __APP_RELEASE__
        ? { release: __APP_RELEASE__ }
        : {}),
      ...(typeof __COMMIT_SHA__ === 'string' && /^[0-9a-f]{7,64}$/i.test(__COMMIT_SHA__)
        ? { commit: __COMMIT_SHA__ }
        : {}),
    },
    ...(typeof window !== 'undefined' && window.location.pathname
      ? { route: window.location.pathname }
      : {}),
    ...(Object.keys(gameContext).length ? { game: { ...gameContext } } : {}),
    ...(recentActions.length
      ? {
          recentActions: recentActions.map((action) => ({
            ...action,
            ...(action.fields ? { fields: { ...action.fields } } : {}),
          })),
        }
      : {}),
  }

  if (typeof window !== 'undefined' && typeof navigator !== 'undefined') {
    diagnostics.browser = {
      ...(inferBrowserFamily(userAgent) ? { name: inferBrowserFamily(userAgent) } : {}),
      ...(platform ? { platform } : {}),
      ...(inferBrowserFamily(userAgent)
        ? { userAgentFamily: inferBrowserFamily(userAgent) }
        : {}),
      viewport: {
        devicePixelRatio: window.devicePixelRatio || 1,
        height: window.innerHeight,
        width: window.innerWidth,
      },
    }
  }

  if (capturedError) {
    diagnostics.error = {
      message: capturedError.message,
      ...(capturedError.componentStack
        ? { componentStack: capturedError.componentStack }
        : {}),
      ...(capturedError.name ? { name: capturedError.name } : {}),
      ...(capturedError.sentryEventId ? { sentryEventId: capturedError.sentryEventId } : {}),
      ...(capturedError.stack ? { stack: capturedError.stack } : {}),
    }
  }

  return diagnostics
}

/** Test and session reset; never persisted to local storage. */
export function resetBugDiagnostics(): void {
  capturedError = undefined
  gameContext = {}
  recentActions = []
}
