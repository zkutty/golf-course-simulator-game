import {
  Children,
  isValidElement,
  type Dispatch,
  type EffectCallback,
  type ReactElement,
  type ReactNode,
  type SetStateAction,
} from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'

interface Deferred<T> {
  promise: Promise<T>
  reject: (error: unknown) => void
  resolve: (value: T) => void
}

interface HookHarness {
  commitEffects: () => void
  render: (component: () => ReactNode) => ReactNode
  remountEffects: () => void
  useEffect: (effect: EffectCallback) => void
  useState: <T>(initial: T | (() => T)) => [T, Dispatch<SetStateAction<T>>]
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve
    reject = nextReject
  })
  return { promise, reject, resolve }
}

function createHookHarness(): HookHarness {
  const states: unknown[] = []
  const effects: Array<{ cleanup?: () => void; effect: EffectCallback }> = []
  let stateCursor = 0
  let effectCursor = 0

  const useState = <T,>(initial: T | (() => T)): [T, Dispatch<SetStateAction<T>>] => {
    const index = stateCursor++
    if (!(index in states)) {
      states[index] = typeof initial === 'function'
        ? (initial as () => T)()
        : initial
    }
    const setState: Dispatch<SetStateAction<T>> = (next) => {
      const previous = states[index] as T
      states[index] = typeof next === 'function'
        ? (next as (value: T) => T)(previous)
        : next
    }
    return [states[index] as T, setState]
  }

  const useEffect = (effect: EffectCallback): void => {
    const index = effectCursor++
    effects[index] = { ...effects[index], effect }
  }

  const runEffects = (): void => {
    for (const entry of effects) {
      const cleanup = entry.effect()
      entry.cleanup = typeof cleanup === 'function' ? cleanup : undefined
    }
  }

  return {
    commitEffects: runEffects,
    render: (component) => {
      stateCursor = 0
      effectCursor = 0
      return component()
    },
    remountEffects: () => {
      for (const entry of effects) entry.cleanup?.()
      runEffects()
    },
    useEffect,
    useState,
  }
}

function findElement(
  node: ReactNode,
  predicate: (element: ReactElement) => boolean,
): ReactElement | undefined {
  if (!isValidElement(node)) return undefined
  if (predicate(node)) return node
  const props = node.props as { children?: ReactNode }
  for (const child of Children.toArray(props.children)) {
    const match = findElement(child, predicate)
    if (match) return match
  }
  return undefined
}

function findByTestId(node: ReactNode, testId: string): ReactElement | undefined {
  return findElement(node, (element) => (
    element.props as { 'data-testid'?: string }
  )['data-testid'] === testId)
}

async function flushPromises(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

async function loadLauncher(options: {
  enabled: boolean
  harness: HookHarness
  loader: ReturnType<typeof vi.fn>
}) {
  vi.stubGlobal('window', Object.assign(new EventTarget(), {
    location: { reload: vi.fn() },
  }))
  vi.stubGlobal('document', new EventTarget())
  vi.resetModules()
  const react = await vi.importActual<typeof import('react')>('react')
  vi.doMock('react', () => ({
    ...react,
    useEffect: options.harness.useEffect,
    useState: options.harness.useState,
  }))
  vi.doMock('./bugReportDialogLoader', () => ({
    loadBugReportDialog: options.loader,
  }))
  vi.doMock('../bug-reporting/feature', () => ({
    isBugReportingEnabled: () => options.enabled,
    resolveBugReportingEnabled: async () => options.enabled,
  }))
  vi.doMock('../i18n/useI18n', () => ({
    useI18n: () => ({
      t: (key: string) => key === 'auto.ui.apperrorboundary.reload' ? 'Reload' : key,
    }),
  }))
  return import('./BugReportLauncher')
}

afterEach(() => {
  vi.clearAllMocks()
  vi.resetModules()
  vi.unstubAllGlobals()
})

describe('deferred bug report launcher lifecycle', () => {
  it('mounts an opened dialog when the pending loader resolves', async () => {
    const harness = createHookHarness()
    const loading = deferred<{ default: () => ReactElement }>()
    const loader = vi.fn(() => loading.promise)
    const { BugReportLauncher } = await loadLauncher({ enabled: true, harness, loader })

    let tree = harness.render(BugReportLauncher)
    harness.commitEffects()
    const launcher = findByTestId(tree, 'bug-report-launcher')
    expect(launcher).toBeDefined()
    ;(launcher!.props as { onClick: () => void }).onClick()
    tree = harness.render(BugReportLauncher)
    expect(renderToStaticMarkup(tree)).not.toContain('bug-report-dialog')

    loading.resolve({ default: () => <div data-testid="bug-report-dialog">dialog</div> })
    await flushPromises()
    tree = harness.render(BugReportLauncher)

    expect(renderToStaticMarkup(tree)).toContain('data-testid="bug-report-dialog"')
    expect(loader).toHaveBeenCalledTimes(1)
  })

  it('shows reload recovery when the dialog loader rejects', async () => {
    const harness = createHookHarness()
    const loading = deferred<{ default: () => ReactElement }>()
    const loader = vi.fn(() => loading.promise)
    const { BugReportLauncher } = await loadLauncher({ enabled: true, harness, loader })

    let tree = harness.render(BugReportLauncher)
    harness.commitEffects()
    const launcher = findByTestId(tree, 'bug-report-launcher')
    ;(launcher!.props as { onClick: () => void }).onClick()
    loading.reject(new Error('chunk unavailable'))
    await flushPromises()
    tree = harness.render(BugReportLauncher)
    const html = renderToStaticMarkup(tree)

    expect(html).toContain('role="alert"')
    expect(html).toContain('Reload')
    expect(html).not.toContain('bug-report-dialog')
    const reload = findElement(tree, (element) => (
      element.type === 'button' &&
      (element.props as { children?: ReactNode }).children === 'Reload'
    ))
    expect(reload).toBeDefined()
    ;(reload!.props as { onClick: () => void }).onClick()
    expect(window.location.reload).toHaveBeenCalledTimes(1)
  })

  it('does not preload when reporting is disabled', async () => {
    const harness = createHookHarness()
    const loader = vi.fn()
    const { BugReportLauncher } = await loadLauncher({ enabled: false, harness, loader })

    const tree = harness.render(BugReportLauncher)
    harness.commitEffects()
    await flushPromises()

    expect(tree).toBeNull()
    expect(loader).not.toHaveBeenCalled()
  })

  it('reuses one cached load across a StrictMode-style effect remount', async () => {
    const harness = createHookHarness()
    const loading = deferred<{ default: () => ReactElement }>()
    const loader = vi.fn(() => loading.promise)
    const { BugReportLauncher } = await loadLauncher({ enabled: true, harness, loader })

    harness.render(BugReportLauncher)
    harness.commitEffects()
    harness.remountEffects()

    expect(loader).toHaveBeenCalledTimes(1)
    loading.resolve({ default: () => <div data-testid="bug-report-dialog">dialog</div> })
    await flushPromises()
  })
})
