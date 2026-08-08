Original prompt: Complete ZK-177 and ZK-178, clean the worktree, commit, and push.

## 2026-08-08 — ZK-773 viable starting capital complete

- Added pressure-owned fresh-run capital: Friendly $200K, Balanced $100K, and Tight $85K. The initial $70K Tight proposal failed the deterministic Desert nine-hole construction certification ($75,558 before the required correction reserve); $85K is the smallest $5K increment that clears it with $9,442 remaining.
- New starts and sandbox defaults resolve this authority; sandbox supports up to $500K. Authored scenario overrides and existing save cash remain exact.
- Certified a real nine-hole route across Parkland, Links, and Desert for all three legacy profiles, including two-wide corridors, clearing, earthwork, open layout, four operating weeks, and correction reserve.
- Full `test:balance` now passes 81 runs / 8,424 weeks with no normal-path bankruptcies. Updated its canonical and legacy projection baseline hashes to the deliberate post-capital-contract values `499b7056` and `b5a5a183`.
- Focused capital/migration tests passed 40/40; required browser client created a Classic/Balanced $100K run with no error artifact; the existing New Game browser contract passed. Generated browser artifacts were kept outside this worktree or restored before commit.

## 2026-08-07 — ZK-683 experience-profile/economic-pressure foundation complete

- Added independent typed `ExperienceProfile` (Relaxed/Classic/Simulation) and `EconomicPressure` (Friendly/Balanced/Tight) axes. One centralized catalog owns descriptions, default pressure, failure policy, visible workspaces, tutorial modules, automation defaults, and every economic multiplier.
- Preserved exact legacy mappings: Easy→Relaxed/Friendly, Normal→Classic/Balanced, Hard→Simulation/Tight. Balanced returns the original `BALANCE` object by identity; profiles do not participate in any economy resolver.
- Added save schema v29 plus canonical browser/native persistence, slot metadata, live-day snapshot, scenario/package, current-run setup, and `render_game_to_text` carriers. Current saves omit the retired difficulty carrier; imports remain backward-compatible.
- TypeScript, focused compatibility/regression batches, the full unit regression, production build and every delivery audit pass. Dedicated tests cover all nine axis combinations, legacy migration equivalence, Normal/Balanced identity, deterministic same-seed/profile-inert actions, pressure-only economy changes, canonical hashes, live snapshots, save slots, and desktop atomic files. Lint/i18n passes with zero errors and the 12 existing hook warnings.
- The required bundled browser client reached a live Quick Start game. Its renderer capture was visually inspected, structured state reports `classic`/`balanced`, and no console/page-error artifact was produced. No cash targets or balance values were retuned; ZK-773 remains reserved.

## 2026-08-07 — ZK-760 tee-specific neutral shot maps complete

- Added a dedicated neutral architecture-reference authority with documented Forward/Member/Championship carry, total-distance, approach, dispersion, and ordinary-risk profiles. Live golfer strategy remains separate.
- The planner chooses bounded one-, two-, or three-shot sequences with straight shot chords and discrete landing zones. It evaluates carryable water, dispersion, elevation, playable landing share, obstacles/structures, out-of-bounds exposure, runout, and next-shot reachability; it never adds putting segments.
- Auto par is full shots plus the two-putt convention. Per-tee manual par remains authoritative; an implausible manual request receives a warning while the credible route is shown. The two documented ambiguity bands expose viable adjacent pars.
- The new Architecture Review “Reference shots” overlay consumes the planner's shot chords, landing zones, corridor, and per-shot safety/risk evidence and explains the neutral assumptions. The certified course-rating formula remains unchanged: exploratory replacement changed established qualification boundaries, so the reference plan stays advisory rather than altering rating or live-scoring outcomes.
- Canonical ZK-760 coverage passes for carryable-water Par 3, driveable and dogleg/forced-layup Par 4, three-shot and reachable Par 5, both ambiguity bands, all three tee sets, independent pins, manual warning behavior, structures, elevation, deterministic edit invalidation, and review-overlay output. `test:ci` passes 178 files / 1,417 tests plus one intentional skip and 5/5 audio audits; lint/i18n passes with zero errors and the 12 existing hook warnings.
- The production build passes every asset/offline/residency/delivery audit. `referencePlan` is deferred as a 10.51 kB chunk; initial JavaScript is 1,602,676 bytes, 6,043 bytes below the 1,608,719-byte ceiling. The bundled web-game client reached the seeded game with structured state and no error artifact; the dedicated responsive browser scenario passes and its inspected 390×844 capture shows the neutral plan without horizontal overflow.

## 2026-08-08 — ZK-764 reference-plan consumers complete

- Architecture Review now injects its exact selected tee/pin reference plans into routing, variety, safety, and advisory rating/slope analysis; its overlay chords, landing tooltips, score summary, yardage, and explanations all report from the same retained plan versions. Published qualification ratings retain their compatibility path until reference evidence is explicitly supplied.
- Residential eligibility, incidents, summaries, setbacks, contributions, and heat cells resolve retained per-tee shot segments in production; residential courses preload that evidence and the Property panel waits for it before accepting decisions. The retained plan remains separate from live safe/hero/positional/recovery choices, with deterministic isolation and implicit-consumer regressions.
- Flyovers load the canonical selected tee/pin plan only inside an explicit nonce trigger and frame every retained landing target. Background setup changes cannot replay the cinematic. Implausible plans share one bounded tee-to-pin fallback across architecture, property, rating, and flyover instead of falling back to a separate route solver.
- The overlay/summary builder remains deferred in the planner chunk. Deterministic 36-hole work is capped at 108 segments, 72 landing zones, 320 traces, and 180 points; spatially bounded obstacle evaluation reduced the instrumented cold reference-consumer solve to about 1.06 seconds, and geometry-valid evidence is reused across property-only course roots. Three consecutive exact `test:zk764:perf` processes pass the unchanged 3-second product budget. Full Vitest, focused browser regressions, TypeScript, lint/i18n, and production build/audits pass; initial JavaScript is 1,608,508 bytes, 211 bytes under the fixed ceiling.

## 2026-08-06 — ZK-724 finite reward entitlements complete

- Started from the exact isolated base `2d7432a514b5621a8c1cccdf4b1543106b239fcb` on `codex/zk724-reward-entitlements`; the original prompt above remains preserved.
- Added authored, finite reward entitlement contracts with explicit unlock gates, transferability, quantities/remaining value, consumption history, granting-person/match provenance, and Player Pro save normalization.
- Added deterministic authored-hook grant authority, scoped plant/service consumption, entitlement transfer, licensed casino-host capacity grounded only in an authored holding, safe failure when a hook/holding/downstream scope is unavailable, and bounded idempotency ledgers. Instructor technique IDs and tailor profile-style IDs survive save/reload; the tailor package grants both its authored garment and a non-transferable style entitlement.
- Integrated biome-appropriate plant stock with ordinary obstacle/decoration placement: one unit waives installation exactly once while player planting provenance keeps existing care, water, seasonality, removal, and salvage economics active. If the deferred reward consumer has not loaded, placement safely follows the ordinary paid path. Added visible remaining quantities/value in Player Pro.
- Focused validation passed: TypeScript, ZK-724 plus adjacent inventory/people/equipment/Player Pro/save/economy coverage at 7 files / 82 tests, and lint/i18n with 0 errors and the 12 existing hook warnings. Post-review full `test:ci` passed at 172 files / 1,352 passed plus one intentional skip, followed by the 5/5 audio audit.
- Two final consecutive production builds were identical at 1,608,452 initial JavaScript bytes, 267 bytes under the unchanged 1,608,719-byte ZK-680 ceiling. Biome, exact audio manifest, service-worker/offline assets including the deferred reward chunk, M35 residency, Parkland 4x, initial-critical, surface, delivery, startup, and fixture budgets all pass. The compact Player Pro load boundary rejects truthy malformed reward entries before UI/placement consumers, and transferred finite rewards remain active for their new owner while retaining transfer history.
- The bundled web-game client completed two Quick Start iterations. `/private/tmp/zk724-browser/shot-1.png` was visually inspected, structured state at `/private/tmp/zk724-browser/state-1.json` reports a live Parkland game, and no console/page-error artifact was produced. Match settlement/rematch integration remains intentionally outside ZK-724 for the ZK-725 authority.

## 2026-08-04 — ZK-680 initial JavaScript recovery in progress

