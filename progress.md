Original prompt: Complete ZK-177 and ZK-178, clean the worktree, commit, and push.

Previous prompt: Let’s do m14 in linear for this project

## 2026-07-18 — M14 implementation

- Linear milestone resolved as “M14: Onboarding, Tutorial & Advisor” with ZK-167, ZK-168, and ZK-169; all moved to In Progress.
- Added a persisted, data-driven 12-step tutorial with coach marks, click blocking outside the target, skip/graduate flows, first-launch offer, and rerun from Help.
- Added one shared caddie presenter for tutorial and advisor messages, generated four portrait expressions, and added warning/info/celebration/hint priority rules, dedupe, cooldown, frequency settings, and hole navigation.
- Added delayed keyboard-focus tooltips and a searchable data-driven Golfopedia covering all terrain types, all golfer archetypes, management concepts, and controls.
- Added M14 unit coverage. Full suite: 220 tests passing. Production build passes. Lint has only pre-existing hook warnings after the M14 Fast Refresh issue was fixed.

## Verification

- Bundled web-game Playwright client passed against the local Vite server.
- Gameplay screenshot confirmed the tutorial spotlight, click-safe target, presenter layout, and caddie art.
- In-app browser verified Golfopedia navigation/search, live terrain economics, advisor frequency selection, responsive modal bounds, and zero console errors.
- Golfopedia header overflow found during visual QA and fixed before the final capture.

## Remaining

- ZK-167, ZK-168, and ZK-169 are Done in Linear. M14 implementation and acceptance verification are complete.

## ZK-169 completion pass

- Added one delegated tooltip surface across the playable UI: pointer tooltips share a 500 ms delay, keyboard focus opens them immediately, and stat readouts become keyboard-focusable.
- Extended contextual help across secondary controls, HUD/course metrics, weekly-report factors, live simulation stats, and golfer/hole inspectors.
- Added shared report/control copy and focused M14 tests for representative controls and every demand factor.

## 2026-07-19 — M16 completion pass

- Completed ZK-177 accessibility acceptance: color-vision-safe terrain palettes and patterns, reduced-motion behavior, 90/100/115/130% text scaling, focus-managed keyboard navigation, persisted remappable controls with conflict blocking, and live-region coverage.
- Completed ZK-178 localization scaffolding: typed English catalog, ICU-style parameters/plurals, pseudo locale and developer toggle, centralized number/currency/week formatting, extracted UI/tutorial/advisor/Golfopedia/scenario copy, and an AST-based hardcoded-string guard.
- Fixed a Pixi teardown race exposed by the keyboard-only save/load test by unregistering pointer handlers from the captured stage rather than a destroyed application stage.
- Documented the add-key/use-`t()` workflow and added pseudo-locale browser coverage.

## M16 verification

- Unit suite: 30 files and 243 tests passing.
- Production build passes; lint passes with 10 pre-existing React hook warnings and no errors.
- Seven focused M16 Playwright tests pass, including keyboard-only save/load/options/rebinding, all three color-vision palettes, persisted options, reduced motion, text scaling, and pseudo-locale persistence.
- Bundled web-game Playwright client completed against the local E2E build; gameplay/tutorial rendering was visually inspected with no browser console errors.

## 2026-07-19 — ZK-211 M14 unfamiliar-player acceptance pass

- Migrated the preserved M14 QA work onto isolated branch `codex/zk-211` based on pushed M16 commit `b9935f1`; the shared checkout remains clean and `stash@{0}` remains intact.
- Completed a fresh-storage production playthrough with visible controls, including a profitable nine-hole course, live golfers, weekly results, off-target input, Escape, a water-placement recovery, and screenshot evidence for every tutorial lesson. Two deterministic fresh-state Playwright completions also passed consecutively (2.0m and 2.1m); run B includes reload/resume and tutorial rerun.
- Fixed tutorial/pause stacking on Escape, recovery access for steep/invalid first-hole designs, mid-day arrival replanning after a course opens, contextual-tooltip focus/blur behavior, flyover Escape ordering, Golfopedia deep-link/focus handling, and tutorial/advisor/tooling coverage gaps.
- Added `e2e/m14-onboarding.e2e.ts` for complete tutorial, initial/mid/near-completion skip, reload/resume, rerun, advisor behavior, representative mouse/keyboard tooltips, Golfopedia deep links and all terrain/archetype entries, navigation/modals/Escape, and 1280x720, 1440x900, 2560x1440, 130% text, and reduced-motion passes.
- Final verification: production build passed; lint passed; unit suite passed; fresh run A passed; fresh run B passed; remaining five M14 E2E tests passed in 32.2s; bundled develop-web-game smoke client passed and its screenshot was inspected.
- Evidence lives under `simgolf-lite/artifacts/zk-211/` (54 Playwright screenshots, 15 production browser screenshots, plus final smoke-client screenshot). Failure-only trace/video/screenshot retention is configured in `playwright.config.ts`.
