# M45 Bug Capture and Repair Operations

## Safety boundary

CourseCraft bug reports cross three trust boundaries:

1. The browser gathers only player-entered text and explicitly consented, bounded
   diagnostics/evidence.
2. The Cloudflare Worker validates and reconstructs the report, computes its
   fingerprint, rate-limits intake, and is the only component that holds the Linear
   credential.
3. A human triages the resulting Linear issue. Client input can never apply the
   `autofix-ready` label, select Urgent priority, launch Codex, merge, deploy, verify,
   or close an issue.

The browser must never submit full saves, cookies, authorization data, request
headers, query strings, arbitrary local storage, player identity, or unbounded
console/breadcrumb data. Reports are not cached in local storage or a service worker.

## Runtime controls

| Control | Default | Effect |
| --- | --- | --- |
| `BUG_REPORTING_ENABLED` | `false` | Disables reporter configuration and intake. |
| `SENTRY_ROUTING_ENABLED` | `false` | Disables Sentry-to-Linear routing independently. |
| `SENTRY_MIN_OCCURRENCES` | `3` | Minimum nonfatal error-group count unless a signed request explicitly promotes it. |
| `REPAIR_DISPATCH_ENABLED` | `false` | Makes the repair dispatcher dry-run only. |
| `LINEAR_API_KEY` | unset secret | Required only by the Worker/dispatcher, never Vite. |
| `SENTRY_WEBHOOK_SECRET` | unset secret | Authenticates Sentry custom-integration requests. |
| `BUG_REPORT_OPERATOR_SECRET` | unset secret | Authenticates the narrow ambiguous-mutation reconciliation endpoint. Keep separate from the Sentry secret. |

Disable the affected control first when an integration is unavailable or suspicious.
Reports remain local and retryable only while the reporter dialog is open. Rotate a
credential in its provider, update the Cloudflare/Codex secret, validate staging,
then re-enable the control. Do not put secret values in Linear comments, logs, build
arguments, Vite variables, or this document.

## Canonical Linear issue

Every accepted report is created in the Zkutty `golf-sim` project with `Bug` and
`qa`. Triage is preferred when the team exposes it; Backlog is the fallback. The
server maps reporter severity to guidance only:

| Reporter severity | Maximum automatic Linear priority |
| --- | --- |
| Critical | High |
| High | High |
| Medium | Medium |
| Low | Low |

Urgent is always a human decision. The client cannot provide team, project, state,
priority, labels, assignee, issue IDs, or automation directives.

The title format is `[source] concise title`. The description contains:

```markdown
<!-- coursecraft-bug-fingerprint:sha256 -->
<!-- coursecraft-report-id:uuid -->

## Observed
Player-entered actual behavior.

## Expected
Player-entered expected behavior.

## Reproduction
1. Ordered player-entered step.

## Acceptance
- Focused regression coverage.
- Player-entered expected behavior.
- No save/privacy/determinism regressions.

## Safe diagnostic capsule
- Build: version / release / commit / environment
- Location: route path / app screen / mode / tool / modal
- Determinism: seed / week / day / course ID / hole
- Runtime: browser family / platform / viewport
- Error: bounded name, message, stack, component stack, Sentry event ID
- Recent actions: bounded action names and allowlisted scalar fields

## Evidence
Explicitly consented screenshot, privately ingested by Linear.

## Intake
- Source and reporter severity
- Consent choices
- First/most recent occurrence
- Occurrence count
```

Duplicate reports add one occurrence comment to the canonical issue. The comment
includes timestamp, report ID, build, severity, safe changed context, and occurrence
count; it never repeats a screenshot or unbounded stack. Concurrent delivery and
network retry are idempotent by report ID. Stable server-side fingerprints group
equivalent reports. If a canonical issue is completed or canceled, a new regression
issue is created and both issues receive cross-reference comments.

## Labels and transitions

| State/label | Entry rule | Exit rule / next action |
| --- | --- | --- |
| Triage or Backlog | Worker accepted a new canonical report. | Human reviews evidence and scope. |
| `needs-repro` | Reproduction/evidence is insufficient or intermittent. | Human confirms a deterministic reproduction and removes it. |
| `needs-human-review` | Security/privacy, suspected save corruption, destructive migration, ambiguous design feedback, external outage, or automation uncertainty. | A maintainer resolves the concern; automation never clears this label. |
| `autofix-ready` | A human confirms a bounded nonsecurity bug, deterministic reproduction, acceptance test, and safe repository scope. | Dispatcher claims the issue and removes/marks the approval according to its claim protocol. |
| In Progress | Dispatcher or human starts repair. | Draft PR is linked in a Linear comment, or failure is documented and issue returns to human review. |
| In Review | Draft PR exists and required checks pass. | Human merges and deploys. Automation does not merge. |
| `reporter-verified` | Reporter/designated playtester verifies the deployed fix. | Human may close the issue. |
| Done | Human confirms deployment and verification. | A matching future occurrence opens a regression issue. |

