# M47 Distinct Golfers, Strategic Decisions & Reactions Certification

Date: 2026-07-28
Decision: **PASS — ZK-485 CERTIFIED; ZK-486 UNBLOCKED**

## Certification base and environment

- Repository: `/Users/zbkutlow/golf-course-simulator-game`
- Branch: `develop`
- Certification base commit: `59b918b3110f7760238a42105a2cb613be9655f9` (`Stabilize tournament CI timeout`)
- M47 dependency implementation commit: `139c947` (`Implement M47 live golfer contracts (ZK-485)`)
- Package: `simgolf-lite@1.0.0-rc.3`
- Node: `v25.8.2`
- npm: `11.11.1`
- Platform: macOS Darwin 25.5.0, arm64
- The worktree was already dirty before certification began. Existing user changes were preserved; this report does not clean, reset, or overwrite them.

## Dependency preflight

ZK-480 through ZK-484 are implemented on the certification base and have focused coverage. The M47 certification slice adds release-scale fixtures and evidence without recreating those dependency contracts.

| Dependency | Certified contract | Evidence |
| --- | --- | --- |
| ZK-480 | Seeded, bounded multidimensional golfer capabilities and identity persistence | `src/game/live/m47Types.ts`, `capabilities.ts`, v4 snapshot migration |
| ZK-481 | Five bounded strategic candidates, deterministic choice, rejected alternatives, and causal facts | `src/game/live/strategicOptions.ts` |
| ZK-482 | Shared-physics execution with landing/rest/lie/penalty outcomes and walking evidence | `src/game/live/livePhysics.ts`, `m47Round.ts` |
| ZK-483 | Per-hole expected-vs-actual reaction deltas, thoughts, memories, and return evidence | `src/game/live/reactions.ts` |
| ZK-484 | Localized, accessible Golfer Inspector explanation surface | `src/ui/GolferInspector.tsx`, `e2e/m47-certification.e2e.ts` |

## Fixtures and deterministic evidence

The fixture and report sources are:

- `src/game/testing/m47Certification.ts` — ten stable reference identities, 9/18/36-hole estates, tournament course, and strategy-matrix course.
- `src/game/testing/m47Certification.test.ts` — deterministic round, matrix, save/reload, and tournament assertions.
- `src/game/testing/m47CertificationCli.ts` — reproducible JSON report writer.
- `artifacts/m47/certification.json` — generated hashes and counts.
- `src/utils/stateHash.ts` — canonical order-independent plan/outcome/save hashing.

Reference identities: power, accuracy, irons, short-game, recovery, consistency, aggressive, conservative, casual, and balanced. Each strategy-matrix row evaluates all five candidates: safe, hero, positional, recovery, and approach, retains three rejected alternatives, and records expected score, hazard risk, strengths, and risk style.

| Fixture | Deterministic plan hash | Outcome hash | Reaction hash | Save hash | Plans | Outcomes | Reactions |
| ---: | --- | --- | --- | --- | ---: | ---: | ---: |
| 9 holes | `d586c6a9` | `d6212e74` | `2ad3dcf6` | `35de7eed` | 9 | 81 | 9 |
| 18 holes | `a2b4fb8e` | `e20c6be6` | `3f1a1305` | `4bc46a86` | 18 | 162 | 18 |
| 36 holes | `fb0b07e6` | `3bb529f9` | `065527ec` | `6ef88db9` | 36 | 240 bounded | 36 |

The 36-hole outcome stream is intentionally bounded by the persistence contract (`M47_MAX_OUTCOMES = 240`); the per-hole reaction and score evidence remains complete. Repeating each fixed-seed run produced identical hashes.

Strategy matrix evidence:

- 10 reference golfers and 10 rows.
- Risk styles observed: aggressive, balanced, and conservative.
- Chosen intents: positional 2, recovery 8.
- Rejected alternatives contain all five canonical intent kinds across the matrix.
- Every row has finite expected score and hazard risk and at least three rejected alternatives.

Tournament evidence: 12-golfer field, 12/12 rounds finished, 61 deterministic day steps, all golfers finished, tournament status `completed`, winner `Avery H.`.

Save/reload evidence: snapshot JSON round-trip restored successfully; before/after save hash `a477c6cc`; save payload 241,001 bytes; restored golfer evidence retained 9 plans, 81 outcomes, and 9 reactions.

## Verification gates

| Command | Result |
| --- | --- |
| `npm run test:cert:m47` | **PASS** — deterministic JSON report, 9/18/36 fixtures, strategy matrix, save/reload, and tournament |
| `npm run test:soak` | **PASS** — 30 weeks, 3,854 rounds, 3.02 MiB post-GC retained heap growth, state hash `f43a8feb`, 174,096 ms |
| `npm test` | **PASS** — 93 files, 792 passed, 1 skipped |
| `npx tsc -b --pretty false` | **PASS** |
| `npm run lint` | **PASS** — 0 errors; 11 pre-existing React Hook/ref warnings; i18n guards passed |
| `npm run build` | **PASS** — production bundle, audio manifest, service-worker injection, and M35 asset audit |
| `npm run test:fuzz` | **PASS** — 3 reducer fuzz tests |
| `npm run test:balance` | **PASS** — 81 runs across 3 themes × 3 property sizes × 3 difficulties × 3 strategies; finite state and no normal-path bankruptcy |
| `npm run test:perf` | **PASS** — 0.38 ms renderer tick work ≤ 8 ms; 831 ms cold startup; 5.16 s 36-hole fixture load; headless frame p95 reported but not asserted |
| `npm run test:pwa` | **PASS** — strict CSP, scoped service worker, offline reload, local-save persistence, and Parkland asset budget |
| `npm run test:e2e -- e2e/m47-certification.e2e.ts` | **PASS** — Inspector evidence, follow toggle, keyboard focus, pseudo locale, 130% text, reduced motion, color-vision, terrain-pattern, responsive bounds, and no page/console errors |
| `npm run test:release:browsers` | **PASS** — 6/6: M28 and M47 on Chrome, Firefox, and WebKit |

## Inspector review

The M47 browser fixture is `/?m47Fixture=1`. The test captures and visually inspects:

- `artifacts/m47/inspector-desktop.png` at 1440×900: Inspector evidence, live controls, course surface, and surrounding HUD remain readable without clipping.
- `artifacts/m47/inspector-mobile.png` at 390×844: Inspector stays within the viewport and document scroll width remains ≤390px.

The browser gate also verifies the localized pseudo-locale path after reload with `data-reduced-motion="true"`, `data-color-vision="deuteranopia"`, `data-terrain-patterns="true"`, 130% root text size, follow-button keyboard focus, and an empty page/console error list.

## M48 handoff contract

ZK-486 can consume the persisted M47 evidence through the stable live snapshot fields: `capabilities`, `holePlans`, `shotOutcomes`, `holeReactions`, and completed-round evidence references. Migration normalizes malformed or legacy values and applies bounded limits of 36 plans, 240 outcomes, and 36 reactions. Strategic rows expose golfer identity, strengths, risk style, selected intent, rejected alternatives, expected score, hazard risk, facts, and reaction evidence for cohort-level evaluation.

## Final decision

All requested certification fixtures and verification gates pass. ZK-485 is marked **Done**, and its blocking relation is removed from ZK-486. No remaining M47 certification blockers are known.
