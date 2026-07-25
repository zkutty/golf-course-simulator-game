import { DurableObject } from 'cloudflare:workers'
import {
  addLinearComment,
  createLinearIssue,
  formatOccurrenceComment,
  getLinearIssue,
  LinearAmbiguousMutationError,
  LinearIssueMissingError,
} from './linear'
import type {
  CoordinatedBugReport,
  FingerprintReconciliation,
  FingerprintReconciliationResult,
  LinearIssueRef,
  RequestReconciliationState,
  SubmissionResult,
  WorkerEnv,
} from './types'

interface RequestRow extends Record<string, SqlStorageValue> {
  fingerprint: string
  result_json: string | null
  status: string
}

interface CanonicalRow extends Record<string, SqlStorageValue> {
  issue_json: string | null
  occurrence_count: number
  pending_report_id: string | null
  status: string
}

interface OccurrenceRow extends Record<string, SqlStorageValue> {
  status: string
}

function processingResult(reconciliationRequired = false): SubmissionResult {
  return {
    status: 'processing',
    reconciliationRequired,
    retryAfterSeconds: 60,
    message: reconciliationRequired
      ? 'The submission outcome needs provider reconciliation. Automatic mutation retries are paused.'
      : 'Another matching submission is still being processed. Retry this report ID safely.',
  }
}

function safeFailure(error: unknown): SubmissionResult {
  console.warn(
    JSON.stringify({
      event: 'bug_report_provider_failure',
      classification:
        error instanceof LinearAmbiguousMutationError
          ? 'ambiguous_mutation'
          : error instanceof Error
            ? error.constructor.name.slice(0, 80)
            : 'unknown',
    }),
  )
  return {
    status: 'failed',
    retryable: true,
    message:
      'The report provider is temporarily unavailable. Your report ID is safe to retry.',
  }
}

function first<T extends Record<string, SqlStorageValue>>(
  rows: SqlStorageCursor<T>,
): T | undefined {
  return rows.toArray()[0]
}

function parseIssue(value: string | null): LinearIssueRef | undefined {
  if (!value) return undefined
  try {
    const issue = JSON.parse(value) as LinearIssueRef
    return issue.id && issue.identifier && issue.title && issue.url ? issue : undefined
  } catch {
    return undefined
  }
}

function parseResult(value: string | null): SubmissionResult | undefined {
  if (!value) return undefined
  try {
    return JSON.parse(value) as SubmissionResult
  } catch {
    return undefined
  }
}

/**
 * The same namespace is sharded by request ID and by server fingerprint.
 * Each report and each canonical bug therefore has its own serialized
 * coordinator instead of a single global object.
 */
