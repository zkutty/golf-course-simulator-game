/**
 * A rejection value can be any JavaScript value, including a save, a token, or
 * an object supplied by a third-party API.  Never let the value itself cross a
 * diagnostic boundary; this small shape marker is sufficient to group future
 * occurrences without retaining player data.
 */
export type RejectionShape = 'error' | 'string' | 'primitive' | 'null' | 'object'

export interface NormalizedUnhandledRejection {
  error: Error
  shape: RejectionShape
}

export function classifyUnhandledRejection(value: unknown): RejectionShape {
  // `instanceof` consults [[Prototype]] and can itself throw for a hostile
  // Proxy.  Treat that value as the least specific safe shape without reading
  // the thrown value or the proxy's properties.
  try {
    if (value instanceof Error) return 'error'
  } catch {
    return 'object'
  }
  if (typeof value === 'string') return 'string'
  if (value === null) return 'null'
  if (
    typeof value === 'undefined' ||
    typeof value === 'boolean' ||
    typeof value === 'number' ||
    typeof value === 'bigint' ||
    typeof value === 'symbol'
  ) {
    return 'primitive'
  }
  return 'object'
}

export function normalizeUnhandledRejection(value: unknown): NormalizedUnhandledRejection {
  const shape = classifyUnhandledRejection(value)
  const error = new Error(`Unhandled promise rejection [${shape}]`)
  error.name = 'UnhandledPromiseRejection'
  return { error, shape }
}
