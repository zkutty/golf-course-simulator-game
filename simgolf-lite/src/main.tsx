import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { AudioProvider } from './audio/AudioProvider'
import { AppErrorBoundary } from './ui/AppErrorBoundary'
import { I18nProvider } from './i18n/I18nProvider'
import { installGlobalBugCapture } from './bug-reporting/diagnostics'
import { BugReportLauncher } from './ui/BugReportLauncher'
import { createDeferredReporter } from './deferredReporter'
import { installMonitoringBootstrap } from './monitoringBootstrap'

installGlobalBugCapture()
const reportAppError = createDeferredReporter(() => import('./monitoring')
  .then((module) => module.reportAppError)
  .catch(() => undefined))
installMonitoringBootstrap(reportAppError.load)

const fixture = new URLSearchParams(window.location.search).get("fixture")
if (fixture === "zk681-analysis-worker") {
  void import("./game/analysis/benchmark").then(({ installAnalysisWorkerBenchmarkFixture }) => {
    installAnalysisWorkerBenchmarkFixture()
  })
} else if (fixture === "zk682-desktop-persistence") {
  // Reuse the existing deferred packaged-diagnostic entry so certification
  // code never enters the normal launch bundle or its critical budget.
  void import("./game/analysis/benchmark").then(({ installZk682DesktopPersistenceCertificationFixture }) => {
    installZk682DesktopPersistenceCertificationFixture()
  })
} else {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <I18nProvider>
        <AppErrorBoundary onError={reportAppError}>
          <AudioProvider>
            <App />
          </AudioProvider>
        </AppErrorBoundary>
        <BugReportLauncher />
      </I18nProvider>
    </StrictMode>,
  )
}
