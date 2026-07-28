# M47 Distinct Golfers, Strategic Decisions & Reactions Certification

Date: 2026-07-28
Decision: **IMPLEMENTATION IN PROGRESS — CERTIFICATION HOLD**

## Certification base and environment

- Repository: `/Users/zbkutlow/golf-course-simulator-game`
- Branch: `develop`
- Base commit: `1dbf9b5a0b38f5052b5c4395cdba3e1007c16301` (`Fix browser Array.at compatibility (ZK-533)`)
- Package: `simgolf-lite@1.0.0-rc.3`
- Node: `v25.8.2`
- npm: `11.11.1`
- Platform: macOS Darwin 25.5.0, arm64
- The worktree was already dirty before certification began. Existing user changes were preserved; this report does not clean, reset, or overwrite them.

## Mandatory preflight

ZK-485 requires certification to stop when ZK-480 through ZK-484 are marked Done in Linear but their implementations are absent from the task base. The initial preflight found that condition. Per the follow-up implementation direction, the missing contracts are now being integrated on `develop`; this document remains a certification HOLD until the full M47 matrix is rerun.

The local branch list contains `develop`, `main`, and older unrelated task branches, but no ZK-480–ZK-485 branches. `git log --all --grep='ZK-48\|M47'` contains no implementation commits for these issues. A live `git ls-remote --heads origin` check found two additional Claude refs; both were fetched and inspected (`claude/linear-handoff-completion-phzqf2` and `claude/linear-issues-fixes-7n69r4`). Neither contains ZK-480–ZK-484 implementation files or M47 commits. The implementation below therefore starts from the task base rather than cherry-picking another branch.

| Dependency | Required integration | Evidence on current base | Result |
| --- | --- | --- | --- |
| ZK-480 | Stable multidimensional `GolferCapabilities`, seeded bounded distributions, identity persistence, and live snapshot migration | `src/game/live/m47Types.ts`, `capabilities.ts`, `types.ts`, and snapshot v4 migration provide bounded capabilities, stable seeding, and save/load fallback normalization | **Implemented — focused coverage; certification pending** |
| ZK-481 | Bounded strategic candidates for safe, hero, positional, recovery, and approach intents, with deterministic choice, rejected alternatives, and explanation facts | `src/game/live/strategicOptions.ts` generates all five intents, selects deterministically, and records rejected alternatives/facts | **Implemented — focused coverage; certification pending** |
| ZK-482 | Live execution through shared physics, stored landing/rest/penalty outcomes, and outcome-derived walking/pace/evidence | `src/game/live/livePhysics.ts` delegates to `resolvePlayableShot`; `m47Round.ts` stores outcomes and builds flight/walk segments; completed rounds retain evidence | **Implemented — focused coverage; certification pending** |
| ZK-483 | Per-hole expectation, evidence-based reaction deltas, causal thought facts, bounded memories, and personal return/reputation evidence | `src/game/live/reactions.ts` evaluates expected-vs-actual outcomes and feeds per-hole mood/thought plus aggregate return/reputation classification | **Implemented — focused coverage; certification pending** |
| ZK-484 | Golfer Inspector capability strengths, selected intent, rejected alternative, outcome causes, reaction, evidence jump, and accessible localized equivalents | `src/ui/GolferInspector.tsx` now surfaces capabilities, chosen/rejected plans, facts, and reactions with catalog-backed labels | **Implemented — focused coverage; certification pending** |

Per the issue failure policy, these feature implementations must land or be integrated before this ticket adds certification coverage. Recreating them inside ZK-485 would violate the scope and make the certification meaningless.

## Baseline checks completed

These checks establish repository health only; they are not M47 certification evidence.

| Command | Result |
| --- | --- |
| `npm test` | **PASS** — 89 files, 554 passed, 1 intentional skip |
| `npm run lint` | **PASS** — 0 errors; 11 existing React Hook warnings; i18n extraction/content guards passed |
| `npm run build` | **PASS** — TypeScript, Vite bundle, exact audio manifest, service-worker injection, and M35 asset audit passed; existing Vite chunk-size/dynamic-import warnings remain |
| `git diff --check` | **PASS** |

