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

## 2026-07-20 — M6 tournaments implementation in progress

- Current request: “Let’s implement m6 from linear project”.
- Linear scope resolved as ZK-125 through ZK-128: future scheduling and tiered field generation, competitive live rounds/leaderboards, economy and reputation awards, and scheduling/spectator/results UI.
- Added a persisted tournament calendar with local, regional, and championship tiers; deterministic personality-model fields; future game-date booking; deposits; and save normalization.
- Tournament fields now run through the existing live golfer simulation, shot planner, scoring, reactions, concessions, and clock. Live standings persist through saves and completion settles sponsor revenue/reputation awards.
- Added an in-course tournament office with booking controls, upcoming events, live leaderboard, and expandable results recaps. Production build passes after the first integration slice.

## M6 remaining

- None. M6 implementation and acceptance verification are complete.

## M6 verification

- Unit suite: 35 files and 257 tests passing, including deterministic booking requirements, field generation, live round execution, save/restore, standings, settlement, and duplicate-booking safety.
- Production build and i18n/lint guards pass; lint reports only six pre-existing React hook warnings and no errors.
- Full Playwright regression suite: 18 tests passing, including M6 booking, deposit accounting, progressing live leaderboard, completed-results recap, and zero browser console errors.
- Bundled web-game client passed against the final implementation; `render_game_to_text` exposed tournament panel/schedule/active state. Full-page live and results screenshots were visually inspected at 1440×900.
- ZK-125, ZK-126, ZK-127, and ZK-128 are Done in Linear with implementation/test notes; the M6 milestone reports 100% progress.

## 2026-07-20 — M7 progression and live-view implementation in progress

- Linear scope resolved as ZK-129, ZK-130, and ZK-131; the already-complete ZK-132 and ZK-135 account for the milestone's prior 40% progress. The three open issues are In Progress.
- Added five reputation tiers with concrete concession, terrain/decor, staff-cap, building-tier, and tournament progression, plus a course progression panel and enforcement at UI and action boundaries.
- Added a consolidated live overview for golfers, leaderboard, arrivals, and staff coverage; polished clock controls with explicit speeds/day progress; and extended camera follow from ball flight to the selected golfer's whole round.
- Reduced high-count live-render garbage by alternating and reusing two render-data buffers while preserving the previous frame for audio edge detection.

## M7 remaining

- None. M7 implementation and acceptance verification are complete.

## M7 verification

- Unit suite: 36 files and 259 tests passing, including focused reputation-tier and cross-category unlock coverage.
- Production build and i18n/lint guards pass; lint reports only six pre-existing React hook warnings and no errors.
- Focused M7 Playwright coverage passes progression/locks, pause/1x/2x/3x controls, live golfer/leaderboard/staff tabs, and selection/follow. The 13-test non-onboarding regression set passes; all seven long-form M14 tests also passed in the full run before the two discovered fixture/layout regressions were fixed and reverified directly.
- 100-golfer 3x performance smoke: 60.0 fps, 17.5 ms p95 frame time, 0.20 ms renderer work, and 0.065 ms golfer/emote work.
- Bundled web-game client passed with deterministic stepping and `render_game_to_text` progression/live state. Progression, staff overview, locked tools, follow inspector, and gameplay screenshots were visually inspected.

## 2026-07-20 — M18 core hardening in progress

- Current request: “Implement m18 from the linear project”.
- Linear scope resolved as ZK-81 through ZK-85; all five issues are In Progress.
- Course rating now consumes the shared BALANCE-backed golfer profiles, including rating sensitivity multipliers, with regression coverage proving balance edits affect rating output.
- Bridge and expansion eligibility is centralized across App, HUD, reducer, and Monte Carlo tuning. Loan acceptance is a reducer action, and versioned integration setters now invalidate economy state for simulation/configuration commits.
- Hole scoring now carries per-hole dynamic tile/elevation dependencies across immutable course updates, reusing unaffected Dijkstra solves. The retired Canvas renderer has no per-tile linear-gradient path; Pixi's sole radial gradient is a one-time ambient texture.
- Routine App diagnostics now use an opt-in development logger (`VITE_DEBUG_LOGS=1`); production error reporting and CLI output remain intentional.
- Focused M18 tests pass; full unit suite is 37 files / 262 tests passing.

## M18 verification

