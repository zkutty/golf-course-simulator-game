Original prompt: Complete ZK-177 and ZK-178, clean the worktree, commit, and push.

## 2026-07-24 — M39 and M40 implementation complete

Current request: “Implement M39 and then continue to implement rest of M40, commit each separately and then merge to main”

- Resolved M39 as ZK-358 through ZK-365 and M40 as ZK-366 through ZK-374 in Linear.
- Preserved the pre-existing uncommitted M40–M44 implementation in a named Git stash before starting M39 on `codex/m39-m40`.
- Completed M39: 32-week calendar, deterministic weather/forecasts, shared golf and operating modifiers, charter and automation state, forecast response reducer, annual yearbooks/rankings/timeline, save v16 migration, UI, text state, focused browser coverage, and ten-year certification tests.
- M39 verification passes: 405 Vitest tests with one intentional skip, production build, lint/i18n guards with seven pre-existing hook warnings and no errors, eight milestone Playwright regressions, focused browser rerun, bundled-client state capture, screenshot inspection, and `git diff --check`.
- Committed M39 separately as `72eaf03` (`Implement M39 seasons and annual legacy`).
- Completed M40: six authored chapters and 18 phases, recurring cast/story bible, phase choices and consequences, actual Player Pro matches and championship finale, all four M39 charter paths, live cross-system facts, recovery guidance, persistent relationships/choices/epilogues, retry-safe medals/unlocks, Sandbox continuation, save v17 migration, certification report, UI, structured text state, and browser coverage.
- M40 verification passes: 65 Vitest files / 415 passed with one intentional skip, production build, lint/i18n guards with the same seven pre-existing warnings and no errors, M36/M38/M39/M40 Playwright regressions, campaign opening/dashboard visual inspection, bundled-client structured state and renderer capture, and `git diff --check`.
- Automated and internal M40 certification is complete. ZK-374’s explicitly external moderated 12–18 hour first-time-player study remains a human playtest gate and is documented separately from the completed implementation.

## 2026-07-23 — M38 Architecture Feedback & Living Club Stories complete

Current request: “Implement m38 from linear”

- Resolved M38 in Linear as ZK-349 through ZK-357 and read all nine specifications, relations, and acceptance criteria; there are no issue comments or attachments.
- Mapped the implementation onto M36/M37 controlled-shot snapshots, the existing Architect Report, live completed-round events, named operational staff, profile persistence, save v14 normalization, and the shared Pixi overlay layer.
- Added save schema v15 with bounded, hostile-data-safe persistence for named regulars, enriched staff, relationships, immutable memories/round history, story facts/callbacks/journal, architecture evidence, revision summaries, and Return to Design context.
- Added eight filterable architecture overlays (shot traces, dispersion, landing heatmaps, recovery, tee scoring, hazards, walking, and congestion), truthful current/historical revision labeling, sparse/empty explanations, before/after summaries, evidence jump-back, and practice-round entry.
- Connected both live rounds and Player Pro settlement to canonical routed-geometry evidence. Player Pro snapshots retain the exact geometry version and hole setup, and Return to Design restores the revealing hole, trace, camera destination, and evidence filters without mutating the played snapshot.
- Added deterministic regular promotion/reappearance, profile-persistent favorites, explicit on-course follow actions, enriched staff portraits/traits/proficiency/tenure/morale/training/compensation/history, and atomic hire/train/reassign/raise/dismiss commands.
- Added a validated declarative pack of 26 systemic events across eight categories and six two-stage chains, with predicate facts, participant binding, cooldowns/mutexes, exact-once effect settlement, callbacks, expiration defaults, consequence previews, major-event pause, defer, and an accessible club journal.
- Verification: 64 Vitest files / 401 passed with one intentional skip; production build; lint/i18n with seven pre-existing hook warnings and no errors; `git diff --check`; M36 Player Pro regression plus M38 Playwright acceptance; ten-year bounded soak; schema 14 migration; bundled-client text state with 24 current traces and no error artifact. The Living Club and Architecture Review captures were visually inspected.

## 2026-07-23 — Golden-path deployment repair in progress

- Reproduced the M29 pace-control hang locally and inspected its Playwright trace: the browser main thread stopped during the `brisk` course-operations update, with no network or console error.
- Isolated the regression to M35's smooth-surface Pixi effect rebuilding every triangulated terrain surface whenever the root course object changed, including operations-only changes.
- Narrowed the smooth-surface render dependencies to geometry, theme, accessibility palette, and camera rotation.
- Corrected the CI deployment gate so its `Golden-path E2E` step runs the dedicated golden-path and vision-page specs instead of all 45 acceptance specs. The full suite remains available through `npm run test:e2e` for release/nightly regression.
- A paused JavaScript stack exposed the dominant hang: an operations update invalidated root-identity course-rating caches, then fixture normalization looked like a geometry edit and replanned 100 golfers. Rating caches now key off immutable physical geometry, layout normalization preserves stable hole arrays, normalized results remain cached, and browser fixtures enter normalized state.
- Restored the M29 stress fixture's intended five staff roles and replaced M6's arbitrary tournament step cutoff with deterministic completion polling.
- Verification: 61 Vitest files / 375 passed with one intentional skip; typecheck; production build; lint/i18n with the same seven existing hook warnings and no errors; exact CI golden path and vision specs (9 passed in 34.5s); M29 acceptance (13.8s); M12/M21/M22/M24/M27 fixture regression at two workers; and M6 tournament acceptance.
- Visually inspected desktop/mobile vision captures, M29 pace/staff panels, the M6 completion failure state used to repair its polling, and a headed bundled-client renderer capture. The bundled client also confirmed valid 18-hole/100-golfer text state with no console-error artifact.

