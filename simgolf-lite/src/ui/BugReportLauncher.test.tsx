import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { DeferredSurfaceErrorBoundary } from './BugReportLauncher'
import { loadBugReportDialog } from './bugReportDialogLoader'

describe('deferred bug report recovery', () => {
  it('shows reload recovery when the dialog import rejects', async () => {
    const failure = await loadBugReportDialog(
      () => Promise.reject(new Error('chunk unavailable')),
    ).catch((error) => error)
    const fallback = <div role="alert"><button>Reload</button></div>
    const boundary = new DeferredSurfaceErrorBoundary({ children: <span>dialog</span>, fallback })
    boundary.state = DeferredSurfaceErrorBoundary.getDerivedStateFromError(failure)

    const html = renderToStaticMarkup(boundary.render())
    expect(html).toContain('role="alert"')
    expect(html).toContain('Reload')
    expect(html).not.toContain('dialog')
  })
})