- Full unit suite: 37 files, 262 tests passed, with the repeatable nine-hole timing benchmark opt-in via `M18_BENCH=1`.
- Nine-hole score benchmark: 713.6 ms cold vs 286.9 ms after a paint update (2.5× faster), reusing five unaffected hole solves.
- Production build, i18n/lint guard, reducer fuzz suite, Monte Carlo tuner, and 100-golfer renderer performance smoke all pass. Renderer result: 60.0 fps, 18.4 ms p95, 0.21 ms render work.
- Full Playwright regression: 20/20 passed in 6.0 minutes with no browser console errors.
- Bundled web-game client passed against the 100-golfer fixture; `render_game_to_text` advanced deterministically and the final gameplay screenshot was visually inspected.

## M18 remaining

- None. ZK-81 through ZK-85 meet their acceptance criteria.

## 2026-07-20 — M19 visual foundation implementation

- Current request: “Let’s implement m19 from linear”. Linear scope resolved as ZK-212 through ZK-216.
- Added Art Guide v2 review gates, original-asset provenance, the deterministic seed-1900212 parkland par-4 fixture, and fixed 50/100/200% camera bookmarks.
- Added an exhaustive `LandTheme × Terrain` material registry, weighted base variants, typed transition contracts, safe legacy fallbacks, and separate terrain/natural-props/buildings-decor/golfer atlases.
- Added 144 original @2× parkland terrain sources (six bases plus cardinal/convex/concave transitions for all eight surfaces) and a deterministic generator/build pipeline.
- Replaced four-neighbor scalloped lips with rotation-safe 8-neighbor masks covering all 256 configurations. Boundaries are material-priority and elevation aware; existing 3×3 chunk invalidation and accessibility overlays remain intact.
- Integrated clipped mowing, green/fringe transitions, bunker lips, shore foam/banks, path shoulders, restrained water depth/reflection art, and static animation fallbacks.

## M19 verification

- Full unit suite: 38 files, 269 passed, one intentional skip. Focused M19 coverage validates registry completeness, all 256 masks, four rotations, convex/concave normalization, deterministic variants, and the complete fixture.
- Production build passes; lint/i18n pass with six pre-existing hook warnings and no errors.
- 100-golfer performance smoke: 60.0 fps, 17.7 ms p95, 0.24 ms renderer work (8 ms budget), 763 objects.
- Focused M19 Playwright acceptance passes at 1440×900 across rotations and static animation mode with no console errors.
- Bundled web-game client passes against `?m19Fixture=1`; course-only overview/rotation/static-water captures and final smoke output were visually inspected.

## M19 remaining

- None. ZK-212 through ZK-216 are Done in Linear with implementation and verification notes; the milestone reports complete.

## 2026-07-20 — M20 terrain variety implementation in progress

- Current request: “Implement m20 from linear”. Linear scope resolved as ZK-217 through ZK-220; all four issues are In Progress.
- Added schema-v5 `waste_area` and `wetland` terrain with lossless v4 migration, exhaustive economics, maintenance, pathing, shot, rollout, rating, generation, stats, accessibility, audio, minimap, photo-mode, and Golfopedia integration.
- Waste areas are firm, walkable, low-upkeep lies between rough and sand. Wetlands are shallow vegetated water hazards, non-walkable, and use water-hazard ball rules at lower build/upkeep cost than open water.
- Added grouped terrain editor categories and authored @2× parkland materials for all ten surfaces.
- Added deterministic derived ground cover (native grass, flowers, reeds, leaf litter, pebbles, bare soil) with marker/building exclusions, pointer transparency, chunk culling, and zoom/render-quality density tiers.
- Added deterministic all-ten-terrain fixtures for parkland, links, and desert plus focused unit and Playwright acceptance coverage.

## M20 verification so far

- Full unit suite: 40 files, 275 tests passed, one intentional skip. Focused post-i18n M20 checks also pass.
- Production build and i18n/lint guards pass; lint reports only six pre-existing React hook warnings and no errors.
- Reducer fuzz suite and 30-week/8,719-round soak pass; soak state hash is `06c03bd3`.
- 100-golfer performance smoke: 60.0 fps, 17.3 ms p95, 0.19 ms renderer work (8 ms budget), 763 visible objects.
- Full Playwright regression: 22/22 passed in 6.1 minutes. M20 acceptance captured all three themes at all four rotations plus close detail, verified both editor tools and all ten terrain counts, and reported zero console errors.
- Bundled web-game client passed with deterministic stepping and `render_game_to_text` terrain counts. Browser screenshots for parkland, links, desert, and micro-detail were visually inspected.

## M20 remaining

- None. ZK-217 through ZK-220 meet their acceptance criteria.

