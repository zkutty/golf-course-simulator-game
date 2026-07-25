import type { BugReportV1 } from '../src/bug-reporting/contracts'

export interface WorkerEnv extends Env {
  BUG_REPORT_OPERATOR_SECRET?: string
  LINEAR_API_KEY?: string
  SENTRY_WEBHOOK_SECRET?: string
}

export interface LinearIssueRef {
  archived?: boolean
  id: string
  identifier: string
  title: string
  url: string
  stateType?: string
}

export type SubmissionStatus = 'created' | 'duplicate' | 'failed' | 'processing'

export interface SubmissionResult {
  status: SubmissionStatus
  issue?: LinearIssueRef
  occurrenceCount?: number
  reconciliationRequired?: boolean
  retryAfterSeconds?: number
  retryable?: boolean
  message?: string
}

export interface CoordinatedBugReport {
  fingerprint: string
  report: BugReportV1
}

export interface RequestReconciliationState {
  fingerprint: string
  reportId: string
  status: string
}

export interface FingerprintReconciliation {
  issue?: LinearIssueRef
  outcome: 'confirmed' | 'not-created'
  reportId: string
}

export interface FingerprintReconciliationResult {
  accepted: boolean
  result?: SubmissionResult
}