- Fresh lease `codex/zk680-zk716-budget-split` starts at `origin/develop` `5a9acc6`; no inherited worktree changes were present.
- Baseline production build delivery evidence measured `initialJavaScriptBytes` at 1,600,315 B, already 8,404 B below the pinned 1,608,719 B reference. The task still requires a structural split to leave room for the independently verified ZK-716 persistence patch.
- Deferred the optional Live Overview, weekly report, Property Management, Living Club, and Seasons & Legacy App-routed panels with the existing `DeferredSurface` accessible loading/error/offline boundary. The core Pixi/game loop and persistence/competition modules remain untouched.
- Final production build (which includes TypeScript), biome/audio/asset/surface audits, and ZK-680 delivery evidence pass. `initialJavaScriptBytes` is 1,517,006 B: 91,713 B below the 1,608,719 B reference and 83,309 B lower than this lease's 1,600,315 B pre-change build. The five new deferred chunks are 9.72–38.23 kB raw and offline injected with the rest of the app assets.
- Focused property/contextual/weekly-report browser routes were exercised; the bundled browser client reached a valid 220×140 Parkland game after a right/pause/space action burst. Its temporary capture was visually inspected, `render_game_to_text` reported the live game, and no error JSON was produced. Lint/i18n passes with the 12 pre-existing hook warnings; full Vitest completed without a source failure.
- Generated route captures and build/audit artifacts were restored or removed. No persistence/save/schema/competition, frame-loop, or budget-configuration changes were made. Ready for the ZK-716 persistence patch to integrate against this budget headroom.

## 2026-08-03 — ZK-674 biome-safe terrain atlas lookup complete

- Replaced renderer texture lookups that implicitly read the globally active atlas with strict `(biome, quality, frame)` lookup paths for terrain, terrain detail, props, structures, and seasonal frame overlays. Cached bundles may remain resident, but a renderer can no longer borrow the currently active Links/Parkland bundle while drawing a Desert course or drop into that bundle's legacy fallback during a rebuild.
- Retained the one-argument Design Dock compatibility path exactly (active seasonal overlay → active bundle → legacy fallback), without touching Design Dock files or behavior.
- Added deterministic atlas-cache regressions covering Parkland-high followed by Desert-low residency, wrong-biome rejection, and terrain/detail/prop selection. Added a real-browser Desert slow/rapid zoom regression using a high-quality seasonal fixture; assets and browser console remain clean. Existing M21 coverage continues to exercise all primary biomes and four rotations.
- ZK-327 was checked read-only and is related but not a prerequisite: ZK-674's cache ownership defect is entirely in the already-present atlas/render paths.

## 2026-08-03 — ZK-703 tutorial camera reconciliation complete

- Removed the silent `ARCHITECT` override from ninth-hole durable-progress reconciliation. The new pure `reconcileTutorialSession` preserves the restored or player-selected `COZY`/`ARCHITECT` camera mode while advancing tutorial progress.
- Focused M14 unit coverage passes (12/12), along with TypeScript and lint (zero errors).
- Real M14 B evidence preserved final-hole camera equality, 9/9 valid holes, 36 scheduled arrivals with one golfer on course, graduation, reload, and tutorial rerun. Broader rerun coverage then stopped on the distinct ZK-704 case: Watch Golfers can remain disabled after all 36 completed rounds; no ZK-704 behavior is included here.

## 2026-08-02 — ZK-633 sidehill curvature implementation in progress

- Added one authoritative handedness-aware sidehill/intentional curve resolver. A one-step cross slope scales with airborne shot length and caps at `min(1.25, 0.35 + shotLengthTiles * 0.04)`; combined natural and intentional shape stays within 2.75 tiles.
- Player Pro freezes handedness at round start and uses it for caddie analysis, exact preview, commit, active-save normalization, and retained shot-slope evidence. Live golfers derive the same stable identity from the already-persisted capability seed, without new save state.
- Right/left draw and fade now mirror, above/below-feet lies curve in the correct player-relative direction, matching shapes amplify, opposing shapes offset, every non-putter club family consumes the effect, and putters/flat normal shots remain unchanged.
- Final validation passes: 149 Vitest files / 1,159 tests with one intentional skip plus five audio-audit tests; production build and all asset/delivery budgets; lint/i18n with zero errors and 12 existing hook warnings; `git diff --check`; and the required bundled web-game client through Quick Start. Its structured state reached a valid 220×140 Parkland game without a console-error artifact, and the final course renderer capture was visually inspected.
- No new blocker or distinct follow-up issue was discovered. ZK-633 is ready for coordinator review and integration; Linear, commits, pushes, and production were intentionally left untouched.

## 2026-08-02 — ZK-640 automatic putting in progress

- Added the deterministic automatic-putting authority, attached its immutable result to Player Pro/live green arrivals, and made the result add 1–3 putts and complete the hole without manual input.
- Preview exposes only an unseeded expected-putts explanation; committed evidence retains leave, break, pace, pin difficulty, moisture, wear, skill, consistency, and seed for save/resume parity.
- Focused resolver, Player Pro, and live parity tests pass (27 tests), along with TypeScript. Browser/client validation and full regression remain pending.
- Final local validation: focused resolver/Player Pro/live suite (27 tests), Player Pro browser regression, TypeScript, lint/i18n (0 errors; 12 existing hook warnings), production build/audits, and diff check pass. The browser capture visibly shows the completed-round ruling card with the automatic-putting evidence. Generated test/build artifacts were restored after inspection.

## 2026-07-30 — ZK-568 seasonal vegetation implementation complete

Current request: Implement ZK-568 without committing or pushing; keep subjective visual/gameplay validation deferred.

- Added one deterministic seasonal-plant presentation resolver driven by the authoritative daily biome phenology/weather state, stable semantic plant or same-biome species identity, ecological fit, cultivation, elevation, and water proximity.
- Authored selective leaf-out, blossom, mature, autumn-color, leaf-fall, dormant, evergreen, wind-exposed, and dry treatments across canopy, shrub, flower, and ground-cover forms. The resolver preserves the immutable base frame and shared obstacle/decor entity, using bounded continuous tint, silhouette, alpha, shadow, and sway transforms with stable positional distribution.
- Added explicit deciduous, evergreen, flowering, coastal-heath, drought-deciduous, and succulent profiles to the natural-prop registry. Rocks remain non-plant and untouched.
- Wired authored course obstacles, semantic planting decorations, and scenic-surround vegetation through the same resolver. Player plant IDs from ZK-646 remain authoritative; generated species use their same-biome base-frame identity. Missing climate/optional seasonal content falls back to the unchanged base presentation.
- Added a complete scene signature and renderer dependencies so a same-mounted daily/seasonal transition invalidates obstacle, decoration, and scenic prop caches. Seasonal base alpha now survives the existing golfer-occlusion fade loop. Continuous from/to phenology weights drive rendered tint and silhouette, so a categorical phase-label handoff does not create a treatment pop.
- Final verification passes: focused ZK-568 and adjacent phenology/registry coverage, 6 files / 35 tests; full Vitest suite, 133 files / 1,039 passed with one intentional skip; production TypeScript/Vite build plus biome/audio/asset audits; scoped ESLint with zero errors and eight existing PixiStage hook warnings; `git diff --check`; and two final bundled web-game client iterations reaching a valid 260-prop spring Parkland gameplay state with authoritative phenology and no client failure.
- Machine screenshots were generated to `/tmp/zk568-web-game-final` but not visually inspected, honoring the deferred human-validation gate.
- Subjective foliage authenticity, painterly quality, visual popping/readability, device/GPU behavior, and hands-on gameplay validation remain intentionally deferred to the final human gate.
- Protected concurrent work under `docs/REAL_HOLE_IMPORT_AND_BLUEPRINTS.md` and `src/game/holeTemplates/` was not inspected or modified.

### Independent-review repairs

- Split Links hawthorn from evergreen/coastal-heath vegetation with a `coastal-deciduous` profile. It now consumes authoritative foliage/dormancy transitions while retaining exposed Links tint, silhouette, bloom, and sway behavior; a winter matrix proves selective hawthorn leaf-fall/dormancy while wind pine and gorse remain evergreen/heath.
- Player provenance is now an independent cultivation authority. A player-authored obstacle far outside every building halo remains cultivated, while generated/natural vegetation still uses the building-proximity rule.
- The seasonal plant scene signature now includes foliage `from`, `to`, and the exact transition blend consumed by rendering. A same-mounted, same-day, weather-unchanged regression proves that changing only the blend invalidates the signature.
- Post-review verification: 4 files / 26 tests, TypeScript, scoped ESLint with only the eight existing PixiStage warnings, and `git diff --check` pass.

## 2026-07-30 — ZK-646 biome economics and planting semantics complete

Current request: Implement and verify ZK-646 without committing, pushing, or changing Linear; leave subjective visual/gameplay validation deferred.