Only a human may apply `autofix-ready`, `reporter-verified`, Urgent, Done, or merge
approval. The dispatcher refuses issues with `needs-repro` or
`needs-human-review`, missing reproduction/acceptance sections, unknown attachments,
security/privacy/save-corruption language, destructive migration requests, or scope
outside the configured repository.

## Repair loop

The dispatcher performs a dry-run by default. An enabled run:

1. Searches only active `golf-sim` issues with `Bug` and human-applied
   `autofix-ready`.
2. Re-reads the issue and validates its labels, project, state, canonical report
   markers, reproduction, expected behavior, and exclusions.
3. Claims one issue with an idempotent Linear comment before launching work.
4. Gives Codex bounded issue context and requires a dedicated branch, focused tests,
   a draft pull request, and a Linear evidence comment.
5. Stops at the draft PR. CI, review, merge, deployment, reporter verification, and
   closure remain human gates.

On ambiguity, timeout, failed checks, unavailable provider, or uncertain mutation,
the dispatcher comments once, applies `needs-human-review`, and stops. It must not
blindly retry a possibly successful external mutation.

## Evidence retention and response

Screenshots are opt-in PNG files with the contract's byte/dimension limits. They are
validated by signature, chunk bounds, checksums, and IHDR dimensions. The Worker
rebuilds the image from `IHDR`, palette/transparency, image-data, and `IEND` chunks,
discarding text, EXIF, color-profile, timestamp, and trailing bytes before Linear
privately ingests it. Animated PNGs and unknown critical chunks are rejected. The
Worker does not publish or persist an R2 URL. Diagnostic data lives only in the
Linear issue and its provider retention policy. Delete evidence from Linear when it
is no longer required or on a valid privacy request.

If a report contains unexpected personal or secret material:

1. Disable intake and Sentry routing.
2. Restrict/delete the Linear issue and evidence.
3. Rotate any possibly exposed credential.
4. Preserve only non-sensitive incident metadata.
5. Fix the allowlist/validation gap and certify staging before re-enabling.

## Certification checklist

- Manual, React crash, window error, unhandled rejection, and Sentry-group sources.
- Consent denied, diagnostics only, screenshot only, and both consented.
- Oversize/malformed/version/PNG spoof rejection.
- Same-report retry, concurrent retry, stable duplicate, and completed regression.
- Linear HTTP failure, GraphQL-in-200 failure, timeout/ambiguous mutation, and rate limit.
- Runtime kill switches, secret absence from `dist`, service-worker non-caching, and
  static/PWA fallback behavior.
- Dispatcher dry-run, exclusion rules, idempotent claim, failed checks, and draft-PR stop.
- Keyboard-only reporter use, narrow/wide layouts, crash-boundary handoff, and
  reporter verification/closure by a human.

## Enable and verify intake

1. Create the Worker secrets with `wrangler secret put LINEAR_API_KEY --env
   staging`, `wrangler secret put SENTRY_WEBHOOK_SECRET --env staging`, and
   `wrangler secret put BUG_REPORT_OPERATOR_SECRET --env staging`. Use separate
   long random values for the webhook and operator secrets. Never use a `VITE_`
   prefix for any Worker secret.
