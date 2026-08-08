import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  captureBugError,
  createBugDiagnostics,
  installGlobalBugCapture,
  latestBugSource,
  recordBugAction,
  resetBugDiagnostics,
  updateBugDiagnosticContext,
} from './diagnostics'

afterEach(() => {
  resetBugDiagnostics()
  vi.unstubAllGlobals()
})

describe('bug diagnostics', () => {
  it('records only allowlisted scalar action fields', () => {
    recordBugAction(
      {
        type: 'PAINT_TILES',
        tiles: [{ x: 1, y: 2, terrain: 'fairway' }],
        course: { name: 'Private course name' },
        surface: 'fairway',
        holeIndex: 4,
      },
      123,
    )

    const diagnostics = createBugDiagnostics()

    expect(diagnostics.recentActions).toEqual([
      {
        type: 'PAINT_TILES',
        atMs: 123,
        fields: {
          holeIndex: 4,
          surface: 'fairway',
        },
      },
    ])
    expect(JSON.stringify(diagnostics)).not.toContain('Private course name')
    expect(JSON.stringify(diagnostics)).not.toContain('tiles')
  })

  it('keeps a bounded ring and clears old actions when a save is loaded', () => {
    for (let index = 0; index < 50; index += 1) {
      recordBugAction({ type: 'SET_MODE', mode: `mode-${index}` }, index)
    }
    expect(createBugDiagnostics().recentActions).toHaveLength(40)

    recordBugAction(
      {
        type: 'LOAD_GAME',
        course: { name: 'Must not be captured' },
        world: { cash: 10 },
      },
      100,
    )

    expect(createBugDiagnostics().recentActions).toEqual([
      { type: 'LOAD_GAME', atMs: 100 },
    ])
  })

  it('sanitizes game context into a small deterministic capsule', () => {
    updateBugDiagnosticContext({
      activeCourseId: 'course-1',
      day: 3,
      week: 4,
      screen: 'game',
      seed: 'seed-123',
      camera: { centerX: 20, centerY: 30, rotation: 45, zoom: 2 },
    })

    expect(createBugDiagnostics().game).toEqual({
      activeCourseId: 'course-1',
      day: 3,
      week: 4,
      screen: 'game',
      seed: 'seed-123',
      camera: { centerX: 20, centerY: 30, rotation: 45, zoom: 2 },
    })
  })

  it('captures bounded crash context locally until the player submits it', () => {
    const error = new Error('render failed')
    captureBugError('react-crash', error, {
      componentStack: '\n    at App',
      sentryEventId: '1234567890abcdef1234567890abcdef',
    })

    expect(latestBugSource()).toBe('react-crash')
    expect(createBugDiagnostics().error).toEqual(
      expect.objectContaining({
        message: 'render failed',
        componentStack: '\n    at App',
        sentryEventId: '1234567890abcdef1234567890abcdef',
      }),
    )
  })

  it('captures controlled window errors without submitting or persisting them', () => {
    const target = new EventTarget()
    Object.defineProperty(target, 'location', { value: { pathname: '/test' } })
    vi.stubGlobal('window', target)
    const uninstall = installGlobalBugCapture()
    const event = new Event('error')
    Object.defineProperty(event, 'error', {
      value: new Error('controlled window failure'),
    })

    target.dispatchEvent(event)

    expect(latestBugSource()).toBe('window-error')
    expect(createBugDiagnostics().error?.message).toBe('controlled window failure')
    uninstall()
  })

  it('normalizes controlled unhandled rejections without retaining their values', () => {
    const target = new EventTarget()
    Object.defineProperty(target, 'location', { value: { pathname: '/test' } })
    vi.stubGlobal('window', target)
    const uninstall = installGlobalBugCapture()
    const event = new Event('unhandledrejection')
    Object.defineProperty(event, 'reason', {
      value: 'secret=must-not-be-retained',
    })

    target.dispatchEvent(event)

    expect(latestBugSource()).toBe('unhandled-rejection')
    expect(createBugDiagnostics().error).toEqual(
      expect.objectContaining({
        name: 'Error',
        message: 'Unhandled rejection',
      }),
    )
    expect(JSON.stringify(createBugDiagnostics())).not.toContain(
      'must-not-be-retained',
    )
    uninstall()
  })
})