- Added a complete, audited biome-economy contract for Parkland, Links, and Desert covering terrain construction/upkeep, earthworks, drainage, water scarcity and seasonality, natural-feature clearing/salvage, and native/adapted/imported plant fit. Five future-biome seed profiles resolve to complete inherited contracts without registering unfinished biomes.
- Added 15 stable semantic plant IDs with obstacle/decor meaning, seasonal phenology, ecological fit, installation scale, recurring care and water demand, safe visual fallbacks, and registry audits.
- Routed terrain, earthwork, obstacle, decoration, natural-feature, drainage, irrigation, live-day, weekly, condition, report, Golfopedia, cursor-preview, and architecture-recommendation economics through shared quotes. Difficulty is applied once at the outer cost layer, including exact AI recommendation construction estimates.
- Preserved generated-land economics: untouched estate terrain and natural/generated vegetation carry no player installation or recurring plant cost; clearing has no speculative refund. Explicit player planting receives biome-fit installation, care, water, and bounded salvage economics.
- Replaced the old flat daily operating charge with a deterministic breakdown based only on already-published seasonal weather/forecast state, maintained authored area, player plantings, irrigation policy, drainage, biome, season, and run difficulty. Parkland/Balanced retains the exact $42 neutral irrigation reference.
- Added save schema v24, bounded/idempotent migration, hostile-data sanitization, and package round-trip coverage for semantic plant identity and provenance. Ambiguous legacy planting decorations migrate conservatively as natural rather than inventing player ownership.
- Exposed the shared water/plant/drainage breakdown in daily and weekly ledgers, HUD, week-close reporting, and help content; weekly aggregation and live-day settlement use the same quote path without additional RNG or weather generation.
- Verification passes: focused ZK-646 coverage, 12 files / 97 tests; full Vitest suite, 132 files / 1,029 passed with one intentional skip; production TypeScript/Vite build plus biome consumer/audio/asset audits; lint/i18n with zero errors and 12 existing hook warnings; authored-biome audit (`fe4e46804937244e3ccd5bc15fd9bd0930cefdd8f579aa6821aeb8979e1a9d50`) with all nine payloads within budget; and the full 81-run × 104-week balance matrix with zero normal-path bankruptcies and first normal profit by week 2. `git diff --check` passes.
- A final read-only comparison against the Linear description and its sole kickoff comment found no incomplete written implementation or machine-verification acceptance criterion; Linear was not modified.
- Subjective climate authenticity, landscaping readability, accessibility, browser/GPU rendering, and hands-on gameplay balance were intentionally not assessed in this pass, per request.
- Concurrency integration note: the protected untracked real-hole import document and `src/game/holeTemplates/` work were not modified or included. Their private call sites remain outside this tracked ZK-646 baseline and do not block its acceptance.

## 2026-07-24 — ZK-444 estate-wide Links coastline fix in progress

Current request: “ok lets go fix that please”

- Confirmed fresh-game generation created a 220×140 natural estate and then overwrote the centered 110×70 starter property with a second independently generated map.
- Removed the starter-map terrain/elevation/obstacle splice so every parcel now inherits one estate-wide natural baseline.
- Expanded Links coastline depth variation so some full-estate seeds reach the central starter property while others remain inland, without making the starter generate its own ocean.
- Added focused regression coverage for exact estate-baseline inheritance and edge-connected ocean continuity across the starter-property boundary.
- Focused new-game, theme, estate, and scenic-surround verification passes: 30 tests.
- Added a seed-selectable M25 browser fixture and pinned the scenic Links regression to seed 25, where the starter parcel includes estate-generated ocean.
- The dedicated scenic-surround Playwright test passes; full-page overview and edge captures were inspected and show one continuous estate/regional coast with no starter-map rectangle.
- The required bundled web-game client reports valid Links estate state with a water-bearing starter parcel and no console-error artifact. Its headed minimap capture was inspected; the direct main-canvas headless capture remains black under software WebGL, while the full-page Playwright renderer capture is correct.
- Final verification passes: 70 Vitest files / 441 tests with one intentional skip, production build and asset audits, lint/i18n with seven existing hook warnings and no errors, `git diff --check`, and the focused scenic-surround browser regression.
- After the first deployment, confirmed the reported screenshot was an untouched schema-v18 save restoring the pre-fix 110×70 overlay rather than a stale deployment: a clean live seed-25 Links course already rendered one continuous estate-wide coast.
- Added save schema v19 and estate generation v2. Loading an untouched v18 Links estate now regenerates its natural terrain, elevations, and immutable baseline from the original seed while retaining its obstacles and clubhouse. The upgrade is gated by exact baseline equality, empty hole geometry/decorations, clubhouse-only construction, and starter-only ownership, so authored terrain and developed courses remain unchanged.
- Added migration regressions for both automatic repair and authored-terrain preservation. Final migration verification passes: 70 Vitest files / 443 tests with one intentional skip, production build and asset audits, lint/i18n with seven existing warnings and no errors, and the required bundled-client Links render/state check at estate generation v2 with no console errors.

## ZK-444 remaining

- None. The code fix and automated/visual regression coverage are complete.

## 2026-07-24 — Golden-path save/reload CI repair

- Reproduced the pushed GitHub Actions failure locally and inspected the Playwright trace; there were no browser console or network errors.
- Queried the failed slot through `loadSlotResult` and isolated the rejection to `INVALID_COURSE: Stable hole identities are missing or duplicated`.
- Fixed M39 automation to return the fully normalized course rather than combining normalized layouts with the original ID-less holes.
- Added regression coverage that advances the exact legacy QA course and validates the resulting current-schema save.
- Verification passes: focused seasons/save tests (17), exact `npm run test:e2e:golden` workflow (9), full Vitest suite (432 passed with one intentional skip), production build, lint/i18n with seven existing warnings and no errors, and bundled-client structured gameplay state.

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

## 2026-07-24 — PixelLab Art Pipeline Pilot

Current request: Implement the `PixelLab Art Pipeline Pilot` milestone.

- Added a secret-safe, ignored PixelLab staging boundary, a tracked provenance manifest/schema, reusable prop/facility/golfer prompt contracts, and a pinned `mcp-remote@0.1.38` setup guide. The credential pasted during planning is treated as compromised and was not reused; live PixelLab generation requires a rotated `PIXELLAB_AUTH_HEADER` and a Codex restart.
- Added `art:pixellab:doctor`, `art:pixellab:validate`, and `art:pixellab:certify` commands. Validation covers hashes, PNG dimensions/alpha/anchors, animation grid contracts, review states, prompt references, benchmark completeness, and secret hygiene.
- Added deterministic candidate normalization and isolated one-frame atlas preview tooling. Production sprite sources and production atlases are never modified during review.
- Generated a high-resolution cart-rental comparison candidate with the built-in image generator, normalized it to the existing 192×160 frame, and rendered it through an intercepted isolated atlas in the real M22 parkland scene. Overview and close-up captures are under `simgolf-lite/artifacts/pixellab-pilot/`; visual review found strong identity/readability but a softer, more painterly finish than the incumbent crisp sprites.
- Verification passes: 64 Vitest files / 401 tests with one intentional skip, including six focused PixelLab checks; the PixelLab manifest/benchmark validator; PixelLab Playwright atlas/render acceptance; production build; lint/i18n (seven pre-existing hook warnings, no errors); bundled-client fixture smoke; and the 36-hole/100-golfer performance check at 0.31 ms renderer work against the 8 ms budget.
- The first repository-wide Vitest run overlapped a concurrent M38 commit and observed one stale living-club assertion. The focused test and complete suite both pass after the working tree stabilized.

## PixelLab pilot remaining

- Rotate/revoke the exposed PixelLab token, export the replacement as `PIXELLAB_AUTH_HEADER`, configure the documented MCP block, and restart Codex.
- Generate and review the three facility treatments, natural props, and idle/walk/swing golfer sheets; promote only reviewed candidates through the manifest.
- Run the same-target PixelLab/Layer-or-Scenario comparison, finish the weighted benchmark and adoption matrix, then pass the strict `art:pixellab:certify` gate and close the remaining Linear issues.

## 2026-07-25 — ZK-446 terrain paint connected-fill bug

Current request: open and deeply document the terrain-painting bug before implementing it.

- Inspected the supplied playtest screenshot and traced the current Curve/Area pipeline through pointer capture, surface-intent construction/rasterization, terrain economics, persistence, contour extraction, and Pixi rendering.
- Confirmed Curve always becomes a fixed-width Catmull–Rom corridor, Area receives a deduplicated integer-tile ring, and same-terrain features are rendered independently. The pipeline has no near-loop closure, bounded connected fill, topology repair, or shared accepted mask for preview/commit/rendering.
- Opened High-priority M35 bug ZK-446, “Terrain paint strokes snake instead of filling connected areas,” as a child of ZK-326. It blocks M35 certification (ZK-332), relates to continuous terrain rendering (ZK-327), and includes a deterministic mask-first implementation design plus complete acceptance coverage.
- Attached the user's screenshot to ZK-446.
- No application code was changed. Next step: implement and verify ZK-446 without disturbing the unrelated dirty worktree.

### ZK-446 implementation underway

- Terrain gestures now retain ordered elevation-aware sub-tile samples instead of deduplicated integer cells.
- Replaced uniform spline sampling with centripetal Catmull–Rom to avoid tight-turn loops/cusps.
- Added deterministic 4× mask rasterization: Curve uses a swept corridor with pinhole/small-gap repair; Area rasterizes its closed boundary and exterior-fills every enclosed pocket.
- The shared raster result now yields both authoritative tile coverage and validity-clipped render rings. Terrain previews expose accepted cells, and commits persist rings clipped to valid/owned/unlocked coverage.
- The smooth renderer now unions accepted coverage per terrain before drawing mask detail, uses full-opacity overlap-safe fills, and cuts nested holes instead of outlining every stroke independently.

### ZK-446 verification complete

