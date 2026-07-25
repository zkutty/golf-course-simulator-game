interface BugReportingConfig {
  enabled?: unknown
}

let runtimeEnabled: boolean | undefined

function buildTimeEnabled(): boolean {
  return (
    (import.meta.env.DEV && import.meta.env.MODE !== 'test') ||
    import.meta.env.MODE === 'e2e' ||
    import.meta.env.VITE_BUG_REPORTING === 'true'
  )
}

export function isBugReportingEnabled(): boolean {
  return buildTimeEnabled() || runtimeEnabled === true
}

/**
 * Runtime configuration keeps one production build usable in both public and
 * playtest environments. Failure is closed: the launcher stays hidden.
 */
export async function resolveBugReportingEnabled(
  fetchFn: typeof fetch = fetch,
): Promise<boolean> {
  if (buildTimeEnabled()) {
    runtimeEnabled = true
    return true
  }
  try {
    const response = await fetchFn('/api/bug-reports/config', {
      cache: 'no-store',
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    })
    if (!response.ok) {
      runtimeEnabled = false
      return false
    }
    const value = (await response.json()) as BugReportingConfig
    runtimeEnabled = value.enabled === true
    return runtimeEnabled
  } catch {
    runtimeEnabled = false
    return false
  }
}

export function resetBugReportingFeatureForTests(): void {
  runtimeEnabled = undefined
}