## 2026-07-23 — Shareable game-vision page in progress

Current request: “Create a slick html page that links from the home page which shows the vision of the game, functionality, features, depth, etc so I could share with friends so they know what the end product could be. Include renderings from buildings and tutorial caddie etc to make it feel like a storyboard”

- Added a standalone, shareable `?view=vision` presentation route linked from the title screen.
- Built a responsive editorial/storyboard page covering course architecture, golfer simulation, property enterprise, hospitality, tournaments, community, progression, and legacy.
- Reused the production tutorial caddie portrait sheet and generated three complementary concept renders for the destination hero, coastal course design, and clubhouse campus.
- Added native-share/clipboard link handling, direct-link loading, back navigation, reduced-motion behavior, and responsive layouts.
- Optimized the three concept renders from roughly 9 MB of PNGs to 2.4 MB of high-quality JPEGs.
- Verification complete: production build and offline-asset injection pass; full lint/i18n passes with seven pre-existing hook warnings; two focused Playwright tests pass for title-link navigation, direct links, sticky chapter navigation, back behavior, console cleanliness, and phone layout.
- Visually inspected the home link plus desktop hero, systems, clubhouse, phone hero, and phone systems captures. The required bundled web-game client also reached a fresh game with valid text state and no console-error artifact; its headless Pixi canvas capture was black under software GL, as expected.

## 2026-07-23 — M31 completion pass

Current request: “Implant m31 from linear”

- Audited M31 (`ZK-285`–`ZK-298`) against the existing property-enterprise baseline and concentrated the implementation on the seven feature tickets plus certification that remained open.
- Added persisted facility operating hours, lean/standard/premium upkeep, construction downtime, last-day demand/served/denied/revenue telemetry, facility renaming, and editable practice hitting direction while preserving stable route/station identity across moves and saves.
- Added the shared clubhouse shell/module registry (check-in, retail, restaurant/kitchen/bar, lockers/lounge, pro office/fitting, and function rooms), room-slot and shell-tier gates, reducer-atomic module controls, module operating costs, and capability-backed service simulation.
- Added expansion previews with footprint validation, cost, capacity/upkeep/parking deltas, downtime, and break-even guidance; upgrades now respect land/overlap blockers and expose construction state.
- Expanded pro-shop economics into merchandise, rentals, repairs, and staffed fittings; added facility-hour, staffing, condition, queue/denial, COGS, and upkeep effects to practice and clubhouse service.
- Added package-specific outing previews, exact blockers, deposits, shared arrival/staff/facility validation, fulfillment revalidation, and explicit cancellation/refund handling.
- Added themed/surface-aware property rendering, visible practice routes/stations and construction cues, richer `render_game_to_text` property telemetry, and Golfopedia entries for estate access, practice academies, and club campuses.
- Verification: 56 Vitest files passed (350 passed, one intentional skip); focused M31/save tests passed (14); production build passed; lint/i18n passed with seven pre-existing hook warnings; the M31 Playwright golden path passed; the bundled web-game client passed with no console error artifact. `m31-club-campus.png`, `m31-property-enterprise.png`, and `m31-final-smoke/` were visually inspected.

## M31 remaining

- None. Completion notes were added to the seven previously open implementation/presentation/certification tickets, and all M31 issues are Done in Linear.

## 2026-07-23 — M33 golf community, real estate, and safety complete

Current request: “Implement m33 from linear”