## Current implementation verification

These checks were run after integrating the dependency contracts. They prove
the implementation is wired into the repository, but do not replace the
release-scale certification matrix below.

| Command | Result |
| --- | --- |
| `npx vitest run src/game/live/m47.test.ts src/game/live/persistence.test.ts src/game/live/live.test.ts` | **PASS** — 3 files, 38 tests |
| `npm test` | **PASS** — 92 files, 786 passed, 1 skipped |
| `npx tsc -b --pretty false` | **PASS** |
| `npm run lint` | **PASS** — 0 errors; 11 existing React Hook warnings; i18n guards pass |
| `npm run build` | **PASS** — production bundle, audio manifest, service-worker injection, and M35 asset audit |
| `npm run test:fuzz` | **PASS** — 3 reducer fuzz tests |
| `npm run test:balance` | **PASS** — 81 runs across 3 themes × 3 property sizes × 3 difficulties × 3 strategies; no non-finite state and no normal-path bankruptcy |
| `npm run test:perf` | **PASS** — 100-golfer fixture; renderer tick work 0.37 ms ≤ 8 ms; 36-hole fixture load 5.27 s |
| `git diff --check` | **PASS** |

## M47 matrix status

The following release-scale checks remain pending for M47 certification:

```text
npm run test:soak
npm run test:e2e
npm run test:release:browsers
npm run test:pwa
```

A focused M47 reference-hole fixture and save/reload invariant coverage now
exist. The full reference-golfer matrix, canonical strategic-hole fixture,
9-hole/18-hole/tournament/36-hole certification fixtures, deterministic hash
report, long-save evidence report, accessibility matrix, and M47 visual
evidence path remain to be added. The current 100-golfer performance smoke is
not a sustained live-save/memory report. Existing M36–M45 artifacts do not
prove the M47 contracts and are intentionally not reused as evidence.

## Implementation slice now present

- `GolferCapabilities` are seeded from golfer identity, bounded, normalized on v4 snapshot restore, and mapped into the shared Player Pro skill model.
- Live planning evaluates safe, hero, positional, recovery, and approach candidates; the chosen intent, rejected alternatives, and causal facts are retained per hole.
- Live golfer execution now calls `resolvePlayableShot` and stores carry, roll, landing, rest, lie, penalty, seed, and outcome facts. Walking and pace segments follow the physical rest point.
- Per-hole reactions compare expected and actual scoring, capability fit, risk, condition, and outcome evidence; the existing aggregate return/promoter/detractor path consumes the resulting mood.
- The inspector exposes the new identity, plan, alternative, fact, and reaction surfaces with localized labels. Mid-round course edits preserve committed M47 evidence and replan only the unplayed tail.

## Required next pass

Certification must now add and run:

1. Reference golfers for power, accuracy, irons, short game, recovery, consistency, aggressive, conservative, casual, and balanced profiles.
2. Canonical holes exposing safe, hero, positional, recovery, and approach choices, plus ordinary 9-hole, 18-hole, tournament, and 36-hole estate fixtures.
3. Repeated fixed-seed runs that hash plans, physical outcomes, reactions, and persisted evidence byte-for-byte.
4. Save/reload and long-save checks covering committed shots, identities, reactions, groups, purchases, pace, scorecards, and bounded evidence.
5. Performance measurements for solver/tick cost, frame/runtime budgets, memory/save-size trends, and 100 live golfers.
6. Keyboard, screen-reader, color-vision, text-scaling, reduced-motion, pseudo-locale, responsive, and visual inspection evidence for Golfer Inspector explanations.
7. A stable M48 handoff contract describing the persisted capability, chosen intent, rejected alternatives, physical outcome, reaction facts, evidence references, and bounded migration behavior.

## Final decision and blockers

**HOLD.** ZK-485 remains open and must not be marked Done until the implementation slice passes the full matrix above. The feature contracts are no longer absent, but the release-scale fixtures, deterministic hash report, long-save/performance evidence, accessibility review, and M48 handoff still need to be run. ZK-486 is not unblocked because its M48 input contract cannot yet be certified from this branch.