- Optimized rasterization to visit only each path segment's local subcell bounds, avoiding whole-mask × whole-path work during drag previews.
- Added unit coverage for imperfect and self-crossing Area loops, open Curve loops, 4-neighbor repair, validity clipping, persisted render-ring normalization, accepted unchanged cells, and shared same-terrain contours.
- Added a browser regression that paints a real Area gesture, proves the committed mask is one filled 4-neighbor component rather than a perimeter snake, and verifies exact undo/redo plus quick-save/load round trips.
- Visually inspected the rounded Area result and curved corridor result. The required bundled client reached the game with valid structured state and no captured errors; its software WebGL screenshot remained black, so visual acceptance used Playwright's browser screenshots.
- Verification passes: 70 Vitest files / 449 tests with one intentional skip; focused Curve/Area Playwright plus the ZK-446 save/load scenario; TypeScript; production build/audio/offline-asset audit; lint/i18n with seven existing Hook warnings and no errors; and `git diff --check`.

## ZK-446 remaining

- None for the requested connected-fill terrain painting fix.

## 2026-07-25 — SimGolf-style terrain material correction

Current request: use the supplied SimGolf references to replace the still-flat terrain presentation with coherent tile-based materials, scope the work as Linear subissues, and implement it.

- Inspected all four supplied references. The reusable composition principles are continuous mowing fields, restrained deterministic material variation, crisp single-owner fringes/lips/shorelines/shoulders, and enough natural detail to absorb the grid. No reference pixels or game assets will be copied.
- Traced the mismatch to M35's `smoothSurfaces` compositor: it hid the existing M19/M21 material registry by replacing authored cells with surrounding underlay tiles and painting opaque solid polygons.
- Added dependency-ordered ZK-327 subissues: ZK-460 restores authored material composition; ZK-461 makes textures/mowing coherent across components; ZK-459 adds pair-aware blended edges; ZK-458 certifies themes, rotations, interactions, and performance. Attached the four user references and documented the code diagnosis on ZK-327.
- Replaced the opaque surface compositor with material-clipped intent rendering: each persisted 4× feature mask now reveals the same themed terrain atlas, deterministic texture variation, mowing tint, slope tint, and animated water used by ordinary tiles. Exact accessibility patterns keep their direct tile path.
- Anchored fairway/green/tee mowing to a broad world-space field aligned with the active hole, and replaced per-cell random water animation with a low-frequency shared shimmer phase so connected regions read as one material instead of a quilt.
- Replaced numeric transition priority with semantic pair ownership for shorelines, bunker lips, path shoulders, maintained-turf fringes, and natural feathering. Feature-ring outlines sample authoritative terrain on both sides and suppress internal seams between touching regions of the same material.
- Added focused unit coverage for mowing continuity, semantic edge symmetry, and neighboring-water phase; added ZK-460 browser coverage for real painted-region persistence and material captures; made the legacy M19 visual spec enter Photo mode through its documented keyboard shortcut.
- Visually inspected Parkland, Links, and Desert at four rotations plus detail zoom, the curved-water fixture, and real fairway/sand Area gestures. The result keeps the deliberate tiled SimGolf character while connected regions share coherent texture fields and sub-tile silhouettes instead of opaque flat washes.
- Verification passes: TypeScript; 72 Vitest files / 461 passed with one intentional skip; production build; strict-CSP PWA/offline/save smoke; performance smoke at 0.278 ms renderer work against the 8 ms budget; M19/M20/M35/ZK-446/ZK-460 browser coverage; scoped ESLint with only three pre-existing Pixi cleanup warnings; and `git diff --check`. The repository-wide lint command is presently blocked by untranslated strings in the separate in-progress bug-report dialog. The required bundled client reported valid structured state and no captured errors; both headless and headed direct-canvas captures remained black under software WebGL, so visual acceptance uses the successful Playwright renderer screenshots.

## 2026-07-25 — ZK-447 direct tee/pin map placement in progress

Current request: “ok lets implement the fix”

- Removed player-facing X/Y inputs and Save/Map controls from Tee & Pin Setup.
- Replaced them with explicit Place/Move-on-map actions, placed/not-placed status, and map-placement guidance with visible Cancel/Escape support.
- Invalid map selections now keep placement mode active and surface the validation reason instead of silently ending the interaction.
- Removed tile coordinates from tee construction confirmation while preserving exact cost/salvage, validation, and persisted point data internally.
- Updated M23 browser coverage to exercise direct tee and pin map placement and assert coordinate inputs are absent.
- Verification passes: 70 Vitest files / 449 tests with one intentional skip, production build and audio audit, lint/i18n with seven existing Hook warnings and no errors, two focused M23 Playwright scenarios, the required bundled web-game client, and `git diff --check`.
- Visually inspected the complete setup inspector plus the live invalid-pin placement prompt. The UI exposes only Place/Move/Remove controls, map guidance, placement state, and validation feedback; no X/Y or tile coordinate entry remains.

## ZK-447 remaining

- None for the requested tee/pin coordinate-entry fix.

## 2026-07-25 — M45 closed-loop bug capture and repair implementation complete; external certification on HOLD

Current request: implement the complete `M45: Closed-Loop Bug Capture & Repair` milestone.

- Re-audited the existing M45 milestone, its ten dependency-ordered issues, the current Cloudflare static-assets deployment, Sentry sanitizer, React crash boundary, reducer dispatch boundary, PWA/build checks, and unrelated dirty worktree.
- Added the shared `BugReportV1` contract with explicit source/severity/environment enums, byte and string limits, consent gates, safe deterministic context, and typed validation failures.
- Added a strict allowlist sanitizer that constructs a fresh output object and cannot emit full saves, cookies, tokens, headers, query strings, arbitrary local storage, nonconsented diagnostics, or nonconsented screenshots.
- Added ZK-675 bounded unhandled-rejection diagnostics: the Sentry generic global handler is disabled, first-party capture emits only fixed `window-unhandledrejection` and rejection-shape markers, and arbitrary rejected values are normalized before either local draft or Sentry handling.
- Added a memory-only bounded diagnostic recorder for safe game context, reducer action names and scalar fields, React/window/unhandled-rejection errors, app build identity, route path, browser family, and viewport. New-game/load clears the historical action ring; no report data is persisted locally.
- Created the Linear workflow labels `autofix-ready`, `needs-repro`, `reporter-verified`, and `needs-human-review` with explicit safety semantics. ZK-448 and ZK-449 are now In Progress.
- Added the consent-first in-game and crash reporter: feature-gated launcher and shortcut, accessible focus-contained dialog, exact payload/diagnostic previews, separate screenshot and diagnostics consent, renderer-only PNG capture, offline/timeout/cancel/retry handling, and canonical Linear success links.
- Added a same-origin Cloudflare Worker intake with fail-closed runtime flags, origin/content/body/rate validation, server-side sanitization and fingerprinting, two-level Durable Object sharding, exact idempotency, duplicate occurrence comments, completed/canceled regression issue creation, and explicit stop-on-ambiguous-external-mutation behavior.
- Added private evidence processing that structurally validates PNG chunks/CRCs, strips metadata, attempts Linear's private upload flow, and falls back to text-only reporting on an explicit provider rejection. Screenshots are never placed in public/static storage.
- Added the allowlisted Sentry-group route with shared dedupe/issue semantics and a configurable minimum occurrence threshold.
- Added the guarded Linear-to-Codex dispatcher. It requires the canonical marker, `autofix-ready`, complete reproduction/acceptance evidence, safe file scope, trusted attachments, and an allowlisted human `/autofix approve`; execution claims a remote branch, uses an isolated worktree and secret-filtered environment, reruns install/test/build/lint, and can only push a branch plus draft PR.
- Added the M45 operational runbook, privacy/retention/incident/kill-switch policy, repair-result schema, certification manifest, and machine-readable HOLD/GO report.
- Hardened the fingerprint contract against cross-seed merges, added transient-versus-ambiguous mutation recovery, authenticated operator reconciliation, deleted/archived canonical recovery, concurrent submission convergence, conservative authentication/access-control exclusions, workflow-state fallback, Markdown escaping, and realistic Sentry payload-shape handling.
- Verification passes: 78 Vitest files / 495 tests with one intentional skip; 25 Worker unit tests plus six workerd/Durable Object integrations; ten dispatcher policy tests; six M45 Playwright scenarios; production build; application/Node/Worker TypeScript; lint/i18n with seven pre-existing Hook warnings; strict-CSP PWA install/offline/save smoke; staging Wrangler dry-run; `git diff --check`; and the 36-hole/100-golfer performance smoke at 0.27 ms renderer work against the 8 ms budget.
- Visually inspected the manual and controlled React-crash reporter via Playwright and the required bundled game client. The dialog is readable, keyboard-ready, clearly explains privacy defaults, keeps optional evidence unchecked, and remains available outside the failed React tree.

## M45 certification remaining