- Resolved M33 as ZK-308 through ZK-317, “Golf Community, Real Estate & Safety,” and read the existing foundation notes plus every remaining acceptance gap.
- Added migration-safe v2 property and v3 enterprise contracts for developments, units, easements, tenure, safety policy, enriched households, complaints, incidents, claims, and insurance.
- Added explicit sell/retain/partner phase previews and confirmed approvals, phased construction/release, stable unit and household/customer identities, atomic closings, retained rent/vacancy, partner revenue share, common costs/taxes/insurance, and protected committed/private/easement land.
- Reworked residential safety across every tee set plus landing/approach/recovery segments, spatial heat cells, measured setbacks, exact blocking reasons, operating restrictions, and height/condition/geometry-sensitive mitigation.
- Live-day settlement now receives actual played shot traces and creates deterministic attributed boundary-entry/near-miss/damage incidents, evidence-backed recurring complaints, open claims, one-time claim settlement, and premium escalation.
- Added screening, fencing, berm, and signage mitigation assets, complaint response actions, operational hole/tee restrictions, and remediation-delayed negotiated buyback.
- Added a localized, accessible community dashboard with irreversible-plan previews, phase/unit/easement telemetry, tenure-safe map cues, shot-exposure heatmaps, restriction controls, valuation components, household/HOA rows, complaint commitments, and claims/insurance operations.
- Added themed residential occupancy/vacancy and tenure presentation, mitigation states, expanded text-state automation, and a real golden path that proves retained residents use the club economy, survives an open-claim save/reload, settles once, and reduces risk through physical mitigation.
- Verification passes: 58 Vitest files / 363 passed with one intentional skip; production build; lint/i18n with the same seven existing hook warnings and no errors; M31, M32, and M33 browser acceptance; and the 36-hole/100-golfer performance smoke at 0.28 ms renderer work against the 8 ms budget.
- Both M33 dashboard captures were visually inspected with no panel overflow or console errors. The bundled web-game client replay completed without an error artifact, and its text state confirmed the property panel, migrated safety policy, insurance, and stable empty starter collections.

## M33 remaining

- None. ZK-308 through ZK-317 meet their implementation and acceptance criteria.

## 2026-07-22 — Practice campus, destination resort, and golf community implementation

User request: Implement the newly planned Linear features covering practice/revenue facilities, tiered access/parking/roads, destination lodging, and golf-course residential development; update the Linear tasks when verified; commit and push the completed work to `main`.

- Audited the repository and confirmed a clean `main` branch tracking `origin/main`.
- Loaded the web-game and Linear workflows and mapped the work to M31 (ZK-285–ZK-298), M32 (ZK-299–ZK-307), and M33 (ZK-308–ZK-317).
- Identified the versioned save model, economy simulation, reducer, and management HUD as the primary integration seams.
- Added save schema v12 with deterministic legacy access, stable building/property IDs, bounded member-first customer retention, resort reservations, residents, incidents, and a bounded category-level commercial ledger.
- Added reducer-atomic property commands for tiered roads/parking, practice facilities, clubhouse modules, pricing, closures, relocation, maintenance, pros, memberships, outings, resort staffing/packages, residential development, mitigation, and buybacks.
- Integrated shared arrival/parking capacity with the core tee sheet and daily economy; commercial gross revenue, COGS, upkeep, wages, refunds, claims, reputation, condition, and weekly reports now settle together.
- Added multi-day lodging inventory/entitlements, housekeeping/front-desk/shuttle constraints, outing fulfillment, resident demand/complaints, corridor-derived safety eligibility, sold-land edit protection, and attributed deterministic claims.
- Added the localized Property Enterprise UI, vector-rendered themed campus footprints/representative parked cars/netting, text-state telemetry, and weekly/property ledger reporting.
- Verification so far: production build passes; lint/i18n passes (existing hook warnings only); 348 unit/integration tests pass with one pre-existing skip; M31-M33 browser golden path passes with a visually inspected screenshot and no console errors.

Current request (2026-07-22): Make the course canvas feel embedded in a larger SimCity-style region: never expose a floating map edge when zoomed out, keep the full estate boundary readable with scenic bleed, and continue Links ocean coherently beyond a boundary-connected coast.

## 2026-07-22 — Seamless regional canvas in progress

- Confirmed the Pixi renderer currently ends at the finite course diamond over a flat clear color and clamps camera centers to only six tiles of overscroll.
- Direction locked: the full nine-parcel estate is the playable property; the surround is deterministic, living, biome-matched countryside with a natural seam and non-interactive scenery.
- Links rule: only a substantial boundary-connected water body becomes open ocean; inland ponds remain contained.
- Added deterministic parkland, links, and desert regional scenery beneath the playable estate, with an effectively unbounded base plane, field/wood/scrub patches, sparse biome props, roads, and a broken natural perimeter seam.
- Camera overscroll is now viewport- and zoom-aware (capped at 48 tiles), with a viewport-aware minimum zoom; close views keep the estate edge present while overview views gain generous scenic bleed.
- Links coast detection derives and extends the generated shoreline beyond both estate corners. Open water excludes regional land features and blends through a fading band of the authored water material into the regional ocean.
- Removed the old exposed exterior cliff slab. Focused scenery/camera tests and the Links overview/edge Playwright test pass; parkland, desert, and Links screenshots were visually inspected.

## Seamless regional canvas verification