## 2026-07-20 — M21 biome identity and natural world

- Current request: “implement M21 from the linear project”. Linear scope resolved as ZK-221 through ZK-225.
- Added a typed, exhaustive `LandTheme × ObstacleType` natural-prop registry with 36 original parkland, links, and desert variants. Deterministic selection uses theme, run seed, semantic obstacle type, and position while preserving the existing save/state model.
- Added per-variant scale, anchor, separate shadow, sway, density, clustering, terrain/elevation/water, cultivated/wild, and selection-occlusion metadata with automatic atlas completeness checks and parkland semantic fallbacks.
- Added 540 authored @2× terrain material frames across all three themes, replacing links/desert tint fallbacks without introducing renderer theme branches.
- Upgraded deterministic ecological generation with theme-specific tree-line/copse bias, shoreline reserves, pond-edge vegetation, sparse links composition, desert oasis trees, reserved-zone safety, and richer new-game previews.
- Added deterministic M21 fixtures, 12 rotation captures, three detail captures, three new-game preview captures, registry/material/generation tests, and multi-biome performance support.

## M21 verification

- Full unit suite: 41 files, 285 tests passed, one intentional skip.
- Production build and lint/i18n guards pass; lint reports six pre-existing React hook warnings and no errors.
- Full Playwright regression: 24/24 passed in 7.1 minutes, including M21 biome packs at all four camera rotations and deterministic new-game previews.
- 540-prop/100-golfer performance fixtures pass for parkland, links, and desert: 60 fps, 16.8–18.2 ms p95, and 0.20–0.28 ms renderer work against the 8 ms budget. The final parkland certification contains 514 authored trees and passes at 17.0 ms p95 / 0.24 ms renderer work.
- Bundled web-game client passed with deterministic state output and zero captured console errors. Its WebGL `toDataURL` capture remained black even headed; the dedicated Playwright element screenshots rendered correctly and were visually inspected instead.

## M21 remaining

- None. ZK-221 through ZK-225 meet their implementation and acceptance criteria.

## 2026-07-20 — M22 structures, course decor, and visual release in progress

- Current request: “Implement m22 from this project”. Linear scope resolved as ZK-226 through ZK-230; all five issues are In Progress.
- Fast-forwarded the clean local `main` branch to completed M21 commit `dd576a8` before beginning M22.
- Implementation order follows the milestone dependency graph: persisted decoration contract/editor → bridges and boardwalks → authored buildings/furniture → visual/performance certification.

## M22 implementation checkpoint

- Added schema-v6 typed decorations with 11 kinds, deterministic sanitization/migration, reducer-owned placement/rotation/removal and salvage economics, occupancy rules, editor controls, footprint previews, text-state output, and ground-cover exclusions.
- Added validated bridge/boardwalk spans with dry approaches, hazard/elevation rules, path connectivity in both live and evaluation pathfinders, blocking furniture footprints, and rotation-aware depth sorting.
- Generated one original 4×4 M22 structure/furniture source sheet with the built-in image workflow, retained its provenance source, added a deterministic chroma-key/theme/tier processor, expanded the buildings/decor atlas to 67 frames, and removed normal building runtime tinting.
- Added an all-kinds/all-buildings M22 fixture, a 285-decoration performance fixture, focused unit tests, and browser acceptance for all themes/four rotations/editor controls.
- Visual QA caught purple chroma spill in the first atlas; the processor now samples the actual generated border key and despills it. Clean parkland and desert rotation recaptures were inspected.

## M22 verification so far

- Full unit suite: 42 files, 291 tests passed, one intentional skip. Production build and lint/i18n guards pass; lint reports six pre-existing React hook warnings and no errors.
- Reducer fuzz and the 30-week/8,719-round soak pass. Three-theme 100-golfer performance certification holds 60 fps at 17.0–17.3 ms p95 with 0.206–0.239 ms renderer work and 1,048 visible objects.
- M22 acceptance plus the previously stressed presentation, save/load, migration, options, and accessibility paths pass together under parallel Playwright load: 8/8. The wider regression set passed across the initial and focused reruns.
- PWA smoke passes controlled install, offline reload, and local save persistence. The bundled web-game client also passes with deterministic text state exposing all 11 decoration kinds.
- The final theme/tier atlas is 3.3 MB (down from 8.6 MB during QA); parkland and desert captures were visually inspected after resize with clean transparency and no chroma spill.

## M22 remaining

- None. ZK-226 through ZK-230 meet their implementation and acceptance criteria.