- Deploy the Worker to staging with `LINEAR_API_KEY`, `SENTRY_WEBHOOK_SECRET`, and `BUG_REPORT_OPERATOR_SECRET` configured, then record a real manual-report golden path and its private Linear evidence.
- Route a real allowlisted staging Sentry group through the intake and record the resulting Linear issue/comment behavior.
- Add `autofix-ready` to a purpose-built safe staging issue, obtain a separate allowlisted human `/autofix approve`, and record the dispatcher-created draft PR. Human review, merge, deploy, verification, and issue closure remain deliberately outside automation.
- Keep the milestone certification decision at `HOLD` until those three provider-backed records exist and the release candidate is committed from a clean workspace.

## 2026-07-25 — whole-tile terrain depth and biome-detail pass

Current request: move closer to the supplied classic course-builder references while keeping whole-tile geometry, then add recessed water, raised bunker lips, rounded hill cues, differentiated rough/deep rough, Links fescue, and waste-area detail.

- Expanded the ZK-327/ZK-329 Linear plan with ZK-462 through ZK-467, including a dedicated relief issue for visual-only surface insets and biome-scaled hill caps. No simulation elevation, save payload, course hash, collision, or terrain economics changed.
- Made whole-tile terrain the only visible render geometry; persisted Curve/Area intent remains editor/save metadata and paint preview outlines the exact accepted tile set.
- Added directional presentation depth: water sits 5 px below ground, wetland 3 px, and bunker sand 2.5 px. Single-owner bank faces bridge recessed surfaces, and bunker/shore atlas lips remain on the surrounding ground plane.
- Added deterministic rounded elevation-cap cues, strongest for Links dunes and restrained for Parkland/Desert, while preserving the existing cliff ownership and all four rotations.
- Added an @2× terrain-details atlas and typed deterministic registry across all themes. Ordinary rough uses short broken grass, deep rough uses taller growth, Links deep rough uses dedicated fescue, waste uses pebbles/scrub, and edge-aware reeds, shoreline stones, and bunker tufts clarify hazards.
- Reduced mowing contrast and broadened world-space bands so maintained terrain reads as a continuous field instead of alternating light/dark diamonds. Re-authored material microtexture and transition bands with stronger shore/bunker/path semantics.
- Ran an isolated PixelLab pilot for short rough, Links fescue, waste dressing, plus fairway/rough/sand base tiles. All six outputs were preserved with hashes and rejected in the existing manifest: detail candidates were too saturated or stamp-like, while base tiles were thick 64×64 blocks rather than seamless 128×64 top surfaces. The deterministic CourseCraft atlas remains production truth.
- Added focused unit coverage and a three-theme Playwright relief suite. Verification passes: 80 Vitest files / 502 tests with one intentional skip; production build; lint/i18n with seven existing Hook warnings and no errors; strict-CSP PWA/offline/save smoke; PixelLab manifest validation; three-theme relief, M19, and material-composition browser coverage; bundled-client structured state with no captured errors; performance smoke at 0.24 ms renderer work against the 8 ms budget; and `git diff --check`.

## 2026-07-25 — organic hazards and grounded natural detail

- Water/wetland painting now grades a flat authoritative basin, charges the
  exact earthwork in the paint transaction, and clears covered dry-land props.
  New trees/bushes/rocks are rejected on wet terrain; protected trees clip a
  land island from the wet mask.
- Connected edge rendering now supplies fairway/bunker rough collars, green
  fringe, deep-rough feathering, and capped rocky water banks.
- One-cell bunkers use stable kidney/pot silhouettes; connected bunkers merge
  into scalloped organic outlines over a rough underlay, eliminating exposed
  square sand corners.
- Species-aware tree habitat adds pine straw, broadleaf leaf litter/soil, and
  desert dry-soil beds with bounded deterministic detail.
- Verification passes 88 Vitest files / 545 tests with one skip, TypeScript,
  lint/i18n, production and asset audits, strict-CSP PWA/offline smoke, M20
  theme/rotation/detail coverage, the water atomicity/save regression,
  performance smoke, the required bundled client, and `git diff --check`.

## 2026-07-25 — M35 testing handoff checkpoint

- Current source and evidence remain uncommitted on `develop`; base candidate
  is `6944abe`. Preserve unrelated dirty files, especially the pre-existing
  deleted `.github/workflows/deploy.yml`, until the handoff agent scopes a
  deliberate M35 commit.
- Current gates: 88 Vitest files / 552 passed / 1 skipped; TypeScript; lint
  with no errors and 11 existing Hook warnings; production build, exact audio
  audit, service-worker injection, and M35 asset budgets; strict-CSP PWA,
  offline reload, and local-save smoke; 1.08 ms renderer work in performance
  smoke; and `git diff --check` all pass.
- The complete M14 reload/resume/rerun onboarding path passes in 11.5 minutes.
  The keyboard/save-load case passes in isolation. The remaining M17, M27, M6,
  and M7 isolated reruns were interrupted and must not be reported as passed.
- Latest fixes include in-place Pixi adaptive-resolution resizing and debounced
  tutorial autosave status. See `simgolf-lite/docs/M35_CERTIFICATION.md` for
  the exact next commands and the ZK-473/ZK-466 release gates.

## 2026-07-30 — M50 machine-only certification gap closure in progress

Current request: close the machine-verifiable ZK-553 certification gaps for
ZK-539, ZK-540, ZK-548, ZK-549, ZK-550, ZK-551, and ZK-552 without performing
or claiming human visual, accessibility, balance, provider, physical-device,
or release-owner checks.

- Confirmed a clean `develop` checkout at promoted commit
  `1010f1f0880ba5460573ba198a64e2cbb81011eb`.
- Read the exact Linear acceptance criteria without changing issue state.
- Baseline focused M50/rules/live/save/player test slice passes: 13 files and
  81 tests.
- The existing harness covers the core rules artifact, but its certification
  evidence is still representative for preview parity and migration, does not
  aggregate hostile M50 trace normalization or explicit round-loop bounds, and
  labels an 84-tile-wide fixture as full-estate performance.
- Planned scope is limited to shared hostile-payload validation, deterministic
  certification fixtures, a true 220×140/36-hole/100-golfer scale check, and
  the missing machine-only certification document.

### M50 machine-only packet finalized on HOLD

- Added strict runtime validation for persisted M50 flight, collision, ruling,
  relief, and final-position evidence. Malformed optional live evidence is
  dropped without losing its legacy shot; malformed active Player Pro evidence
  invalidates only the resumable round and preserves completed history.
- Expanded the deterministic M50 harness for five-case preview/execution
  parity, three historical round kinds plus match/tournament/campaign and
  Return-to-Design migration, six hostile active-round inputs, legal relief
  invariants, bounded direct/match/tournament/AI rounds, and a true
  220×140/36-hole/100-golfer scale fixture.
- Focused result: 14 files, 89 passed, 1 failed. The only failing check is
  `bounded-player-ai-rounds`: outcomes are finite, valid, deterministic,
  capped at 240, and per-hole bounded, but at least one follow-up starts from a
  water/wetland/OB lie.
- Production build, TypeScript, audio manifest, service-worker injection, M35
  asset budgets, and Parkland 4× contract audit pass.
- Recorded commands, promoted base
  `1010f1f0880ba5460573ba198a64e2cbb81011eb`, integration-commit placeholder,
  limitations, proposed follow-up, and machine-only HOLD in
  `simgolf-lite/docs/M50_CERTIFICATION.md`.
- No visual, accessibility, human balance, listening, provider,
  physical-device, release-owner, Linear mutation, push, or deploy action was
  performed.

### M50 ZK-551 machine blocker repaired

- Traced the illegal strategic follow-up to inconsistent tile sampling:
  controlled rules use the fractional coordinate's containing tile, while
  Player Pro/live lie sampling rounded to a neighboring tile.
- Aligned Player Pro outcome lies and live strategic terrain sampling with the
  rules engine's containing-tile convention; ruling, relief ordering,
  penalties, scoring, deterministic ordering, and loop bounds are unchanged.
- Added a deterministic boundary regression that reproduces a fairway rest
  adjacent to water and verifies the next strategic shot begins from a
  playable lie.
- Focused M50 result: 1 file and 3 tests passed in 37.66s.
- Relevant Player Pro/live/tournament result: 7 files and 73 tests passed in
  36.00s.
- Updated `simgolf-lite/docs/M50_CERTIFICATION.md` from machine-only HOLD to
  PASS. No new issue is needed; the repair is within existing ZK-551.

### M51 Wave 3 ZK-545 / ZK-546 / ZK-547 implementation

- Added deterministic one-mode-per-group walk/pushcart/riding-cart decisions,
  stable per-golfer seating and transaction order, exact fleet reservations,
  affordability/stockout/weather/facility/tournament fallbacks, service delay,
  idempotent reload/reconcile behavior, and release on completion, abandonment,
  or daylight.
- Applied selected modes to the shared live itinerary through the weighted
  travel router/cache. Actual travel now drives pace/daylight/blockage/marshal
  behavior, bounded off-path turf/fleet wear, and observed satisfaction evidence
  while protected surfaces and wet path-only rules use legal walking fallback.