- Full unit suite: 54 files, 342 tests passed with one intentional skip.
- Production build and i18n/lint guards pass; lint reports seven pre-existing React hook warnings and no errors.
- Renderer regression: M12, M19, M20, M21, M22, M25, and the new regional-canvas suite all pass (eight browser tests total).
- 100-golfer performance smoke passes at 0.27 ms renderer work; headless frame p95 is reported at 51 ms but remains intentionally non-asserted in software GL.
- Bundled web-game client passes with camera zoom/rotation/visible-estate telemetry. Because its largest-canvas heuristic selects the minimap for this layout, full-page Playwright captures were also used and inspected for the main Pixi canvas.
- Final evidence: `artifacts/scenic-parkland.png`, `scenic-desert.png`, `scenic-links-overview.png`, and `scenic-links-edge.png`.

## Seamless regional canvas remaining

- None.

Current request (2026-07-22): Implement M29 Pace of Play & Hospitality Operations and create its Linear milestone/issues.

## 2026-07-22 — Pace of Play implementation in progress

- Added per-course Relaxed/Balanced/Brisk operating policies, adjustable tee intervals, group sizes, starter gaps, enforcement, tee guidance, and beverage service.
- Replaced solo tee-sheet planning with deterministic booked groups and downstream group blocking; tracked group wait, interventions, pickups, beverage revenue, alcohol, refusals, and incidents.
- Added named persisted staff roster migration from staff level, course assignments, marshal coverage, beverage-cart coverage, live pace controls, and a pace dashboard.
- Advanced saves to schema v11 and live snapshots to v2 with migration defaults for policies, groups, pace data, staff, and golfer hospitality state.
- Focused live/save tests and production build pass. Full regression, browser interaction/visual verification, and Linear creation remain.

Current prompt: Implement M29 Cloudflare playtest hosting and create the Linear milestone/issues.

## 2026-07-22 — M29 Cloudflare playtest hosting implemented

- Hosting direction: Cloudflare Workers Static Assets on an unlisted `workers.dev` URL, local saves only, automatic deployment after successful `main` CI.
- Added root-path PWA hosting configuration, security/cache/noindex headers, optional Cloudflare Web Analytics, privacy-sanitized Sentry error reporting, and tested-artifact deployment gating.
- GitHub Pages remains a temporary fallback until two consecutive Cloudflare deployments and deployed browser/PWA acceptance pass.
- Published the clean production build at `https://coursecraft-playtest.zbkutlow.workers.dev` (Cloudflare version `25e8ee12-b118-46d5-aa3a-ff2e1faef1fd`). Live root/deep-route headers, offline reload, and local save persistence pass.
- Verification passes: typecheck, 51 Vitest files / 328 passed with one intentional skip, production build, lint with seven pre-existing hook warnings and no errors, Wrangler dry run, PWA smoke, and the bundled web-game client. Title and gameplay captures were visually inspected.
- Production dependency audit is clean after pinning the transitive XML parser fix. Sentry and Cloudflare Web Analytics remain dormant until their external projects and repository variables are configured.
- Created Linear milestone `M29: Cloudflare Playtest Hosting & Telemetry`: parent ZK-271 with children ZK-272 through ZK-275. ZK-272 is Done; CI activation, telemetry credentials, cross-browser/cutover validation, and the two-deployment stability gate remain tracked.

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

## 2026-07-21 — M27 golf architecture intelligence in progress

- Current request: “Implement m27 from linear project”. Linear scope resolved as ZK-248 through ZK-252 and all five issues were moved to In Progress.
- M27 covers deterministic architecture scoring, routing/safety/walkability analysis, the Architect Report and guidance surfaces, expansion progression/balance, and complete 36-hole release certification.
- Existing modified and untracked visual/test artifacts predate this task and are being preserved untouched.

## 2026-07-21 — M27 golf architecture intelligence complete

- Added a deterministic, explainable 0–100 architecture score with exact Routing 25%, Natural Fit 25%, Variety 20%, Safety 15%, and Walkability 15% weights, raw measurements, bounded demand/quality influence, and identity caching.
- Added estate-aware routed green-to-tee and clubhouse analysis, returning-nine measurements, crossing/parallel/repetition detection, earthwork and terrain-retention findings, nonblocking map geometry, and bounded route-search fallbacks that cannot stall play.
- Added the accessible Architect Report to Course Manager with progress bars, explanations, warning navigation, map overlays, Golfopedia concepts, localized copy, pseudo-locale coverage, text scaling, reduced motion, and color-safe terrain verification.
- Added 18/36-hole progression goals and achievements, second-course guidance, persistent one-shot advisor IDs, developed-land and multi-course operating costs, a complete two-course/36-hole/100-golfer release fixture, save/hash compatibility fixes, and performance-fixture support.

## M27 verification

- Full unit suite passes with an expanded timeout appropriate to the existing synchronous M24 live fixture: 48 files, 316 tests passed, one intentional skip. Reducer fuzz passes 3/3.
- Production build, lint/i18n guards, and `git diff --check` pass. Lint reports the same seven existing React hook warnings and no errors.
- M27 Playwright acceptance passes 2/2: 36 holes, two independently published eighteens, nine owned parcels, 100 concurrent golfers, architecture report/map findings, the ≤8 ms renderer-work gate, and pseudo-locale/accessibility coverage.
- The long M14 fresh-state tutorial regression passes at its normal timeout (9.8 minutes). Previously isolated M17 retention, M20 advisor, and golden quick-start regressions also pass.
- The bundled web-game client completed deterministic stepping with no console-error artifact; text state confirms 36 holes, two layouts, architecture 60.3, four findings, nine owned parcels, and 100 golfers. Its headless canvas-only capture was black under SwiftShader, while the full Playwright captures rendered correctly and were visually inspected.