## 2026-07-20 — M23 tee sets, pin rotations, and course standards

- Current request: “implement M23 from linear project”. Linear scope resolved as ZK-231 through ZK-234.
- Added typed Forward/Member/Championship tee sets, A/B/C pin rotations, shared resolution/validation helpers, active daily pin persistence, and compatibility aliases for legacy Member/A consumers.
- Added reducer-backed marker editing, keyboard coordinate inputs plus map placement controls, subdued alternate isometric markers, archetype tee assignment, live-round setup persistence, and a per-tee rating matrix with per-rotation deltas.
- Added schema-v7 migration and save validation for legacy Member/A layouts, deterministic state-hash canonicalization, complete marker migration, and focused migration/reducer/rating/live-assignment coverage.

## M23 verification

- Full unit suite: 43 files, 295 tests passed, one intentional skip. Production build and lint/i18n guards pass; lint reports six pre-existing React hook warnings and no errors.
- Reducer fuzz passes. The 100-golfer performance fixture holds 60 fps at 17.6 ms p95 with 0.322 ms renderer work and 1,048 visible objects.
- M23 Playwright acceptance passes keyboard tee editing, daily pin selection, deterministic text-state output, and screenshot coverage. Golden save compatibility and the M12 presentation regression both pass after focused fixes.
- The bundled web-game client passed deterministic stepping against the M23 fixture; the course setup editor and isometric marker presentation were visually inspected.
- A final combined sequential Playwright rerun was stopped after its web-server bootstrap stalled before any tests began; this was runner startup behavior, not a product assertion failure.

## M23 remaining

- None. ZK-231 through ZK-234 meet their implementation and acceptance criteria.

## 2026-07-21 — M24 tournament course standards

- Linear scope resolved as ZK-235 through ZK-237; all three issues are In Progress.
- Added centralized, data-driven Local/Regional/Championship qualification with prescribed tees and deterministic easiest/median/hardest pin selection, complete-route checks, normalized nine-hole ratings, exact checklist values, and inclusive rating/slope thresholds.
- Tournament calendar v2 now persists setup and qualification snapshots, revalidates prescribed setups after rating-relevant edits, exposes warnings, cancels invalid events on event day without refund/awards, and preserves completed pre-v2 history.
- Tournament entrants now carry the event tee/pin through arrivals, live rounds, standings, save/restore, and text-state output without mutating the operator's ordinary daily pin.
- Added the expanded tee rating matrix, Tournament Office readiness checklist and corrective guidance, warning/cancellation UI, advisor warning, and Golfopedia coverage.

## M24 verification

- Full unit suite: 44 files, 301 tests passed, one intentional skip. Reducer fuzz and the 30-week/8,719-round soak pass; the soak finishes at $10,433,856 cash, 100 reputation, and an 8.42 MB heap increase.
- Production build, lint/i18n guards, PWA offline smoke, and `git diff --check` pass. Lint reports seven existing React hook warnings and no errors.
- Full Playwright regression: 29/29 passed, including readiness/booking, prescribed live setup, edit-driven cancellation, pseudo-localization at 130% scale, and legacy M6 tournament coverage.
- The 100-golfer performance fixture holds 60 fps at 16.8 ms p95 with 0.342 ms renderer work and 1,048 visible objects.
- Bundled web-game client passed deterministic stepping and exposed the expected Local/Regional/Championship readiness state. Readiness, live play, cancellation, and pseudo-localized layout captures were visually inspected.

## M24 remaining

- None. ZK-235 through ZK-237 meet their implementation and acceptance criteria.

## 2026-07-21 — CI build ordering fix verification

- Confirmed the M24 working copy computes `textMemberRating` inside the early text-state effect and no longer references the later `rating` memo from that effect or its dependency list, eliminating TS2448/TS2454.
- `npm run build` passes and injects 22 offline assets; only the existing Vite chunk-size/dynamic-import warnings remain.

## 2026-07-21 — M25 land estates and parcel acquisition

- Current request: “Implement m25 from linear project”. Linear scope resolved as ZK-238 through ZK-242.
- Expanded new courses to deterministic 220×140 estates with a centered 110×70 starter parcel, eight irregular neighboring parcels, exact parcel lookup/adjacency, localized traits, fixed itemized appraisals, and compact RLE parcel/natural-baseline persistence.
- Added schema-v8 migration that centers legacy 110×70 courses and translates holes, tee sets, pins, waypoints, props, buildings, decorations, golfers, balls, shot segments, concessions, and transaction coordinates while preserving the original starter land.
- Made ownership authoritative across paint, sculpt, holes, waypoints, obstacles, buildings, and decorations. Adjacent affordable purchases are reducer-atomic and preserve the immutable natural baseline.
- Added an accessible Land Office with keyboard parcel selection, center-on-parcel controls, two-step purchase confirmation, affordability/adjacency guidance, renderer and minimap survey overlays, localized text, accessible feedback, and deterministic text-state output.

