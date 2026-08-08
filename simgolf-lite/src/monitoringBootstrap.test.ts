import { describe, expect, it, vi } from 'vitest'
import { installMonitoringBootstrap } from './monitoringBootstrap'

describe('deferred monitoring bootstrap', () => {
  it('activates configured runtime services after load without a React crash', async () => {
    const target = new EventTarget()
    let scheduled: (() => void) | undefined
    const services = { analytics: false, globalCapture: false }
    const load = vi.fn(async () => {
      services.analytics = true
      services.globalCapture = true
    })
    installMonitoringBootstrap(load, {
      loaded: false,
      schedule: (callback) => { scheduled = callback },
      target,
    })

    target.dispatchEvent(new Event('load'))
    expect(load).not.toHaveBeenCalled()
    scheduled?.()
    await Promise.resolve()

    expect(load).toHaveBeenCalledOnce()
    expect(services).toEqual({ analytics: true, globalCapture: true })
  })

  it('starts after an early rejection without reading its raw reason', () => {
    const target = new EventTarget()
    const load = vi.fn(async () => undefined)
    const rejection = new Event('unhandledrejection')
    Object.defineProperty(rejection, 'reason', {
      value: new Proxy({}, { get: () => { throw new Error('raw reason inspected') } }),
    })
    installMonitoringBootstrap(load, { loaded: false, schedule: vi.fn(), target })

    expect(() => target.dispatchEvent(rejection)).not.toThrow()
    expect(load).toHaveBeenCalledOnce()
  })
})
