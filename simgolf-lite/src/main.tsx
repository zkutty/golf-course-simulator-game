import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { AudioProvider } from './audio/AudioProvider'
import { AppErrorBoundary } from './ui/AppErrorBoundary'
import { I18nProvider } from './i18n/I18nProvider'
import { initializeMonitoring, reportAppError } from './monitoring'
import { installGlobalBugCapture } from './bug-reporting/diagnostics'
import { BugReportLauncher } from './ui/BugReportDialog'

initializeMonitoring()
installGlobalBugCapture()

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
