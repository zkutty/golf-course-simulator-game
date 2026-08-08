import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { AudioProvider } from './audio/AudioProvider'
import { AppErrorBoundary } from './ui/AppErrorBoundary'
import { I18nProvider } from './i18n/I18nProvider'
import { installGlobalBugCapture } from './bug-reporting/diagnostics'
import { BugReportLauncher } from './ui/BugReportDialog'

installGlobalBugCapture()
const monitoring = import('./monitoring').catch(() => undefined)

function reportAppError(error: Error, info: import('react').ErrorInfo): undefined {
  void monitoring.then((module) => module?.reportAppError(error, info))
}

if (new URLSearchParams(window.location.search).get("fixture") === "zk681-analysis-worker") {
  void import("./game/analysis/benchmark").then(({ installAnalysisWorkerBenchmarkFixture }) => {
    installAnalysisWorkerBenchmarkFixture()
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
