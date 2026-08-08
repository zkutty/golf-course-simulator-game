import { Component, lazy, Suspense, useEffect, useState, type ReactNode } from 'react'
import type { BugReportSource } from '../bug-reporting/contracts'
import { BUG_REPORT_OPEN_EVENT } from '../bug-reporting/events'
import { isBugReportingEnabled, resolveBugReportingEnabled } from '../bug-reporting/feature'
import { useI18n } from '../i18n/useI18n'
import { loadBugReportDialog } from './bugReportDialogLoader'
import './bugReportLauncher.css'

const BugReportDialog = lazy(() => loadBugReportDialog())

export class DeferredSurfaceErrorBoundary extends Component<{
  children: ReactNode
  fallback: ReactNode
}, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError(_error: unknown): { failed: true } { return { failed: true } }
  render(): ReactNode { return this.state.failed ? this.props.fallback : this.props.children }
}

export function BugReportLauncher() {
  const { t } = useI18n()
  const [enabled, setEnabled] = useState(isBugReportingEnabled)
  const [open, setOpen] = useState(false)
  const [source, setSource] = useState<BugReportSource>('manual')

  useEffect(() => {
    let active = true
    void resolveBugReportingEnabled().then((value) => {
      if (active) setEnabled(value)
    })
    return () => { active = false }
  }, [])

  useEffect(() => {
    const onOpen = (event: Event): void => {
      setSource((event as CustomEvent<BugReportSource>).detail ?? 'manual')
      setOpen(true)
    }
    window.addEventListener(BUG_REPORT_OPEN_EVENT, onOpen)
    return () => window.removeEventListener(BUG_REPORT_OPEN_EVENT, onOpen)
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.altKey && event.shiftKey && event.key.toLowerCase() === 'b' && !event.metaKey && !event.ctrlKey) {
        event.preventDefault()
        setSource('manual')
        setOpen(true)
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])

  if (!enabled) return null
  return <>
    <button aria-keyshortcuts="Alt+Shift+B" className="cc-bug-report-launcher" data-testid="bug-report-launcher" onClick={() => {
      setSource('manual')
      setOpen(true)
    }} title={t('bugReporter.launcherTitle')} type="button">{t('bugReporter.launcher')}</button>
    {open && <DeferredSurfaceErrorBoundary fallback={<div className="cc-bug-report-load-error" role="alert">
      <span>{t('bugReporter.error.generic')}</span>
      <button onClick={() => window.location.reload()} type="button">{t('auto.ui.apperrorboundary.reload')}</button>
    </div>}>
      <Suspense fallback={null}>
        <BugReportDialog initialSource={source} onClose={() => setOpen(false)} open />
      </Suspense>
    </DeferredSurfaceErrorBoundary>}
  </>
}
