import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './ui/cozyLayout.css'
import App from './App.tsx'
import { AudioProvider } from './audio/AudioProvider.tsx'
import './utils/enablePerfProfiler' // Auto-enable profiler if flag is set

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AudioProvider>
      <App />
    </AudioProvider>
  </StrictMode>,
)
