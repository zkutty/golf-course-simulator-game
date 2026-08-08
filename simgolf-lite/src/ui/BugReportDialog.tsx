import {
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
} from 'react'
import './bugReport.css'
import {
  BUG_REPORT_LIMITS,
  sanitizeBugReport,
  type BugReportSeverity,
  type BugReportSource,
  type BugReportScreenshot,
  type BugReportV1,
} from '../bug-reporting/contracts'
import {
  BugReportClientError,
  submitBugReport,
  type BugReportSubmission,
} from '../bug-reporting/client'
import {
  createBugDiagnostics,
  latestBugSource,
} from '../bug-reporting/diagnostics'
import { captureApplicationScreenshot } from '../bug-reporting/screenshot'
import { useI18n } from '../i18n/useI18n'
import type { Translator } from '../i18n/context'

interface BugReportDialogProps {
  initialSource?: BugReportSource
  onClose: () => void
  open: boolean
}

const EMPTY_STEPS = ''

function newReportId(): string {
  return crypto.randomUUID()
}

function sourceLabel(source: BugReportSource, t: Translator): string {
  if (source === 'react-crash') return t('bugReporter.source.reactCrash')
  if (source === 'window-error') return t('bugReporter.source.windowError')
  if (source === 'unhandled-rejection') return t('bugReporter.source.unhandledRejection')
  return t('bugReporter.source.manual')
}

function errorMessage(error: unknown, t: Translator): string {
  return error instanceof Error ? error.message : t('bugReporter.error.generic')
}

