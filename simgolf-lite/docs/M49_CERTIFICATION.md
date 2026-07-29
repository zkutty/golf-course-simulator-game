# M49 Certification Record

Status: **SHIP — M49 scope**

Certification snapshot: `5c23b5717a00e81000747b18a5bacf34a8054782` plus the uncommitted M49 working-tree changes. The repository already contained unrelated working-tree changes; this record does not claim those changes.

## Fixture and metrics

The deterministic fixture is `m49-cert-course`, a nine-hole course with a safe route, a central hazard decision, and a visible green. Seed: `490497`.

| Measure | Result |
| --- | ---: |
| Live days | 7 |
| Live rounds | 168 |
| Observed rounds retained | 168 |
| Completed observed rounds | 129 |
| Audience segments | 6 |
| Supported segments | 6 |
| Demand plan hash | `19202bb7` |
| Active live-save size | 2,688,506 bytes |

## Release checks

All 10 M49 checks passed:

- demand determinism and differentiated segment price response;
- safe-route versus shared-hazard demand response;
- unsupported marketing costs more and starts with lower credibility;
- live rounds become bounded observed evidence;
- no-play and incomplete rounds cannot create reputation;
- histories remain isolated by course/layout;
- active live evidence survives save/reload deterministically;
- management reporting reconciles revenue and authoritative condition;
- low condition creates a prioritized, deduplicated alert.

The machine-readable result is [artifacts/m49/certification.json](/Users/zbkutlow/golf-course-simulator-game/simgolf-lite/artifacts/m49/certification.json).

## Verification commands

- `npm run test:cert:m49` — passed.
- `npm test -- --run` with M49, live, persistence, weekly ledger, pace, tournaments, qualification, and seasons suites — 69 tests passed.
- `bunx tsc -b --pretty false` — passed.
- `npm run lint` — passed with 11 existing React hook warnings and no errors; i18n guards passed.
- `npx vite build` — passed; only the existing dynamic-import and chunk-size warnings remain.

## Player-facing evidence

The week-close report keeps the ordinary weekly flow unchanged and places the M49 management view behind an advanced disclosure. It labels predicted versus observed evidence, shows segment appeal/pay/evidence, surfaces condition and maintenance pressure, and lists actionable alerts and observed causes. All new player-facing strings are localized and pseudo-locale guarded.

No new protected art, audio, characters, names, or interface treatment were introduced. The report uses the existing CourseCraft visual language and current localization primitives.

## Unresolved risks

- This pass did not run a moderated unfamiliar-player session or add a dedicated M49 browser screenshot artifact. The core interaction is intentionally compact, but a manual browser review remains useful before a public release.
- The existing 11 React hook lint warnings and existing Vite bundle-size warnings remain outside M49 scope.
- Full desktop/PWA/performance matrices remain repository-level release checks rather than M49-specific gates.

## Decision

M49 is certified for merge as implemented: ZK-494, ZK-495, ZK-496, and ZK-497 are complete in order. The unresolved items above are release-process follow-ups, not failures of the M49 evidence, identity, reporting, persistence, or certification gates.
