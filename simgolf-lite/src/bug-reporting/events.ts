import type { BugReportSource } from './contracts'

export const BUG_REPORT_OPEN_EVENT = 'coursecraft-open-bug-reporter'

export function openBugReporter(source: BugReportSource = 'manual'): void {
  window.dispatchEvent(
    new CustomEvent<BugReportSource>(BUG_REPORT_OPEN_EVENT, { detail: source }),
  )
}