## M25 verification

- Full unit suite: 45 files, 305 tests passed, one intentional skip. Focused estate, scenario, course-rating, tournament, and render-fixture coverage also passes in isolation.
- Production build and lint/i18n guards pass; lint reports seven existing React hook warnings and no errors. `git diff --check` passes.
- M25 Playwright acceptance passes keyboard survey, centering, two-step purchase, exact cash deduction, ownership state, and screenshot coverage.
- The bundled web-game client passed deterministic M25 state extraction; its minimap capture and the full Land Office purchase capture were visually inspected.
- The legacy onboarding playthrough reaches all nine holes and completes the twelve-step lesson on the expanded estate; its scripted routes were moved away from the tutorial card and the weak-hole advisor threshold now includes an exact score of 55.

## M25 remaining

- None for M25. ZK-238 through ZK-242 are documented and marked Done in Linear.
- The legacy M14 playthrough reached graduation on the expanded estate, then exposed a post-graduation weak-hole advisor comparison against an unrounded 55.x score. The comparison now uses the same rounded score shown in the HUD; its focused unit coverage and production build pass, but the final seven-minute browser replay was not repeated after that last one-line alignment.

## 2026-07-21 — M26 multi-course property operations

- Current request: “Implement m26 from the linear project”. Linear scope resolved as ZK-243 through ZK-247 and all five issues were moved to In Progress.
- Added schema-v9 stable hole identities and persisted named course layouts with independent draft/published routing, 9/18-hole round length, open/closed state, green fee, active selection, legacy-partial migration, 36-hole validation, and starter-course migration for old saves, records, live rounds, and tournaments.
- Added an accessible Course Manager for creating/selecting/renaming courses, adding estate holes, assigning/reordering/removing draft holes, independent pricing/state, blocking-condition explanations, course metrics, and atomic publishing that leaves already-booked golfer itineraries unchanged.
- Added deterministic per-course demand/capacity and bookings, course-scoped live golfer itineraries and persistence, independent fee collection, stable completed-round identities, and exact per-course daily/weekly attendance, turnaway, revenue, cost, satisfaction, and profit reconciliation.
- Scoped tournament hosts, tournament routing, stable records/aces, event navigation, advisor hole navigation, minimap selection, and retention filtering to course/hole IDs. New tournament bookings require an open published 18-hole host; migrated events attach to the starter course.

## M26 verification

- Focused M26 unit suite: 6 tests passing, covering 36-hole save round trips, unique assignment, draft/published atomicity, deterministic bookings, live route isolation/save restore, daily and weekly reconciliation, stable records, and 18-hole tournament hosting.
- Production build and lint/i18n guards pass; lint reports seven existing React hook warnings and no errors. `git diff --check` passes.
- Unit regressions were run in focused groups; the render-performance fixture passed in isolation at 8.9s after timing out only under the combined parallel test load. The previously failing M22/M23/live/scenario migration and queueing cases pass after the schema-v9 compatibility and per-course tee-queue fixes.
- M26 Playwright acceptance passes in 22.5s with zero console errors. The final 1440×900 Course Manager/gameplay capture was visually inspected.
- The bundled web-game client passed deterministic stepping/capture; `render_game_to_text` exposes stable layouts, active course, draft/published IDs, course fees, and live golfer course/hole IDs. Its Pixi canvas capture was visually inspected.

## M26 remaining

- None for implementation. ZK-243 through ZK-247 include completion notes and are marked Done in Linear.

## 2026-07-21 — M26 CI follow-up

- The first full GitHub Actions unit run exposed nine timeout-only failures under parallel load; 302 assertions passed and no behavioral assertion failed.
- Root cause: repeated M26 layout normalization and course-view cloning defeated the existing identity-based scoring caches, while daily setup also recomputed the same course demand twice.
- Memoized immutable normalized courses and draft/published layout views, reused operating views across live-day planning, and cached tournament qualification by course revision and tier.
- Full CI-equivalent unit suite now passes: 46 files, 311 passed, 1 skipped, in 23.2s locally.