export class BugReportCoordinator extends DurableObject<WorkerEnv> {
  constructor(ctx: DurableObjectState, env: WorkerEnv) {
    super(ctx, env)
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS request_results (
        report_id TEXT PRIMARY KEY,
        fingerprint TEXT NOT NULL,
        status TEXT NOT NULL,
        result_json TEXT,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS canonical_issue (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        status TEXT NOT NULL,
        issue_json TEXT,
        occurrence_count INTEGER NOT NULL,
        pending_report_id TEXT,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS occurrences (
        report_id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `)
  }

  async submitRequest(input: CoordinatedBugReport): Promise<SubmissionResult> {
    const sql = this.ctx.storage.sql
    const existing = first(
      sql.exec<RequestRow>(
        'SELECT status, result_json FROM request_results WHERE report_id = ?',
        input.report.reportId,
      ),
    )
    const existingResult = parseResult(existing?.result_json ?? null)
    if (existingResult) return existingResult
    if (existing) return processingResult()

    const now = new Date().toISOString()
    sql.exec(
      `INSERT INTO request_results
        (report_id, fingerprint, status, result_json, updated_at)
       VALUES (?, ?, 'pending', NULL, ?)`,
      input.report.reportId,
      input.fingerprint,
      now,
    )

    let result: SubmissionResult
    try {
      const stub = this.env.BUG_REPORT_COORDINATOR.getByName(
        `fingerprint:${input.fingerprint}`,
      ) as DurableObjectStub<BugReportCoordinator>
      result = await stub.submitFingerprint(input)
    } catch (error) {
      result = safeFailure(error)
    }

    if (
      result.status === 'failed' ||
      (result.status === 'processing' && !result.reconciliationRequired)
    ) {
      // A confirmed, non-ambiguous provider failure is safe to retry with the
      // same report ID. Transient fingerprint contention is also retryable;
      // only a genuinely ambiguous external mutation remains pinned.
      sql.exec('DELETE FROM request_results WHERE report_id = ?', input.report.reportId)
    } else {
      sql.exec(
        `UPDATE request_results
         SET status = ?, result_json = ?, updated_at = ?
         WHERE report_id = ?`,
        result.status,
        JSON.stringify(result),
        new Date().toISOString(),
        input.report.reportId,
      )
    }
    return result
  }

  async getRequestReconciliation(
    reportId: string,
  ): Promise<RequestReconciliationState | undefined> {
    const row = first(
      this.ctx.storage.sql.exec<RequestRow>(
        `SELECT fingerprint, status, result_json
         FROM request_results WHERE report_id = ?`,
        reportId,
      ),
    )
    const result = parseResult(row?.result_json ?? null)
    if (
      !row ||
      row.status !== 'processing' ||
      result?.status !== 'processing' ||
      result.reconciliationRequired !== true
    ) {
      return undefined
    }
    return { fingerprint: row.fingerprint, reportId, status: row.status }
  }

  async applyRequestReconciliation(
    reportId: string,
    result?: SubmissionResult,
  ): Promise<boolean> {
    const current = await this.getRequestReconciliation(reportId)
    if (!current) return false
    if (!result) {
      this.ctx.storage.sql.exec(
        'DELETE FROM request_results WHERE report_id = ?',
        reportId,
      )
      return true
    }
    this.ctx.storage.sql.exec(
      `UPDATE request_results
       SET status = ?, result_json = ?, updated_at = ?
       WHERE report_id = ?`,
      result.status,
      JSON.stringify(result),
      new Date().toISOString(),
      reportId,
    )
    return true
  }

  async submitFingerprint(input: CoordinatedBugReport): Promise<SubmissionResult> {
    const sql = this.ctx.storage.sql
    const canonical = first(
      sql.exec<CanonicalRow>(
        `SELECT status, issue_json, occurrence_count, pending_report_id
         FROM canonical_issue WHERE id = 1`,
      ),
    )

    if (!canonical) return this.createCanonical(input)
    if (canonical.status === 'creating' || canonical.status === 'regressing') {
      return processingResult()
    }
    if (canonical.status === 'ambiguous') return processingResult(true)

    const issue = parseIssue(canonical.issue_json)
    if (!issue) {
      return {
        status: 'failed',
        message: 'Canonical issue metadata needs human reconciliation.',
      }
    }

    const occurrence = first(
      sql.exec<OccurrenceRow>(
        'SELECT status FROM occurrences WHERE report_id = ?',
        input.report.reportId,
      ),
    )
    if (occurrence) {
      return occurrence.status === 'done'
        ? {
            status: 'duplicate',
            issue,
            occurrenceCount: canonical.occurrence_count,
          }
        : processingResult(occurrence.status === 'ambiguous')
    }

    let currentIssue: LinearIssueRef
    try {
      currentIssue = await getLinearIssue(this.env, issue.id)
    } catch (error) {
      if (error instanceof LinearIssueMissingError) {
        return this.createRegression(input, issue)
      }
      return safeFailure(error)
    }

    if (
      currentIssue.archived ||
      currentIssue.stateType === 'completed' ||
      currentIssue.stateType === 'canceled'
    ) {
      return this.createRegression(input, currentIssue)
    }

    return this.addOccurrence(input, currentIssue, canonical.occurrence_count)
  }

  async reconcileFingerprint(
    input: FingerprintReconciliation,
  ): Promise<FingerprintReconciliationResult> {
    const sql = this.ctx.storage.sql
    const canonical = first(
      sql.exec<CanonicalRow>(
        `SELECT status, issue_json, occurrence_count, pending_report_id
         FROM canonical_issue WHERE id = 1`,
      ),
    )
    if (!canonical) return { accepted: false }

    if (
      canonical.status === 'ambiguous' &&
      canonical.pending_report_id === input.reportId
    ) {
      if (input.outcome === 'not-created') {
        sql.exec('DELETE FROM occurrences')
        sql.exec('DELETE FROM canonical_issue WHERE id = 1')
        return { accepted: true }
      }
      if (!input.issue) return { accepted: false }
      sql.exec(
        `UPDATE canonical_issue
         SET status = 'ready', issue_json = ?, occurrence_count = 1,
             pending_report_id = NULL, updated_at = ?
         WHERE id = 1`,
        JSON.stringify(input.issue),
        new Date().toISOString(),
      )
      sql.exec(
        `INSERT OR REPLACE INTO occurrences (report_id, status, updated_at)
         VALUES (?, 'done', ?)`,
        input.reportId,
        new Date().toISOString(),
      )
      return {
        accepted: true,
        result: {
          status: 'created',
          issue: input.issue,
          occurrenceCount: 1,
        },
      }
    }

    const occurrence = first(
      sql.exec<OccurrenceRow>(
        'SELECT status FROM occurrences WHERE report_id = ?',
        input.reportId,
      ),
    )
    if (canonical.status !== 'ready' || occurrence?.status !== 'ambiguous') {
      return { accepted: false }
    }
    if (input.outcome === 'not-created') {
      sql.exec('DELETE FROM occurrences WHERE report_id = ?', input.reportId)
      return { accepted: true }
    }

    const canonicalIssue = parseIssue(canonical.issue_json)
    if (!input.issue || !canonicalIssue || input.issue.id !== canonicalIssue.id) {
      return { accepted: false }
    }
    const nextCount = canonical.occurrence_count + 1
    sql.exec(
      `UPDATE occurrences SET status = 'done', updated_at = ?
       WHERE report_id = ?`,
      new Date().toISOString(),
      input.reportId,
    )
    sql.exec(
      `UPDATE canonical_issue
       SET issue_json = ?, occurrence_count = ?, updated_at = ?
       WHERE id = 1`,
      JSON.stringify(input.issue),
      nextCount,
      new Date().toISOString(),
    )
    return {
      accepted: true,
      result: {
        status: 'duplicate',
        issue: input.issue,
        occurrenceCount: nextCount,
      },
    }
  }

  private async createCanonical(
    input: CoordinatedBugReport,
  ): Promise<SubmissionResult> {
    const sql = this.ctx.storage.sql
    sql.exec(
      `INSERT INTO canonical_issue
        (id, status, issue_json, occurrence_count, pending_report_id, updated_at)
       VALUES (1, 'creating', NULL, 0, ?, ?)`,
      input.report.reportId,
      new Date().toISOString(),
    )

    try {
      const issue = await createLinearIssue(
        this.env,
        input.report,
        input.fingerprint,
      )
      sql.exec(
        `UPDATE canonical_issue
         SET status = 'ready', issue_json = ?, occurrence_count = 1,
             pending_report_id = NULL, updated_at = ?
         WHERE id = 1`,
        JSON.stringify(issue),
        new Date().toISOString(),
      )
      sql.exec(
        `INSERT INTO occurrences (report_id, status, updated_at)
         VALUES (?, 'done', ?)`,
        input.report.reportId,
        new Date().toISOString(),
      )
      return { status: 'created', issue, occurrenceCount: 1 }
    } catch (error) {
      if (error instanceof LinearAmbiguousMutationError) {
        sql.exec(
          `UPDATE canonical_issue
           SET status = 'ambiguous', updated_at = ? WHERE id = 1`,
          new Date().toISOString(),
        )
        return processingResult(true)
      }
      sql.exec('DELETE FROM canonical_issue WHERE id = 1')
      return safeFailure(error)
    }
  }

  private async addOccurrence(
    input: CoordinatedBugReport,
    issue: LinearIssueRef,
    occurrenceCount: number,
  ): Promise<SubmissionResult> {
    const sql = this.ctx.storage.sql
    const nextCount = occurrenceCount + 1
    sql.exec(
      `INSERT INTO occurrences (report_id, status, updated_at)
       VALUES (?, 'commenting', ?)`,
      input.report.reportId,
      new Date().toISOString(),
    )

    try {
      await addLinearComment(
        this.env,
        issue.id,
        formatOccurrenceComment(input.report, nextCount),
      )
    } catch (error) {
      if (error instanceof LinearAmbiguousMutationError) {
        sql.exec(
          `UPDATE occurrences SET status = 'ambiguous', updated_at = ?
           WHERE report_id = ?`,
          new Date().toISOString(),
          input.report.reportId,
        )
        return processingResult(true)
      }
      sql.exec('DELETE FROM occurrences WHERE report_id = ?', input.report.reportId)
      return safeFailure(error)
    }

    sql.exec(
      `UPDATE occurrences SET status = 'done', updated_at = ? WHERE report_id = ?`,
      new Date().toISOString(),
      input.report.reportId,
    )
    sql.exec(
      `UPDATE canonical_issue
       SET issue_json = ?, occurrence_count = ?, updated_at = ?
       WHERE id = 1`,
      JSON.stringify(issue),
      nextCount,
      new Date().toISOString(),
    )
    return { status: 'duplicate', issue, occurrenceCount: nextCount }
  }

  private async createRegression(
    input: CoordinatedBugReport,
    previousIssue: LinearIssueRef,
  ): Promise<SubmissionResult> {
    const sql = this.ctx.storage.sql
    sql.exec(
      `UPDATE canonical_issue
       SET status = 'regressing', pending_report_id = ?, updated_at = ?
       WHERE id = 1`,
      input.report.reportId,
      new Date().toISOString(),
    )

    let issue: LinearIssueRef
    try {
      issue = await createLinearIssue(
        this.env,
        input.report,
        input.fingerprint,
        previousIssue,
      )
    } catch (error) {
      if (error instanceof LinearAmbiguousMutationError) {
        sql.exec(
          `UPDATE canonical_issue SET status = 'ambiguous', updated_at = ? WHERE id = 1`,
          new Date().toISOString(),
        )
        return processingResult(true)
      }
      sql.exec(
        `UPDATE canonical_issue
         SET status = 'ready', pending_report_id = NULL, updated_at = ?
         WHERE id = 1`,
        new Date().toISOString(),
      )
      return safeFailure(error)
    }

    sql.exec('DELETE FROM occurrences')
    sql.exec(
      `UPDATE canonical_issue
       SET status = 'ready', issue_json = ?, occurrence_count = 1,
           pending_report_id = NULL, updated_at = ?
       WHERE id = 1`,
      JSON.stringify(issue),
      new Date().toISOString(),
    )
    sql.exec(
      `INSERT INTO occurrences (report_id, status, updated_at)
       VALUES (?, 'done', ?)`,
      input.report.reportId,
      new Date().toISOString(),
    )

    await Promise.allSettled([
      addLinearComment(
        this.env,
        previousIssue.id,
        `Regression captured as [${issue.identifier}](${issue.url}).`,
      ),
      addLinearComment(
        this.env,
        issue.id,
        `Related completed issue: [${previousIssue.identifier}](${previousIssue.url}).`,
      ),
    ])
    return { status: 'created', issue, occurrenceCount: 1 }
  }
}
