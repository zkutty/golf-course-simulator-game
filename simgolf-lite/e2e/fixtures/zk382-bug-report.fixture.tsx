import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { BugReportDialog } from '../../src/ui/BugReportDialog'
import { I18nProvider } from '../../src/i18n/I18nProvider'
import { useI18n } from '../../src/i18n/useI18n'
import '../../src/index.css'

export function Fixture() {
  const [open, setOpen] = useState(false)
  const [closeCount, setCloseCount] = useState(0)
  const { setLocale } = useI18n()

  const close = (): void => {
    setCloseCount((count) => count + 1)
    setOpen(false)
  }

  return (
    <main>
      <button onClick={() => setOpen(true)} type="button">Open bug report</button>
      <button onClick={() => setLocale('en')} type="button">English</button>
      <button onClick={() => setLocale('pseudo')} type="button">Pseudo locale</button>
      <output aria-label="Close callback count" data-testid="close-count">{closeCount}</output>
      <BugReportDialog initialSource="manual" onClose={close} open={open} />
    </main>
  )
}

createRoot(document.getElementById('root')!).render(
  <I18nProvider><Fixture /></I18nProvider>,
)