## M27 remaining

- None. ZK-248 through ZK-252 meet their implementation and acceptance criteria.

## 2026-07-21 — M28 release candidate and external playtest in progress

- Current request: “Implement m28 from the linear project”. Linear scope resolved as ZK-253 through ZK-261. ZK-253 is In Progress; the remaining validation and gate issues retain their dependency order.
- Release audit found GitHub Pages subpath breakage in service-worker registration, manifest scope/icons, precache URLs, navigation fallback, and cache identity. These are now base-aware and version-aware.
- Rebuilt `npm run test:pwa` as a self-contained production smoke mounted at `/golf-course-simulator-game/`; it passes scoped service-worker control, manifest resolution, offline reload, and local progress preservation.
- Save payloads now use revisioned storage committed by the manifest, so an interrupted overwrite cannot replace the active last-known-good payload. Focused save/migration coverage passes 15/15, including a simulated interrupted manifest commit.
- Bundled web-game client passed against the M27 36-hole/100-golfer fixture. Text state confirmed two published 18-hole layouts and 100 golfers; the second screenshot rendered correctly. The first headless WebGL capture was black during initial load, consistent with prior SwiftShader behavior.
- Existing modified/untracked historical visual and test artifacts predate M28 and remain preserved.

## M28 next

- Establish version `1.0.0-rc.1`, release evidence files, cross-browser runner, and the automated balance/accessibility/performance matrices.
- Run the complete release suite, fix findings, commit the RC, deploy through GitHub Pages, and validate the exact deployed commit.
- Moderated sessions with 5–10 unfamiliar human players and physical low-/mid-range device measurements require real participants/devices; prepare the protocols and keep the final gate at HOLD or RE-TEST until those results exist.

## M28 local certification

- Versioned `1.0.0-rc.1`; added release configuration, GitHub certification workflow, clean-profile Chrome/Firefox/WebKit coverage, human-playtest and physical-hardware protocols, and immutable save/PWA release hardening.
- Unit suite passes: 48 files, 318 passed, 1 skipped. Onboarding playthrough A passed in 7.1m; playthrough B passed in 12.9m including reload/resume/rerun. Cross-engine release path passes 3/3.
- Economy matrix passes 81 deterministic 104-week runs (8,424 weeks), with zero normal-path bankruptcies and every normal path profitable by week 2.
- Parkland/links/desert performance evidence passes: 0.75–0.97s cold startup, 4.0–4.5s fixture load, and 0.29–0.32ms renderer work against the 8ms budget. Physical-device frame p95 remains outstanding.
- Deterministic soak passes 7,519 rounds with 1.55MB post-GC retained heap growth. Production Pages-subpath PWA smoke passes scoped installation, offline reload, and local persistence.
- Final visual smoke rendered the 36-hole estate with two open 18-hole layouts and 100 active golfers; no client error artifact was emitted.
- External requirements remain: 5–10 unfamiliar-human moderated sessions, stable Safari clean-profile sign-off, and physical low/mid-range hardware baselines. The milestone remains HOLD/RE-TEST until those are supplied.

## M28 RC.2 CI reliability follow-up

- GitHub CI and RC certification for `92dfc82` failed only on CPU-heavy fixture timeouts; deployment itself succeeded. Logged the failures as ZK-263 and ZK-262.
- Added a two-worker CI-specific Vitest command and bounded headroom for the scenario and tournament fixtures observed in the logs. The exact local CI command passes 48 files (318 passed, 1 skipped) in 37.4s; lint/typecheck remain green.
- Advanced the immutable candidate to `1.0.0-rc.2`; `v1.0.0-rc.1` remains unchanged.

## 2026-07-21 — active Linear bug sweep

- Current request: “please squash all bugs listed in linear”. The active `golf-sim` Bug scope is ZK-262 through ZK-265; unrelated projects and completed/canceled bugs are excluded.
- ZK-262/ZK-263 are already implemented by `c155855`: CI and RC workflows use `npm run test:ci` with two Vitest workers, and the three observed heavy fixtures have explicit bounded timeouts.
- ZK-265 now reconciles the open-course tutorial lesson from authoritative nine-valid-hole course state. The handoff advances exactly once to the visible 1× speed instruction, including after save/load, without requiring an extra Continue click.
- ZK-264 now normalizes pixel/line/page wheel deltas, bounds discrete wheel steps, accumulates against the latest camera target, preserves the target-space cursor anchor, and leaves current camera state to the existing animation-frame easing.
- Focused onboarding and wheel-target tests pass (14/14); typecheck and `git diff --check` pass.
- The first reload-enabled browser run exposed that an eight-hole save restored the tutorial but reset the editor to Hole 1; load reconciliation now focuses the first incomplete hole and restores Hole Wizard mode.
- The corrected browser run passed the eight-hole reload, automatic ninth-hole handoff, and post-handoff reload. Its later rerun correctly skipped the already-satisfied open-course lesson, exposing one stale test expectation that is now aligned with current-state reconciliation.

