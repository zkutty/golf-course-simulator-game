import { describe, expect, it } from 'vitest'
import { normalizeUnhandledRejection } from './rejectionDiagnostics'
import { captureBugError, createBugDiagnostics, resetBugDiagnostics } from './bug-reporting/diagnostics'

describe('unhandled rejection normalization', () => {
  it.each([
    [new Error('private save token'), 'error'],
    ['token=private', 'string'],
    [42, 'primitive'],
    [null, 'null'],
    [{ save: { courseName: 'Private Club' } }, 'object'],
  ] as const)('uses a fixed error for %s rejection values', (value, shape) => {
    const normalized = normalizeUnhandledRejection(value)

    expect(normalized.shape).toBe(shape)
    expect(normalized.error.name).toBe('UnhandledPromiseRejection')
    expect(normalized.error.message).toBe(`Unhandled promise rejection [${shape}]`)
    expect(normalized.error.message).not.toContain('private')
    expect(normalized.error.message).not.toContain('Private Club')
  })

  it('treats a hostile Proxy as an opaque object without retaining trap data', () => {
    const hostile = new Proxy({}, {
      getPrototypeOf() {
        throw new Error('trap-secret=never-retain')
      },
    })

    expect(normalizeUnhandledRejection(hostile)).toMatchObject({
      shape: 'object',
      error: { message: 'Unhandled promise rejection [object]' },
    })

    captureBugError('unhandled-rejection', hostile)
    const serialized = JSON.stringify(createBugDiagnostics())
    expect(serialized).not.toContain('trap-secret')
    expect(serialized).not.toContain('never-retain')
    resetBugDiagnostics()
  })
})