- Added product-level rental revenue, operating cost, utilization, stockout,
  return/condition/wear settlement, exact daily/weekly reconciliation, bounded
  28-day histories, and one-time core concession charges with no generic Cart
  Rental duplicate.
- Final verification passes: 12 focused files / 98 tests, TypeScript project
  build, and `git diff --check`. The bundled web-game client entered a fresh
  live game with valid structured state; the gameplay capture was inspected
  and no console-error artifact was produced.
- No Linear, commit, push, deployment, or later-wave UI/demand work is included.

## 2026-07-30 — M51 ZK-558 machine-only certification

- Preserved the shared uncommitted M47–M51 implementation and generated artifacts.
- Focused baseline passes 19 files / 126 tests.
- Final certification found two scoped presentation-contract failures: the implemented mobility Architecture Review overlay was omitted from its selector, and the new mobility surfaces bypassed the typed localization catalog.
- Added the missing selector path, localized Architecture Review/Operate/Golfer Inspector mobility text, and added a pseudo-locale/machine-accessibility browser regression.
- Added fixed-seed strategy compatibility plus 220×140/36-hole/100-golfer route/live/render/save certification coverage. The focused M51 certification passes 2/2 tests in 43.98s; TypeScript and i18n guards pass.
- Human visual, accessibility, listening, gameplay-balance, physical-device/GPU, provider, browser-matrix, and release-owner checks remain deferred. No Linear mutation, commit, push, or deployment was performed.

## 2026-07-30 — M53 ZK-566 SeasonalVisualState query

- Added one transient, read-only SeasonalVisualState query over the existing
  M39 daily calendar/weather/modifiers, M52 climate phenology, M49 localized
  maintenance zones, and authoritative course/world condition inputs.
- The query exposes climate transition/progress, weather, moisture, firmness,
  turf health, wear, settled maintenance availability, projected burden
  priorities, active presentation layers, and renderer/audio inputs. Visible
  surfaces resolve on demand by four-zone and terrain keys; no per-tile or
  per-entity condition state is stored.
- Shared M49's localized quadrant aggregation with the query so reports and
  presentation use one projection. Query/zone caches account for tile identity,
  dimensions, biome, seed, full weather/climate outputs, drainage, condition,
  maintenance, and optional report inputs.
- App supplies the latest settled WeekResult. Exact maintenance requirement,
  budget, shortfall, and wear are used when available; otherwise the query
  reports unavailable nullable evidence and derives wear only from authoritative
  course condition. Missing evidence cannot create maintenance alerts/layers.
- Quadrants and surfaces are explicitly labeled projected maintenance priority
  from static relative burden, never localized observed condition history.
- App, Pixi, ambience, and structured text state now receive the query. ZK-566
  only supplies inputs and preserves existing weather/season ambience routing;
  new visual/audio modulation remains for later presentation tickets.
- Focused verification passes: 4 files / 35 tests, TypeScript project build,
  and `git diff --check`. Coverage includes determinism, reload, rotation and
  quality independence, cache identity/invalidation, dimensions/biome changes,
  non-persistence, shared report zones, audio handoff, and bounded surface
  lookup performance.
- The required bundled web-game client entered a fresh game and emitted the
  selected serializable SeasonalVisualState projection through
  `render_game_to_text`, with no console-error artifact. The corrected fresh
  projection reports maintenance unavailable, nullable requirement/shortfall,
  four baseline projected-burden priorities, condition-derived 0.25 wear, and
  only the phenology layer; its top-level weather/modifiers match the projection.
- A later full production-build attempt reached the biome audit, then stopped
  on concurrent ZK-379 `AtlasSeasonalOverlay.props/decals` type errors in its
  atlas/biome-authoring files. Those unrelated files were left untouched;
  ZK-566's standalone TypeScript pass was subsequently revalidated successfully
  after the concurrent edits settled.
- Subjective screenshot inspection and other human validation are explicitly
  deferred.

## 2026-07-30 — M53 ZK-379 seasonal art contract (machine phase)

- Added a registry-owned, phenology-inherited seasonal coverage contract for
  every Parkland/Links/Desert × spring/summer/autumn/winter × eight visual
  families. Every treatment has an explicit same-biome base fallback;
  Parkland is four-season, Links is exposed/muted, and Desert is
  drought/heat-led with no blanket-snow route.
- Extended atlas normalization to typed v3 seasonal ownership while retaining
  v1/v2 compatibility. Overlays declare biome, season, material fields, and
  isolated frame families for terrain details, natural props, buildings,
  decorations, construction, condition, and weather. Low remains base-only.
- Loader maps are isolated by family, optional failures keep the base active,
  stale requests cannot activate, and loaded base/overlay maps remain cached
  with a read-only residency snapshot. Seasonal natural-prop sheets can no
  longer shadow structure frames.
- The biome authoring audit now reports 96-cell contract completeness
  separately from optional art enrichment, validates typed overlay
  ownership/family/season/content hashes, and reports base + peak overlay
  payload plus cumulative residency budgets.
- Final focused ZK-379 result: 5 Vitest files / 27 tests pass. The M52/save
  compatibility regression passes 7 files / 70 tests, confirming the
  same-biome fallback metadata is not persisted or consumed by save/runtime
  compatibility. TypeScript, the scoped ESLint pass, production build and
  asset audits, and `git diff --check` pass.
- The scoped ZK-379 biome authoring CLI evidence lives under
  `artifacts/zk-379/` with explicit M53 provenance and zero required,
  seasonal-contract, or budget findings. Historical M35 and ZK-564 evidence
  was left unchanged. Current base-only selected payloads remain 2.17–3.51 MB
  against 6 MB, and cumulative residency remains below 12 MB.
- No seasonal renderer/art content from ZK-567/ZK-568/ZK-569 is included.
  Human visual/aesthetic/accessibility/device/listening validation remains
  explicitly deferred to the final phase; no Linear mutation, commit, push,
  promotion, or deployment was performed.

## 2026-08-02 — ZK-637 fine-green contract complete

- Added the authoritative sparse GreenSurfaceV1 contract: canonical row-major 4×4 signed fixed-point offsets relative to the existing frozen coarse elevation grid, strict package/snapshot validation, bounded save normalization, green-mask cleanup, canonical serialization/hash, and green geometry identity.
- Added receptive/balanced/championship/custom GreenProgram policy and canonical per-hole health, moisture, compaction, and wear state. Legacy v25 saves migrate to schema v26 with flat fine contours, balanced policy, healthy local state, unchanged A/B/C setups, and preserved M53 surfaceCare.
- Course packages now carry, validate, migrate, checksum, and remap green state. Active Player Pro rounds deep-freeze green geometry/program/local state and validate it on save/resume; course geometry versions include fine contours.
- Independent review tightened green geometry identity to include canonical dimensions and row-major coarse green coverage, so flat green additions/removals and grid-shape changes invalidate caches and snapshots even without sparse contour offsets.
- Verification: focused contract/save/package/round/hash/schema suites pass (8 files, 72 tests); TypeScript, scoped ESLint, and git diff check pass. A broader Vitest run was stopped without a surfaced failure so integration can run the full release suite.

## 2026-08-02 — ZK-681 real analysis Worker benchmark

- Added a real module Web Worker behind the existing revision-aware advisory
  job client. Transfer lists are explicit, superseded/cancelled responses are
  dropped, and `GameSession` teardown terminates the Worker.
- Benchmarked the existing architecture/routing analyzer and the existing
  shot-slope/tree-habitat analyzers on deterministic production fixtures in
  Playwright Chromium. Main/Worker digests match exactly; cancellation, stale
  revision rejection, teardown, and a 246,400-byte transferred elevation
  buffer are covered by machine tests.
- The committed report records 137.8 ms main-thread architecture analysis and
  12.0 ms slope/habitat analysis on this machine. Decision: adopt the persistent
  Worker for on-demand advisory architecture/heavy analysis only; keep the
  below-budget surface proxy and all authoritative work on the main thread.
- TypeScript, focused unit tests (4 files / 16 tests), real-Worker Playwright,
  production build/audits, and unsigned macOS arm64 package smoke pass. The
  packaged ASAR contains both Worker and benchmark chunks.
- Physical-device, long-session, and subjective human checks remain postponed.

## 2026-08-02 — ZK-638 fine-green sculpting and rendering

- Added a dedicated fine-surface authoring path over the v26 GreenSurface
  contract. Raise, lower, smooth, tilt, ridge, bowl, and flatten operate on
  shared 4×4 fixed-point nodes, clip to owned green coverage, retain one
  physical height across tile seams, clamp every offset, blend perimeter
  samples back to the coarse survey, and emit sparse canonical records.
- Fine earthwork is priced from exact changed fixed-point volume and commits
  atomically through the reducer. Terrain repaint/edit also normalizes the
  fine surface immediately, removing orphaned non-green records. Coarse and
  fine sculpt edits now enter the existing bounded full-course undo/redo stack.
- Added captured mouse and touch strokes with resampling, continuous affordable
  previews, Escape cancellation, one-release commits, live-region feedback,
  seven localized brush controls, and three radii. Structured game text and
  E2E diagnostics expose the selected brush/radius and shaped-tile count.
