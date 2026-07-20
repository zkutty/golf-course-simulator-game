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

## 2026-07-20 — M15 implementation in progress

- Linear scope resolved as ZK-170 through ZK-173 and all four issues moved to In Progress.
- Replaced separate/direct audio paths with one mixer-owned music, SFX, and ambience system; added persistent master mute and background-tab fading controls.
- Added contextual dual-slot music crossfades, session position memory, sting ducking, seven original lazy-loaded OGG+M4A tracks, a deterministic generator, and CC0 credits.
- Added procedural golf/UI SFX with throttling, pitch variance, eight-voice cap, distance attenuation, game-speed density caps, and live shot/landing/hole-out event derivation.
- Added camera- and terrain-aware ambience layers with time-of-day and pause coupling, plus channel test controls and a development playlist override.

## M15 remaining

- None. M15 acceptance implementation and verification are complete.

## M15 verification

- Unit suite: 31 files and 248 tests passing, including focused context, ambience, attenuation, playlist-format, and live-event sequencing coverage.
- Production build passes; lint passes with nine pre-existing React hook warnings and no errors.
- Full Playwright regression suite: 8 tests passing. M15 coverage proves no soundtrack fetch on cold load, one lazy track after the first gesture, mixer persistence/test controls, gameplay entry, and zero console errors.
- Bundled web-game client passed with deterministic `advanceTime`, captured `render_game_to_text` state, and a headed Pixi/WebGL visual pass after the expected black headless canvas capture.
- Audio options and gameplay were visually inspected; mixer rows/test controls fit cleanly and the course/tutorial render remained intact.

## 2026-07-20 — M12 completion pass

- Implemented the north-up isometric overview minimap with debounced terrain/elevation/water regeneration, 3 Hz mood-coded golfer dots, live viewport/bearing telemetry, collapsible corner docking, and click-to-jump navigation.
- Reused the iso snapshot renderer for hole-inspector and hole-list thumbnails; fixed 1280×720 minimap/control overlap and inspector flex shrink during visual QA.
- Applied early-2000s wood/brass/paper/felt chrome across gameui, HUD, hole inspector, live controls, and Options; added pressed states, clipboard tabs, odometer treatment, and tool cursors without changing component APIs.
- Removed `CanvasCourse.tsx`, renderer selection/profile state, legacy camera transforms, and all production renderer branches. Bundle JS fell by roughly 34 KB minified before gzip.
- Added `docs/M12_RENDERER_PARITY.md`, a reproducible `?perfFixture=1` dressed 18-hole/540-prop/100-golfer fixture, a deterministic perf smoke, minimap math coverage, and M12 Playwright acceptance coverage.
- Verification: 60 fps / 17.1 ms headless p95 with 100 golfers and 763 visible objects, 0.23 ms renderer work; M12 E2E passed at 1280×720 and 2560×1440; bundled web-game client passed and its state/screenshot output was inspected.

## M12 remaining

- None.

## 2026-07-20 — M17 retention, stats, and release readiness

- Original request: “Inplement m17 milestone from linear”.
- Implemented persistent schema-v4 course history and records, per-hole aggregates, course records, downsampled long-run charts, and a capped Hall of Fame.
- Added a data-driven 25-achievement registry (including five hidden achievements), permanent profile unlocks, queued toast notifications, and a complete gallery.
- Added a shared retention event bus powering the news ticker/feed, with duplicate merging, cooldowns, caps, filters, click-to-jump, and moment-camera behavior.
- Added photo mode with chrome-free rendering controls, guarded high-resolution capture, downloadable/shareable course cards, and reliable simulation/camera restoration.
- Added CourseCraft PWA metadata and icons, injected hashed precache assets, offline navigation/runtime audio policies, install/update UI, persistent-storage handling, and an offline save-persistence smoke test.

## M17 verification

- Unit suite: 34 files and 254 tests passing, including focused retention, migration, record, event, and achievement coverage.
- Production build passes and injects 18 offline assets; PWA smoke passes controlled install, offline reload, and local-save persistence.
- Full Playwright regression suite: 17 tests passing, including M17 records, achievements, photo capture/restoration, and manifest coverage.
- Lint and i18n guards pass with no errors. The bundled web-game client completed; full-page browser screenshots of records, achievements, photo mode, and gameplay were visually inspected.

## M17 remaining

- None.