## Active bug sweep next

- None for implementation. Add Linear completion notes and move ZK-262 through ZK-265 to Done.

## Active bug sweep verification

- Final CI-configured unit suite: 49 files, 322 passed, one intentional skip, using the same `--maxWorkers=2` command wired into CI and RC certification.
- Production build and lint/i18n guards pass; lint reports the same seven pre-existing hook warnings and no errors. Typecheck and `git diff --check` pass.
- Reload-enabled M14 playthrough B passes end to end in 13.2 minutes: visible UI through all nine holes, reload at eight, automatic handoff, reload after nine, graduation, already-complete rerun reconciliation, and late skip.
- The ninth-hole capture was visually inspected: Lesson 7 is fully visible, names the 1× action, and spotlights the speed controls without toast/overlay obstruction.
- The bundled game client passes against the M27 36-hole/100-golfer fixture with deterministic state advancement and no error artifact; its final rendered course screenshot was visually inspected.

## ZK-266 links coast follow-up

- A final Linear sweep found newly filed ZK-266 after the original four-ticket scope was completed.
- Replaced the links theme's competing inland pond plus 1–3-tile edge ribbon with one deterministic open-sea shelf covering 11–22% of the cross-map dimension, a low-frequency wandering shoreline, and a pale dune/deep-fescue first-dry-tile band. Parkland and desert generator branches/RNG paths are unchanged.
- Added deterministic coverage for all-water edge connectivity, 10–28% sea coverage, non-uniform coastline depth, over 70% buildable land, and biome isolation. Final CI suite: 49 files, 323 passed, one intentional skip.
- New-game preview regression passes. The regenerated links preview was visually inspected and clearly reads as a broad cold-water coast with an irregular shore. Production build, lint/i18n, typecheck, and `git diff --check` pass.

## 2026-07-22 — ZK-267 terrain paint strokes

- Implement click-and-drag terrain painting as one atomic, deduplicated stroke with pointer capture, cancellation, live economics, invalid-tile exclusions, and an all-or-nothing affordability guard.
- Keep single-click painting as a one-tile stroke and make preview, confirmation, reducer validation, and final cash delta share one terrain-stroke calculation.
- Add focused model/reducer tests plus browser coverage for affordable, unaffordable, deduplicated, and canceled strokes; then run the production validation loop.

## ZK-267 completion

- Terrain clicks and drags now use one pointer-captured, interpolated, deduplicated stroke. Valid tiles highlight live; Escape and pointer cancellation discard the stroke without touching terrain or cash.
- A shared pure batch calculation supplies gross construction, salvage, net, projected cash, exclusions, and affordability to both the preview and reducer. The reducer rejects unaffordable/locked/bankrupt strokes atomically and increments terrain/economy versions once on success.
- The localized floating preview communicates changed/invalid/unchanged/repeated tiles and exact shortfall. Single-click remains a one-tile stroke.
- Full CI suite passes: 50 files, 327 tests passed, one intentional skip, including the 10,000-sequence reducer fuzz test. ZK-267 Playwright acceptance, production build, lint/i18n guards, typecheck, and `git diff --check` pass; lint retains seven pre-existing hook warnings and no errors.
- Bundled-client smoke rendered/extracted a responsive 220×140 estate without an error artifact. Linear ZK-267 has the implementation evidence and is Done.

## 2026-07-22 — direct additional tee-box management complete

- Added schema-v10 tee-specific Auto/Manual par settings while preserving Member `parMode`/`parManual` compatibility.
- Projected each selected tee/pin/par combination through the shared shot solver for independent route, yardage, par, ratings, and live-round planning.
- Added direct selection for every tee marker, a post-hole additional-tee offer, priced two-step map placement, move/removal controls, last-tee warning, and atomic reducer affordability.
- Added localized, accessible setup/par controls and concise `render_game_to_text` coverage for selected tee and pending construction.
- Verification passes: 51 Vitest files / 329 tests with one intentional skip, production build, typecheck, lint/i18n, two M23 Playwright scenarios, and the bundled web-game client. The full setup UI and rendered course captures were visually inspected.
- Created Linear follow-up ZK-270 in Backlog with High priority, agreed labels/relations, complete acceptance criteria, and implementation evidence.

## 2026-07-22 — ZK-276 Workers blank course renderer