- Added deterministic bounded renderer projections for quarter-step contour
  lines, downhill arrows, dotted fall lines, and restrained uphill/downhill
  shading. Double strokes, dots, and arrowheads preserve meaning without hue;
  geometry remains identical across color-vision palettes and is static under
  reduced motion. Low quality decimates records and every quality shares an
  8,192-command cap.
- Focused verification passes: 6 Vitest files / 43 tests (including reducer
  fuzz and adjacent terrain/elevation paths), TypeScript, scoped ESLint with
  zero errors and only the existing Hook warnings, and git diff check. The
  dedicated Playwright scenario passes 1/1 in 22 seconds, covering real mouse
  preview/commit, exact terrain/economy version changes, undo/redo, synthetic
  touch through the same capture path, and zero console/page errors.
- The required bundled web-game client entered the M23 course fixture and
  emitted valid structured state with the fine-green editor contract and no
  client-error artifact. Its canvas capture and the focused full-page Sculpt
  capture were visually inspected; controls, contour/arrows, course, and HUD
  rendered coherently. Full repository/release gates remain for integration.

## 2026-08-02 — ZK-642 green programs and local maintenance

- Added one deterministic greenkeeping authority shared by live-day commits
  and direct weekly simulation. Receptive, balanced, championship, and custom
  targets now produce realized per-green speed, firmness, health, moisture,
  compaction, wear, bounded pace pressure, and satisfaction evidence from the
  actual maintenance budget, groundskeeper coverage/proficiency, traffic,
  weather, irrigation policy, drainage, and rest.
- Extended the v26 local-state contract with canonical landing and pin zones,
  bounded rolling traffic, and an idempotent daily cursor. Early canonical v26
  payloads without those ZK-642 fields remain valid and normalize forward;
  existing per-hole aggregate condition becomes both zone baselines without
  invented history.
- Real approach traces drive landing wear while completed-round concentration
  drives pin wear. Closed or unused holes recover over time, and favorable
  moisture, drainage, staff, and funding improve recovery without erasing
  persistent local damage.
- Added a production HUD program panel with three presets, five advanced
  controls, an explicit custom state, required weekly capacity, budget/staff
  delivery, and projected pace/satisfaction tradeoffs. Seasonal weather and
  water policy affect delivery but never rewrite the persisted program; this
  is covered by a direct seasonal-automation regression.
- Weekly reports and live ledgers retain the final realized program plus
  period averages. Championship intensity raises authoritative required
  maintenance relative to the balanced baseline; the maintenance budget
  remains the sole cash-settlement path, avoiding a duplicate care charge.
  Structured game text exposes targets, realized conditions, delivery, and
  tradeoffs for diagnostics and accessibility.
- Verification: full repository `test:ci` passes 147 files / 1,138 tests with
  one intentional skip plus 5/5 audio-audit tests; focused ZK-642 and adjacent
  contract/save/season/live suites pass 8 files / 78 tests; TypeScript, full
  ESLint/i18n, production Vite build, and `git diff --check` pass. The dedicated
  ZK-642 Playwright flow passes, switching balanced → championship → custom
  through real HUD controls with matching structured state and no browser
  errors. Its full-page HUD capture and the required bundled-client gameplay
  capture were visually inspected.
- No Linear, commit, push, deployment, or generated audit artifact is included.

## 2026-08-02 — ZK-632 elevation-aware resolved carry in progress

- Added one authoritative conversion from fully modified nominal carry to
  horizontal reach using the frozen ZK-631 slope context: 2.5 yards are removed
  per uphill elevation step (or added downhill), bounded to 50–150% of nominal.
  Flat targets return the original number exactly.
- Player Pro now freezes the slope context on each new trace, uses it for the
  physical carry cap and shot-cost evaluation, and retains pre-elevation
  requested carry separately from achieved carry. Preview and commit resolve
  the same seeded shared outcome.
- Caddie and autoplay select club/power from plays-like distance. Live recovery,
  strategic first/follow-up selection, shot samples, and persisted outcomes use
  the same plays-like/physical rule; legacy flat strategic selection is retained.
- Canonicalized negative zero in slope gradients so new frozen evidence remains
  byte-stable across JSON persistence. Historical completed traces with no slope
  payload remain untouched.
- Focused verification passes 6 files / 57 tests, covering exact
  correction/bounds, fixed-seed uphill/flat/downhill reach, requested-vs-achieved
  evidence, caddie/autoplay choice, preview/commit parity, live strategy and
  persistence. TypeScript, scoped ESLint, and `git diff --check` pass.
- Full `test:ci` passes 147 files / 1,142 tests with one intentional skip plus
  5/5 audio-audit tests. Full TypeScript, ESLint/i18n (zero errors; 12 existing
  Hook warnings), production build and asset/performance audits, and
  `git diff --check` pass.
- The required bundled web-game client produced two valid structured M23 course
  states with no browser-error artifact; its latest canvas capture was visually
  inspected. The focused M36 Player Pro browser flow also passes 1/1, and both
  the shot-decision/caddie view and completed-round capture were visually
  inspected with coherent controls, evidence, terrain, and HUD.
- No Linear, commit, push, deploy, or generated validation artifact is included
  in this delegated slice.

## 2026-08-04 — Approved ZK-715/ZK-742 M66 integration complete

Current request: “Now please implement rest”

- Created clean integration branch `codex/m66-approved-integration` from
  `origin/develop` at `3e552a3`, leaving the dirty shared checkout untouched.
- Applied the approved ZK-715 REVISE decision: the reviewed pure competition
  `types.ts`, `handicap.ts`, `scoring.ts`, and focused tests are the
  authoritative scoring packet. Shared-checkout `characters.ts` and
  `inventory.ts` remain untouched draft inputs for their later M67 issues.
- Applied the approved ZK-742 silent-rejection behavior: manual values remain
  one-based through the real editor callback, while malformed and out-of-range
  values leave the last valid index unchanged.
- Source comparisons against both reviewed worktrees are exact.
- Combined verification passes: 3 focused files / 35 tests; full Vitest at
  159 files / 1,237 passed with one intentional skip; TypeScript; scoped
  ESLint; production build; audio, biome, M35, Parkland, surface, and delivery
  audits; and `git diff --check`.
- The required bundled web-game client entered a valid Quick Start course,
  emitted two coherent structured states, and produced no browser-error
  artifact. Its final course screenshot was visually inspected.
- A real-browser M23 inspector fixture verified the integrated callback through
  the visible number input: initial `1`, valid edit `18`, rejected `19`
  leaving `18`, with no console or page errors. The full inspector capture
  was visually inspected; the development report bar partially overlays the
  control at the viewport bottom, but the value and surrounding course setup
  remain coherent. A failed diagnostic that waited on the wrong Quick Start
  mode and a later capture-only overlay-hiding attempt did not expose a product
  failure and made no repository changes.
- Integration is the scoped `1.0.0-rc.5` release candidate. Release evidence,
  deployment observations, and parent issue transitions are recorded in Linear
  only after the exact commit succeeds in staging and production.

## 2026-08-02 — ZK-639 authoritative green rollout complete

- Added one bounded deterministic ground-path resolver. It bilinearly samples
  the frozen 4×4 fixed-point green surface, derives local gradients, applies
  gravity/cross-slope break and condition-dependent friction, and retains the
  exact landing/path/rest, surface transitions, lie, pace, break, workload,
  and input evidence. Non-green shots that never touch a green preserve the
  established physical line exactly through the same resolver.
- Frozen program/local condition, weather, drainage, club, source lie,
  trajectory, landing angle, spin, requested rollout, and seed feed the path.
  Level, uphill, downhill, sidehill, tier, false-front, wet-slow, dry-fast,
  leaving/re-entering-green, and pathological bounded-workload matrices are
  covered by focused tests.
- Player Pro preview and commit now expose byte-identical resolver output;
  active/career traces retain and validate it. Live golfers freeze the same
  green/weather/drainage snapshot, forward the same result, and preserve it in
  completed-round and architecture evidence. Rules consume the retained path
  for boundary crossings while legacy penalty-boundary behavior remains exact.
- Live flight segments carry the retained landing/path and the sim plus Pixi
  animation follow it instead of redrawing a straight ground chord. Player Pro
  and architecture overlays render the retained polyline, and the shot HUD
  reports pace, realized speed, roll, break, and physical lie.
- The Player Pro surface is now a deferred application chunk so the additional
  authoritative evidence does not regress the ZK-680 initial-download budget.
  The production build reports 1,592,069 initial JavaScript bytes, 16,650 bytes
  below its 1,608,719-byte limit, while the service worker still precaches the
  deferred surface for offline use.
- Verification passes: full repository `test:ci` at 148 files / 1,148 tests
  with one intentional skip plus 5/5 audio-audit tests; post-refactor focused
  resolver, Player Pro/live parity, certification, and animation tests at 5
  files / 61 tests; TypeScript; full ESLint/i18n with zero errors and 12
  existing Hook warnings; production build and every asset/performance audit.
  The dedicated Player Pro Playwright flow passes 1/1 after the deferred chunk
  split, asserting preview/result rollout evidence and structured trace parity.
  The required bundled client entered a live course, produced two coherent
  structured states and no browser-error artifact; its canvas and the Player
  Pro ground-path UI were visually inspected.