2. Keep production's two switches false. Build and validate staging with `npm run
   build`, `npm run deploy:check:staging`, `npm run test:worker`, and `npx
   playwright test e2e/m45-bug-reporting.e2e.ts`.
3. Deploy staging through the existing Cloudflare playtest procedure. Submit a
   controlled manual report without evidence, then with explicitly consented
   diagnostics/evidence. Verify one Linear issue has only the configured project,
   labels, safe capsule, and private image.
4. Retry the same report ID and send an equivalent new report. Verify one canonical
   issue and incremented occurrences. Complete the test issue, repeat, and verify a
   linked regression issue is created.
5. Send a signed Sentry fixture below and above the configured threshold. Verify the
   first is acknowledged without an issue and the second reaches the same canonical
   workflow. Record the issue, group, deployment commit, and cleanup in
   `release/m45-certification.json`.

Disable either route immediately by setting its switch false and redeploying. Intake
and Sentry routing are independent; disabling them does not alter the static SPA or
existing Linear issues.

### Reconcile an ambiguous Linear mutation

An intake response with `status: "processing"` and provider-reconciliation wording
means Linear may have accepted a create/comment even though its response was lost.
The request and fingerprint are deliberately pinned so an automatic retry cannot
duplicate the mutation.

1. Disable intake if multiple reports are affected.
2. Search Linear for the exact `coursecraft-report-id` marker from the reporter.
3. If the issue/comment exists, POST the report ID, `outcome: "confirmed"`, and the
   confirmed Linear issue ID to `/api/bug-reports/reconcile`. If the mutation
   definitely did not occur, POST the report ID with `outcome: "not-created"`.
4. Authenticate with `X-CourseCraft-Operator-Secret`. Never place the secret in the
   JSON body, URL, logs, issue, or browser bundle.
5. Retry the original report ID. A confirmed reconciliation returns its canonical
   issue; a not-created reconciliation releases only that request/fingerprint
   mutation so the normal idempotent path can safely try again.

The endpoint accepts no report body, cannot create arbitrary issues, verifies a
confirmed issue through Linear before changing coordinator state, is rate limited,
and remains available while intake is disabled so incidents can be recovered under
the kill switch.

## Guarded repair dispatcher

The CLI is read-only and dry-run by default:

```bash
npm run repair:dispatch -- --issue ZK-123
```

Execution additionally requires all of the following:

- `REPAIR_DISPATCH_ENABLED=true`;
- `LINEAR_API_KEY`;
- comma-separated trusted Linear user IDs in `REPAIR_APPROVER_IDS`;
- `REPAIR_NEEDS_REPRO_LABEL_ID` and `REPAIR_NEEDS_HUMAN_LABEL_ID` (the repository
  defaults are used when the workflow labels have their documented IDs);
- Codex authentication (`CODEX_API_KEY` or the local Codex login), the repository's
  HTTPS Git credential, and authenticated GitHub CLI access;
- an active `golf-sim` issue with `Bug` and `autofix-ready`, the server fingerprint
  marker, nonempty Expected/Reproduction/Acceptance sections, a valid Linear branch
  name, and a `/autofix approve` comment from a configured human approver.

Run one issue explicitly before scheduling discovery:

```bash
REPAIR_DISPATCH_ENABLED=true npm run repair:dispatch:execute -- --issue ZK-123
```

The dispatcher checks `git ls-remote origin HEAD`, makes an isolated temporary
worktree, creates Linear's suggested branch, and pushes a unique empty claim commit.
That remote branch is the distributed concurrency claim; a losing scheduler run
stops. It then comments and moves the issue to In Progress. Codex receives only
bounded issue sections in a credential-scrubbed process, must reproduce first, add a
failing regression test before implementation, run focused checks, and commit. The
dispatcher independently runs build, lint, and unit gates, pushes, creates one draft
PR, comments evidence, and moves the issue to In Review. There is no merge, deploy,
Done, reporter-verification, branch deletion, or issue-deletion path.

### Cancel and recover

- To cancel an active attempt, add `/autofix cancel` as a Linear comment. The
  dispatcher checks the bounded recent comment set before Codex and before required
  gates.
- Claim and finish markers on the Linear issue are the bounded attempt history.
- To release a stale Linear claim after inspecting the branch and provider history,
  a maintainer comments
  `<!-- coursecraft-repair-cancel:v1 attempt=ATTEMPT-ID -->`, removes
  `autofix-ready`, and applies `needs-human-review`. Do not delete the remote branch;
  either resume it manually or supersede it with an explicitly reviewed issue.
- A reviewed stale claim may be resumed once by setting
  `REPAIR_RESUME_ISSUE=ZK-123`; the dispatcher starts from the existing remote
  branch and pushes a new unique claim commit. Without that exact opt-in, an
  existing branch is always treated as a concurrent/duplicate run.
- An ambiguous Linear/GitHub mutation, auth failure, dirty Codex result, failed gate,
  timeout, or missing PR URL stops and routes to human review. Automatic mutation
  retries are deliberately absent.
- Rotate credentials in their provider, update the Worker/scheduler secret, run
  dry-run plus staging certification, and only then re-enable the corresponding
  switch.

## Triage and repair review

Before applying `autofix-ready`, a human confirms the issue is reproducible, has an
objective acceptance test, belongs to this repository, and is not security/privacy,
save-corruption, destructive-migration, ambiguous-design, or expanded-scope work.
The approver adds `/autofix approve` as a separate comment.

Before merging a draft repair, a human checks the failing-then-passing regression
test, scope diff, required check evidence, provider links, migration/save
compatibility, and absence of credentials or private evidence. After a separate
deployment, a reporter/designated playtester verifies the fix and applies
`reporter-verified`; only then may a human close the Linear issue.
