import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { AudioProvider } from './audio/AudioProvider'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AudioProvider>
      <App />
    </AudioProvider>
  </StrictMode>,
)