- No Linear, commit, push, deploy, or generated validation artifact is included
  in this delegated slice.
## 2026-08-06 — ZK-725 challenge contract implementation started

- Continued from exact production baseline `c7d8d7d0f7ec9c74836f71b0ffa0600b69330204` on `codex/zk725-challenge-contract`.
- Re-fetched ZK-725 and confirmed all four code blockers (ZK-723, ZK-724, ZK-727, ZK-728) are Done. Moved only ZK-725 to In Progress with a scoped work-lease comment; ZK-748 remains the human-owned policy/fairness gate.
- Existing reusable foundations: frozen `StakeBundle` appraisal, inventory/custody transfer primitives, finite reward persistence, individual challenge formats, team authority, and Player Pro save normalization.
- Current implementation boundary: authoritative negotiation terms, 20% value tolerance and cash balancing, explicit prestige confirmation, first-tee escrow, pre-shot cancellation, post-shot settlement/concession, custody/rematch recovery, idempotent history, save/reload, and minimum player-readable verification. ZK-731 presentation work is excluded.
- Sol coordination review is in progress. No production code has been changed yet.

## 2026-08-06 — ZK-725 Packet A contract authority complete

- Added `simgolf-lite/src/game/competition/challengeContracts.ts` as a standalone, pure negotiation/appraisal/acceptance authority. It preserves caller-supplied contract, party, team, and side-bet IDs; captures individual/team format, captain/partner rosters, participant-specific tees/pins, and player/rival captain bundles; and remains unreferenced by round/runtime code so later consumers can defer-load it.
- Value comparison uses the symmetric `abs(A-B) / max(A,B) <= 20%` policy with an integer-exact boundary decision, signed and absolute value differences, and the exact cash addition/lower-valued party needed to balance bundles. Positive side-bet stakes are defined as per-captain exposure, reserved separately so they cannot distort bundle fairness, and frozen with each captain's total cash exposure.
- Acceptance rejects non-transferable career assets, insufficient cash, wrong inventory owner, teammate property, wrong/held custody, escrowed items, and duplicate item IDs. Every item needs a captain-owner confirmation; unique, authored-confirmation, and prestige-75+ items need a distinct second confirmation.
- Accepted contracts recursively freeze detached format/setup/team/side-bet terms, item appraisal bases, cash availability, ownership/custody/transferability/prestige eligibility evidence, confirmation evidence, and acceptance time. No `ChallengeGroupRound`, World, App, UI, save, escrow, or settlement mutation was added.
- Added `simgolf-lite/src/game/competition/challengeContracts.test.ts`: 14 focused tests cover 19.99%/20.00%/20.01% boundaries in both value directions, precise difference/cash balancing, per-captain side-bet reservation and zero-stake rejection, confirmation layers, input detachment/deep immutability, ownership/custody/escrow/non-transferability/duplicate rejection, captain-only team ownership, and complete participant setup.
- Verification: `npm test -- --run src/game/competition/challengeContracts.test.ts` (14/14 passed); the combined contract/inventory/team-authority regression run passed 28/28; `npx tsc -b --pretty false` passed; and focused ESLint for both new files passed.
- Actionable follow-up gaps, deliberately outside Packet A: a later integration packet must source stable IDs and live captain assets, validate selected tee/pin availability against the chosen course, persist/link the accepted contract, and drive escrow/round/settlement transitions. Packet A has no blocker for that integration.

## 2026-08-06 — ZK-725 Packet B first-tee escrow authority complete

- Added a pure `ChallengeRuntimeState` aggregate for the accepted, escrowed, first-shot-locked, and pre-shot-cancelled phases. Stable runtime/escrow/transition/shot IDs, complete accepted terms, exact two-party cash deltas, reserved item snapshots, original loadouts, and deterministic post-transfer fallback loadouts are retained without adding settlement, concession, custody-transfer, round, UI, or World mutation authority.
- First-tee reservation validates and stages both captain sides before returning either change. It rechecks live owner/custodian/transferability, frozen appraisal inputs and confirmation evidence, sufficient cash including per-captain side bets, unique live inventory/escrow IDs, and exact accepted party identity. Duplicate transition IDs are no-ops against exact post-state assets; conflicting IDs reject.
- Pre-shot cancellation releases both parties and refunds their exact reserved cash once. The first committed shot permanently locks that path, and duplicate/crossed first-shot transitions are deterministic and idempotent.
- Player Pro/save persistence uses a compact synchronous financial gate for runtime/contract/escrow identity, exactly two stable side/captain parties, accepted cash arithmetic, escrow before/reserved/after arithmetic, phase/status links, symmetric expected escrow IDs, and exact player owner/custodian evidence. Malformed or mismatched financial state rejects instead of self-healing. The comprehensive deferred codec validates every remaining accepted-contract, appraisal, item-snapshot, loadout, clock, and transition invariant before every public runtime mutation.
- Escrowed items cannot be restaked, newly equipped or captured into a performance loadout, consumed as plant/service rewards, placed, or transferred. Existing equipped display state is left intact at reservation; only executable loadout capture excludes escrowed assets.
- Focused tests cover atomic success/failure, wrong live identity/custody/appraisal, side-bet cash exposure, idempotent/conflicting transitions, refund-once cancellation, first-shot lock, accepted/escrowed/shot-locked crash reload, malformed financial persistence, missing/extra escrow IDs, deferred hostile evidence rejection before mutation, and every escrow restriction boundary.
- Verification: 8 focused files / 93 tests pass; TypeScript and focused ESLint pass; the production build and all asset/performance audits pass. Initial JavaScript is 1,608,714 bytes against the 1,608,719-byte delivery budget (5-byte margin). No commit, push, Linear mutation, deployment, generated audit artifact, or `ChallengeGroupRound` change is included in Packet B.

## 2026-08-06 — ZK-725 Packet C settlement, custody, rematch, and app lifecycle complete

- Added immutable, exactly-once settlement evidence for completed rounds, concessions, withdrawals, ties, refunds, main stakes, and independently accounted side bets. Every record embeds the accepted contract, frozen appraisal, resolution evidence, party changes, transferred snapshots, resulting custody, and post-assets; duplicate reload replays must reproduce the exact recorded result.
- Wired Player Pro acceptance to an atomic compare-and-swap World commit and immediate autosave. First-tee cash/items reserve before round entry, the first committed or auto-finished shot locks cancellation, pre-shot Concede follows the cancellation/refund authority, and completed/conceded rounds settle through one deferred lifecycle transaction.
- Lost equipment moves to visible named rival custody and clears invalid loadout/display/vehicle slots through deterministic fallback. Escrow restrictions cover spend/equip/consume/restake/placement/transfer paths.
- Authored custody rematches are now playable through the existing contract builder. Preparing one forces an individual no-new-stakes contract, links the active contract to its source custody settlement, records loss/tie attempts without recovery, and on a verified win restores the exact item once through the recovery ledger. The recovery implementation is isolated in a deferred module so it does not expand initial JavaScript.
- The Player Pro builder exposes individual and team terms, partner/setup selectors, side bets, cash and item bundles, precise value comparison, separate owner/prestige/rival confirmations, active escrow cancellation, custody, history, and recovery-rematch preparation. Accepted individual and team contracts now enter the persisted `ChallengeGroupRound` authority: individual scoring and evidence-backed side bets are operative; four-ball, alternate-shot, and scramble use the frozen shared team setup; scramble requires an explicit captain ball choice; unsupported team Stableford and team side bets reject precisely before escrow.
- Representative browser proof covers cash escrow/full pre-shot refund, a live four-ball first shot and post-shot concession, ordinary-item loss into visible named custody, an authored winning rematch that restores the exact item, high-prestige second confirmation, and tie/refund settlement. The affected Player Pro, handicap/group-scorecard, and persisted group-carrier flows also pass. Final evidence is 8/8 Playwright scenarios after correcting two stale test-navigation/carrier assertions, with no product console or page errors; the live team HUD, named custody, and prestige/tie surfaces were visually inspected.
- Verification passes: focused challenge authority at 4 files / 41 tests; full `test:ci` at 177 files / 1,407 passed with one intentional skip plus 5/5 audio-audit tests; TypeScript; full ESLint/i18n with zero errors and 12 existing Hook warnings; production build plus all asset/offline/performance audits. The optional tournament panel now follows the existing deferred-management pattern, leaving initial JavaScript at 1,600,345 bytes against the 1,608,719-byte cap; its real scheduling/standings browser flow passes and the surfaced `surface-care`/`pin-fairness` localization gap is fixed.
- Release/policy boundary: code is ready for a scoped commit, branch push, and development CI, but ZK-748 remains the mandatory human approval gate before production acceptance or marking ZK-725 Done. The representative automated evidence is ready for review; a human must still explicitly comment `APPROVED FICTIONAL STAKES POLICY`.