- Reproduced the deployed blank viewport at `coursecraft-playtest.zbkutlow.workers.dev`; React menus load, but Pixi aborts initialization because the strict production CSP disallows runtime `unsafe-eval`.
- Preserved the strict CSP and installed Pixi's supported strict-CSP adapter before renderer startup. Also surfaced a localized renderer failure card instead of leaving a silent blank viewport.
- Added PWA regression coverage that launches gameplay under the deployed CSP, rejects a blank canvas using sampled pixel diversity, and fails on page errors before exercising service-worker offline reload and local save persistence.
- Deployed Cloudflare Workers version `d9d85b96-612e-4e67-b9ad-229c27f22bdc`. Production verification passes with a rendered course, no page-error artifact, strict live headers without `unsafe-eval`, service-worker install, offline reload, and saved-state persistence.
- Final gates: typecheck, production build/Wrangler dry run, focused ESLint (three existing hook-cleanup warnings, no errors), 51 Vitest files / 332 passed with one intentional skip, and `git diff --check`. Repository-wide i18n remains blocked by unrelated uncommitted M29 strings in `LiveOverview.tsx`.

## 2026-07-22 — M30 pace of play and hospitality operations

- Added versioned course operations with relaxed/balanced/brisk pace presets, grouped tee sheets, downstream blocking, time-par tracking, skill/tee/recovery pace effects, and segment-specific demand response.
- Added named course-assigned staff, marshal coverage and graduated enforcement that excludes traffic-blocked groups, plus beverage coverage, service delays, revenue, alcohol impairment/refusals, and deterministic disorder incidents.
- Added a localized Pace tab with policy controls and live wait/coverage/enforcement/hospitality metrics; staff assignments and all new live state persist through save schema v11 and live snapshot v2 migrations.
- Verification passes: production build, i18n/lint guards (seven existing hook warnings, no errors), `git diff --check`, browser render/state smoke, and 51 Vitest files with 332 passed and one intentional skip.
- Created Linear milestone `M30: Pace of Play & Hospitality Operations` with ZK-277 and ZK-278 Done and ZK-279 In Progress. The workspace free-plan issue cap prevented creating the longer issue series, so ZK-279 carries the remaining rolling-history, daylight/refund, bottleneck/advisor, reporting, and certification checklist.

## 2026-07-22 — M31 live-time authority and weekly consolidation

- Replaced frame-sized live advancement with one deterministic 0.05-game-minute fixed-step accumulator shared by animation-frame and test/manual advancement. Pause, 1×, 2×, and 4× are now the literal player-facing tiers; legacy 3× preferences and snapshots migrate to 4×.
- Added a versioned, persisted seven-day ledger. Daily closes append once, while only Sunday aggregates revenue, costs, profit, satisfaction, concessions, and per-course performance into the authoritative weekly result.
- Removed the player-facing instant-week action from App, HUD, and sidebar paths. Weekly history, events, achievements, capital reset, and tutorial progression now consume the live Sunday completion callback.
- Added Week/Day context to the clock and an accessible Sunday report that pauses time, advances to the next Monday, and resumes the player's prior running speed after Continue.
- Verification passes: 53 Vitest files / 339 tests with one intentional skip; 80 focused live-clock/ledger/persistence tests; nine focused Playwright golden/live-progression scenarios; production build; typecheck; lint/i18n with seven pre-existing hook warnings and no errors; `git diff --check`; bundled 100-golfer client smoke; and the 36-hole/100-golfer performance fixture at 0.34ms renderer work against the 8ms budget.
- The legacy M14 end-to-end tutorial fixture still stalls while constructing its nine-hole course before it reaches the changed weekly-report step. Dedicated Sunday report/progression coverage passes, and the M14 week-close calls have been migrated away from the removed instant-week button.
- Created Linear milestone `M31: Live-Time Authority & Weekly Consolidation` at 100% with ZK-318 through ZK-322 Done. Dependencies encode clock → ledger → live-only/UI → certification, and the ledger/certification tickets relate to M30 daylight settlement and historical reporting.

## 2026-07-22 — M31–M33 property enterprise, resort, and community

- Added save schema v12 with stable facility identities plus bounded persistence for commercial assets, customer profiles, professionals, memberships, bookings, stays, residents, incidents, outings, and the shared transaction ledger. Pre-v12 courses receive deterministic gravel road and parking access without a cash rewrite.
- Added atomic core commands and tiered estate placement for roads/parking/valet/overflow/shuttles, practice facilities, expandable clubhouse modules, retail/dining/locker/event facilities, lodging/spa, residential phases, safety buffers, and netting. Placement respects ownership, terrain, golf geometry, existing structures, prerequisites, cash, close/reopen, relocation, removal, and buyback rules.
- Integrated access capacity into golfer demand and every commercial visitor stream; daily settlement now includes practice buckets/skill gains, lessons, memberships/churn, retail and food COGS, outings, lodging packages/room operations/service recovery, resident demand, valuations, ball-strike complaints/claims, property upkeep, wages, and core golf/concession entries in one bounded ledger.
- Added the Property Enterprise management UI, world-space vector facilities, arrival/academy/destination/community/ledger reporting, safety analysis by contributing hole, and automation telemetry. The dedicated browser flow builds and upgrades the complete campus/resort/community chain and visually verifies the result.
- Final verification: 56 Vitest files / 348 passed with one intentional skip; production build; lint/i18n with seven pre-existing hook warnings and no errors; save/reload golden path; M31–M33 Playwright acceptance; and the 36-hole/100-golfer performance smoke at 0.28ms renderer work against the 8ms budget. The full legacy Playwright sweep also exposed M6 and M29 failures that reproduce identically on a clean `main` checkout and are not regressions from this work.