export function BugReportDialog({
  initialSource,
  onClose,
  open,
}: BugReportDialogProps) {
  const { t } = useI18n()
  const titleId = useId()
  const wasOpen = useRef(false)
  const firstFieldRef = useRef<HTMLInputElement>(null)
  const onCloseRef = useRef(onClose)
  const submittingRef = useRef(false)
  const [reportId, setReportId] = useState(newReportId)
  const [createdAt, setCreatedAt] = useState(() => new Date().toISOString())
  const [title, setTitle] = useState('')
  const [actual, setActual] = useState('')
  const [expected, setExpected] = useState('')
  const [stepsText, setStepsText] = useState(EMPTY_STEPS)
  const [severity, setSeverity] = useState<BugReportSeverity>('medium')
  const [diagnosticsConsent, setDiagnosticsConsent] = useState(false)
  const [screenshotConsent, setScreenshotConsent] = useState(false)
  const [screenshot, setScreenshot] = useState<BugReportScreenshot>()
  const [capturing, setCapturing] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string>()
  const [success, setSuccess] = useState<BugReportSubmission>()
  const [controller, setController] = useState<AbortController>()
  const [diagnostics, setDiagnostics] = useState(createBugDiagnostics)
  const source = initialSource ?? latestBugSource()

  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  useEffect(() => {
    submittingRef.current = submitting
  }, [submitting])

  useEffect(() => {
    if (open && !wasOpen.current) {
      const nextDiagnostics = createBugDiagnostics()
      const crash = source !== 'manual' ? nextDiagnostics.error : undefined
      setDiagnostics(nextDiagnostics)
      setReportId(newReportId())
      setCreatedAt(new Date().toISOString())
      setTitle(
        crash
          ? `${crash.name ?? 'Error'}: ${crash.message}`.slice(
              0,
              BUG_REPORT_LIMITS.titleCharacters,
            )
          : '',
      )
      setActual(crash?.message ?? '')
      setExpected(source === 'manual' ? '' : t('bugReporter.crashExpected'))
      setStepsText(EMPTY_STEPS)
      setSeverity(source === 'manual' ? 'medium' : 'high')
      setDiagnosticsConsent(false)
      setScreenshotConsent(false)
      setScreenshot(undefined)
      setError(undefined)
      setSuccess(undefined)
    }
    wasOpen.current = open
  }, [open, source, t])

  useEffect(() => {
    if (!open) return
    const previousFocus = document.activeElement as HTMLElement | null
    window.setTimeout(() => firstFieldRef.current?.focus(), 0)
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !submittingRef.current) {
        event.preventDefault()
        onCloseRef.current()
        return
      }
      if (event.key !== 'Tab') return
      const dialog = firstFieldRef.current?.closest('[role="dialog"]')
      const focusable = dialog
        ? [...dialog.querySelectorAll<HTMLElement>(
            'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), a[href]',
          )]
        : []
      if (!focusable.length) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      previousFocus?.focus()
    }
  }, [open])

  useEffect(() => {
    if (!screenshotConsent) setScreenshot(undefined)
  }, [screenshotConsent])

  if (!open) return null

  const steps = stepsText
    .split(/\r?\n/)
    .map((step) => step.trim())
    .filter(Boolean)
    .slice(0, BUG_REPORT_LIMITS.steps)

  const report: BugReportV1 = {
    schemaVersion: 1,
    reportId,
    createdAt,
    source,
    summary: { actual, expected, severity, steps, title },
    consent: {
      diagnostics: diagnosticsConsent,
      screenshot: screenshotConsent,
    },
    ...(diagnosticsConsent ? { diagnostics } : {}),
    ...(screenshotConsent && screenshot ? { screenshot } : {}),
  }
  const validation = sanitizeBugReport(report)

  const capture = async (): Promise<void> => {
    setError(undefined)
    setCapturing(true)
    try {
      setScreenshot(await captureApplicationScreenshot())
    } catch (captureError) {
      setError(errorMessage(captureError, t))
    } finally {
      setCapturing(false)
    }
  }

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    setError(undefined)
    setSuccess(undefined)
    if (!validation.ok) {
      setError(t('bugReporter.validation.review'))
      return
    }
    const nextController = new AbortController()
    setController(nextController)
    setSubmitting(true)
    try {
      setSuccess(await submitBugReport(validation.value, {
        signal: nextController.signal,
      }))
    } catch (submitError) {
      setError(errorMessage(submitError, t))
      if (
        submitError instanceof BugReportClientError &&
        !submitError.retryable &&
        submitError.code !== 'canceled'
      ) {
        setReportId(newReportId())
      }
    } finally {
      setController(undefined)
      setSubmitting(false)
    }
  }

  return (
    <div className="cc-bug-report-backdrop" role="presentation">
      <section
        aria-describedby={`${titleId}-privacy`}
        aria-labelledby={titleId}
        aria-modal="true"
        className="cc-bug-report-dialog"
        data-testid="bug-report-dialog"
        role="dialog"
      >
        <header className="cc-bug-report-header">
          <div>
            <span className="cc-bug-report-kicker">{sourceLabel(source, t)}</span>
            <h1 id={titleId}>{t('bugReporter.title')}</h1>
          </div>
          <button
            aria-label={t('bugReporter.closeAria')}
            disabled={submitting}
            onClick={onClose}
            type="button"
          >
            ×
          </button>
        </header>

        {success ? (
          <div className="cc-bug-report-success" role="status">
            <strong>{t('bugReporter.success.received', { issue: success.issueIdentifier })}</strong>
            <p>
              {success.duplicate
                ? t('bugReporter.success.duplicate', { count: success.occurrenceCount })
                : t('bugReporter.success.created')}
            </p>
            <a href={success.issueUrl} rel="noreferrer" target="_blank">
              {t('bugReporter.success.openLinear', { issue: success.issueIdentifier })}
            </a>
            <button onClick={onClose} type="button">{t('bugReporter.done')}</button>
          </div>
        ) : (
          <form onSubmit={(event) => void submit(event)}>
            <p id={`${titleId}-privacy`} className="cc-bug-report-privacy">
              {t('bugReporter.privacy')}
            </p>

            <label>
              {t('bugReporter.field.title')}
              <input
                maxLength={BUG_REPORT_LIMITS.titleCharacters}
                onChange={(event) => setTitle(event.target.value)}
                ref={firstFieldRef}
                required
                value={title}
              />
            </label>
            <div className="cc-bug-report-two-column">
              <label>
                {t('bugReporter.field.actual')}
                <textarea
                  maxLength={BUG_REPORT_LIMITS.textCharacters}
                  onChange={(event) => setActual(event.target.value)}
                  required
                  rows={4}
                  value={actual}
                />
              </label>
              <label>
                {t('bugReporter.field.expected')}
                <textarea
                  maxLength={BUG_REPORT_LIMITS.textCharacters}
                  onChange={(event) => setExpected(event.target.value)}
                  required
                  rows={4}
                  value={expected}
                />
              </label>
            </div>
            <div className="cc-bug-report-two-column">
              <label>
                {t('bugReporter.field.steps')}
                <textarea
                  onChange={(event) => setStepsText(event.target.value)}
                  placeholder={t('bugReporter.field.stepsPlaceholder')}
                  required
                  rows={5}
                  value={stepsText}
                />
              </label>
              <label>
                {t('bugReporter.field.impact')}
                <select
                  onChange={(event) => setSeverity(event.target.value as BugReportSeverity)}
                  value={severity}
                >
                  <option value="low">{t('bugReporter.severity.low')}</option>
                  <option value="medium">{t('bugReporter.severity.medium')}</option>
                  <option value="high">{t('bugReporter.severity.high')}</option>
                  <option value="critical">{t('bugReporter.severity.critical')}</option>
                </select>
              </label>
            </div>

            <fieldset>
              <legend>{t('bugReporter.evidence.legend')}</legend>
              <label className="cc-bug-report-check">
                <input
                  checked={diagnosticsConsent}
                  onChange={(event) => setDiagnosticsConsent(event.target.checked)}
                  type="checkbox"
                />
                {t('bugReporter.evidence.diagnostics')}
              </label>
              <label className="cc-bug-report-check">
                <input
                  checked={screenshotConsent}
                  onChange={(event) => setScreenshotConsent(event.target.checked)}
                  type="checkbox"
                />
                {t('bugReporter.evidence.screenshot')}
              </label>
              {screenshotConsent && (
                <div className="cc-bug-report-screenshot">
                  {screenshot ? (
                    <>
                      <img alt={t('bugReporter.evidence.screenshotAlt')} src={screenshot.dataUrl} />
                      <button onClick={() => setScreenshot(undefined)} type="button">
                        {t('bugReporter.evidence.removeScreenshot')}
                      </button>
                    </>
                  ) : (
                    <button disabled={capturing} onClick={() => void capture()} type="button">
                      {capturing
                        ? t('bugReporter.evidence.capturing')
                        : t('bugReporter.evidence.capture')}
                    </button>
                  )}
                </div>
              )}
            </fieldset>

            <details className="cc-bug-report-preview">
              <summary>{t('bugReporter.preview.diagnostics')}</summary>
              <pre>{JSON.stringify(diagnostics, null, 2)}</pre>
            </details>
            <details className="cc-bug-report-preview">
              <summary>{t('bugReporter.preview.payload')}</summary>
              <pre>{JSON.stringify(validation.ok ? validation.value : report, null, 2)}</pre>
            </details>

            {error && <p className="cc-bug-report-error" role="alert">{error}</p>}

            <footer className="cc-bug-report-actions">
              <span>{t('bugReporter.reportId', { id: reportId.slice(0, 8) })}</span>
              <div>
                {submitting && (
                  <button onClick={() => controller?.abort('canceled')} type="button">
                    {t('bugReporter.cancelSubmission')}
                  </button>
                )}
                <button disabled={submitting} onClick={onClose} type="button">
                  {t('bugReporter.close')}
                </button>
                <button
                  disabled={submitting || !validation.ok}
                  type="submit"
                >
                  {submitting ? t('bugReporter.submitting') : t('bugReporter.submit')}
                </button>
              </div>
            </footer>
          </form>
        )}
      </section>
    </div>
  )
}
