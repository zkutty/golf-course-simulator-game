import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { AudioProvider } from './audio/AudioProvider'
import { AppErrorBoundary } from './ui/AppErrorBoundary'
import { I18nProvider } from './i18n/I18nProvider'
import { initializeMonitoring, reportAppError } from './monitoring'

initializeMonitoring()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <I18nProvider>
      <AppErrorBoundary onError={reportAppError}>
        <AudioProvider>
          <App />
        </AudioProvider>
      </AppErrorBoundary>
    </I18nProvider>
  </StrictMode>,
)