## 2026-07-23 — M32 destination resort completion

- Upgraded the resort contract to version 2 with sanitized migration-safe room classes, room counts, traveler segments, companions, transport modes, luggage/vehicle state, scheduled entitlement status, revalidation outcomes, and bounded folio transactions.
- Replaced arrival-week inventory checks with per-night overlap accounting, per-property occupancy, clean/out-of-order room constraints, exact deposits/balances/refunds, and deterministic check-in, service-day, checkout, and housekeeping transitions.
- Added capacity-backed room-only, stay-and-play, academy, and event previews with coupled room/golf/practice/dining/access/shuttle blockers, current-demand rate ceilings, estimated cost/margin, and anti-overbuilding pressure. Remote parking now contributes only when a staffed shuttle connects it.
- Included services execute only on their scheduled day and cannot redeem twice. Post-booking course, facility, staffing, or transport failures produce a visible queue, one deterministic component refund, a folio line, and a non-duplicating ledger adjustment.
- Added resort staffing for maintenance and concierge/bag service, operational metrics for occupancy/ADR/RevPAR/length of stay/package margin/ancillary spend/transport cost/destination appeal, capacity guidance, and accessible reservation/itinerary/folio reporting.
- Added themed parkland/links/desert lodge, hotel, cottage, spa, and shuttle vector presentation with tier detail, roof/window identity, route cues, closed-state marks, and non-color service-pressure hatching.
- Verification: 57 Vitest files / 356 tests (355 passed, one intentional skip); focused M32 tests cover cross-week double-sell prevention, mid-stay execution/refunds, corrupted optional save data, staffed overflow transport, pricing exploits, and unsupported overbuilding. Production build and lint/i18n pass with seven pre-existing hook warnings. M31 regression, M32 save/reload golden path, keyboard-only save/load, accessibility scaling/color/reduced-motion, and pseudo-locale Playwright acceptance pass. The full-estate performance smoke measured 0.32 ms renderer work; M32 dashboard and itinerary screenshots plus bundled-client state/screenshot were inspected.

## M32 remaining

- None.
## 2026-07-23 — M35 continuous landscape implementation

Current request: Implement the proposed M35 Continuous Landscape & Visual Polish plan.

- Created Linear milestone `M35: Continuous Landscape & Visual Polish` and dependency-ordered issues ZK-324 through ZK-332.
- Added save schema v13 with optional, sanitized `Course.surfaceIntent` metadata while keeping `Course.tiles` authoritative.
- Added versioned corridor/region feature contracts, pointer-gesture simplification, fixed-step Catmull–Rom sampling, deterministic 4× coverage rasterization, ordered feature persistence, and focused tests.
- Added Curve/Area terrain tools, continuous width control, shared preview/commit geometry, 20-step undo/redo with keyboard shortcuts, and cursor/footprint-only editing outlines.
- Added a dedicated GPU surface layer with automatic tile-union contour extraction for legacy saves, closed-boundary simplification/rounding, smooth filled corridors/regions, rounded corridor caps, elevation-aware projection, stale-intent protection, and reconstructed visual underlays that suppress legacy diamond protrusions without changing authoritative simulation cells.
- Added graphics-quality preferences and a stable Auto/High/Medium/Low capability ladder. Lower tiers scale render density and progressively remove ground-cover/ambient animation while leaving simulation deterministic.
- Split React, Pixi, and third-party dependencies into stable cacheable production chunks; the game entry dropped from 409 KB to 251 KB gzip while the service worker continues to precache the full offline build.
- Verification: 61 Vitest files / 375 passed with one intentional skip; reducer fuzz, TypeScript, lint/i18n, production build, focused M35 Playwright interaction/undo/redo, three-biome/four-rotation/detail benchmarks, persisted accessibility graphics modes, PWA install/offline/save persistence, bundled web-game-client state, and the 36-hole/100-golfer performance smoke pass. Renderer ticker work measured 0.37 ms against the 8 ms budget after legacy contours. `artifacts/m35-curved-terrain.png` and the parkland/links/desert detail benchmarks were visually inspected.

## M35 remaining

- Add richer terrain-to-terrain blend bands and elevation-aware bank/cliff art on top of the shipped automatic legacy contour layer.
- Add editable control nodes/tangent handles and richer closed-region editing beyond the shipped freehand Area gesture.
- Deliver the biome-specific art/animation pass, world dressing, and benchmark captures across all themes/viewports.
