# M51 Mobility & Rental Economics Certification

## Disposition

**Machine-only PASS; release-owner HOLD for deferred human checks.**

This packet covers the integrated M51 implementation through ZK-558. The exact promotion commit is recorded at release time; this report is intentionally prepared before that commit.

## Verified scope

- Shared M51 contracts, save migration, timed itineraries, weighted travel routing, rental products, fleet economics, group checkout/return, settlement, utilization, weekly history, and live mobility effects.
- Operations reporting, architecture mobility predictions, cart/pushcart render and inspector evidence, and M49 demand/value/course-identity integration.
- Deterministic walking-first, pushcart-oriented, and riding-cart-oriented fixtures; M47/M49 compatibility; 36-hole/100-golfer bounds; active snapshot restore; bounded history; and browser state/localization contracts.

## Exact machine evidence

| Command | Result |
| --- | --- |
| `npm run test:ci` | 118 files, 930 passed, 1 skipped; audio audit 3/3 |
| `npm run test:fuzz` | 3/3 passed |
| `npm run test:soak` | 30 weeks, 4,258 rounds, 5.84 MiB post-GC retained heap growth |
| `npm run test:balance` | 81/81 matrix rows; 0 normal-path and 0 poor-management bankruptcies |
| `npm run test:perf` | 100 golfers; 0.37 ms renderer work; 1,013 ms cold startup; 3,867 ms fixture load |
| `npm run test:pwa` | strict-CSP render, install scope, offline reload, and local-save persistence passed |
| `npm run test:cert:m47` | deterministic 9/18/36-hole rounds, save reload, and tournament certification passed |
| `npm run test:cert:m49` | 10/10 demand, observed evidence, migration, reporting, and identity checks passed |
| `npx playwright test e2e/m12-presentation.e2e.ts --reporter=line` | passed |
| `npx playwright test e2e/m51-certification.e2e.ts --reporter=line` | passed |
| `npx vitest run src/game/testing/renderPerfFixture.test.ts src/game/testing/m51Certification.test.ts --reporter=dot` | 7/7 passed |
| `npx tsc -b --pretty false` | passed |
| `npm run lint` | 0 errors; 12 existing hook warnings |
| `npm run build` | passed; audio, offline, M35, and Parkland audits passed |
| `git diff --check` | passed |

## Known limitations and deferred gates

The following remain intentionally open for the later human-confirmation round: visual inspection, accessibility review with assistive technology and physical text scaling, listening/audio review, gameplay balance judgment, physical-device/GPU checks, provider checks, full supported-browser/desktop review, and release-owner sign-off. Human-gated Linear issues remain open; no mocked or stale screenshot evidence is used to mark them complete.

## Machine fixes included in this packet

- Aligned the perf fixture template with its small synthetic course so 100-golfer snapshot serialization remains bounded after M51 itinerary expansion.
- Added regression coverage for the 100-golfer snapshot/restore boundary.
- Added the Mobility Architecture Review selector and localized M51 operations/inspector copy with machine coverage.
