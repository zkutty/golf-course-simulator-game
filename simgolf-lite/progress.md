Original prompt: Update my vision HTML for the new features from the new milestones added to linear

## ZK-701 normal-path balance closure — 2026-08-03

- Diagnosed the sole normal-path bankruptcy as a condition-driven closure, not
  an excessive water bill: Desert / 36 / normal / conservative earned only $5
  testing rounds while condition remained below 0.40 and exhausted the
  unchanged two-week distress runway immediately before turf recovery.
- Increased only balanced irrigation application depth from 0.075 to 0.079.
  The corrected path still reaches -$2,089 for one distress week, receives no
  cash grant or weaker fail rule, reopens the next week, and finishes all 104
  weeks solvent.
- Extracted the canonical release fixture for direct regression coverage. The
  exact normal path is pinned non-bankrupt and three representative Desert poor
  paths remain bankrupt/sticky through week 104.
- Full 81×104 coverage passes all 8,424 weeks in 237,246 ms under 720,000 ms.
  There are zero normal and three poor-management bankruptcies; canonical hash
  is `afe65778`, legacy projection is 8,227 weeks / hash `55131e55`, and 197
  post-bankruptcy weeks remain covered.
- Final verification passes: 23 focused release/surface-care/multi-course tests;
  full CI at 156 files / 1,189 passing / 1 intentional skip plus 5/5 audio;
  M62 certification at 14 files / 92 tests and determinism `47e900b8`;
  TypeScript; lint with zero errors and 12 existing Hook warnings; production
  build/audits; and the M62 desktop/mobile Playwright regression at 1/1. The
  retained captures were visually inspected and showed a populated, readable
  Architecture Review over a correctly rendered game canvas/HUD.
- Production promotion remains owned by the parent release workflow.

## ZK-699 release balance performance and full-duration coverage — 2026-08-03

- Profiled the non-terminal release balance gate and traced its dominant cost
  to exact hole scoring and shot search, not the already bounded ZK-698
  Architecture Review path.
- Reused immutable physical release geometry across the 81 management paths,
  with cross-biome score reuse allowed only when tracked terrain contains no
  theme-sensitive deep rough. Added focused hit/invalidation regression.
- Added exact shortest-path termination: a best direct result below two strokes
  cannot be beaten by an indirect route, and Dijkstra stops once no unsettled
  state is cheaper than its known goal. No sampling or matrix reduction was
  introduced.
- Found the previous bankruptcy early exit executed 8,218 rather than the
  claimed 8,424 weeks. All 81 rows now run 104 weeks, retain a hashable legacy
  projection, and prove bankruptcy never accidentally recovers during the 206
  newly covered post-bankruptcy weeks.
- Two complete runs passed at 234,612 ms and 237,481 ms under the enforced
  720,000 ms budget. Full hash is `38b861f9`; legacy projection hash is
  `6dc8d6f2`. Production promotion remains owned by the parent release workflow.

## ZK-698 full-estate Architecture Review performance — 2026-08-03

- Reproduced the cold base `buildArchitectureReview` regression at 52.39s on
  the deterministic 220×140 / 36-hole / 100-golfer M62 release fixture.
- Removed exact redundant work without reducing scope: route facts now compute
  once per setup, each cohort plan computes once instead of once per option
  kind, and the M48 consumer skips only physical preview carriers it never
  returns. Default live/player callers still resolve selected previews.
- The fixed findings hash remains `f7ff4b96`; the release contract retains 36
  holes, 108 pin setups, 8 samples per option, recommendations/rules, and an
  unattached lazy M62 overlay. Node 22 cold measurement is 87.6ms; the bundled
  certification report records 66.1ms against the enforced 750ms budget.
- Focused 33 tests, TypeScript, and the full 14-file/92-test M62 certification
  pass. No sampling or deferred state was added, so text-state/accessibility
  qualifiers are unchanged. Production promotion and human/device gates remain
  owned by the parent release workflow.

## Renderer milestone continuation (2026-08-02)

Current user request: implement the remaining agent-ready renderer milestone work; human certification remains deferred. ZK-680 and ZK-681 are committed with automated evidence. ZK-679 has snapshot-driven seasonal terrain, surface care, static buildings, and Player Pro overlay systems; terrain/water, remaining static props, mobile entities, atmosphere, and camera/input are still in PixiStage. Preserve generated audit/screenshot artifacts unless deliberately updating evidence.

## ZK-692 IndexedDB durability regression — 2026-08-02

- Changed the IndexedDB KV driver to resolve writes/deletes only after their
  enclosing transaction completes, rather than after a request-level success
  event. Transaction errors and aborts now reject even if the request had
  already succeeded; readonly reads still resolve when they observe a value,
  because they have no durability boundary to cross.
- Added controlled-driver regressions for delayed completion and a post-request
  transaction abort. This keeps the save UI from reporting a completed quick
  save before the slot is committed and immediately listable.
- Added a copied same-runtime manifest snapshot only after the manifest write
  commits. Immediate Save → Load listing now avoids a second delayed IndexedDB
  read transaction, while interrupted manifest writes retain the prior cache.
  The snapshot is page-global to cover Vite module instances, and an already
  open Load dialog refreshes on the committed-manifest notification.

## AI acceptance closure — ZK-631 and ZK-678 — 2026-07-31

- Expanded ZK-631's slope contract coverage for fractional positions,
  map-edge clamping, malformed elevation payloads, zero-length aim vectors,
  and a bounded fractional-position matrix.
- Added ZK-678 selector-scope instrumentation for the live HUD, editor
  inspector, and management report. The test demonstrates economy updates
  invalidate only live/management, UI tool selection only editor, and course
  edits only editor; an initial broad management version dependency was found
  and removed.
- Focused tests, TypeScript, and scoped ESLint pass. Browser smoke remains to
  run before promotion.

## AI renderer foundation — ZK-679 — 2026-07-31

- Started the renderer seam with a pure typed `RenderSnapshot` and explicit
  revisions for terrain/materials, structures/props, mobile entities,
  overlays/diagnostics, atmosphere, and viewport/input. The current Pixi host
  and visual behavior remain untouched in this foundation slice.
- Added isolation coverage proving cash-only changes do not invalidate static
  rendering, while editor, terrain, marker, live, atmosphere, and viewport
  changes each target only their declared system. The next slice is to make
  PixiStage consume the snapshot through explicit scene-system lifecycle
  adapters.

## AI build wave 1 — ZK-678 and ZK-631 — 2026-07-31

- Added a typed `GameSession` boundary plus selector-based React bridge and an
  incremental App migration. The session owns authoritative state access,
  commands, persistence coordination, lifecycle, and subscriptions without
  changing reducer, save, clock, or PlatformServices ownership.
- Added a pure versioned shot-slope contract with frozen-elevation analysis,
  optional backwards-compatible serialization, and propagation through shot
  evaluation, water carry, expected cost, and solver paths. Historical shots
  remain valid when no slope data is present.
- Integrated verification passes: TypeScript; 39 focused session/slope/elevation/
  shot/save tests; scoped lint with zero errors (three existing App Hook
  warnings); and a browser menu smoke with valid `render_game_to_text` state,
  a visible CourseCraft menu, and no client-error artifact.
- Broader production build/release evidence and human visual/audio/device gates
  remain deferred. Next AI build packet is ZK-679 renderer scene systems, after
  reviewing this GameSession seam.

## ZK-646 verification refresh — 2026-07-31

- Confirmed the committed biome-aware terrain, irrigation, and planting economics
  implementation at `67a5b8c` rather than duplicating it in a new slice.
- Fresh focused parity coverage passed: 5 Vitest files / 44 tests covering economy
  quotes, biome registry completeness, plant install/removal economics, weekly
  ledger reporting, and save compatibility.
- The isolated M53 core certification report passed all checks, including the
  Parkland $42 neutral irrigation reference, 0.75–1.25 weather-demand bounds,
  climate-appropriate starter viability, Desert xeric parity, and no universal
  biome economic winner. Retained human/device/release gates remain open, so
  keep ZK-646 In Progress until promotion and final Linear reconciliation.

## M60 Vision page execution — 2026-07-31

- Started Linear issues ZK-615 and ZK-619. The M60 contract now lives in
  `docs/M60_VISION_ART_CONTRACT.md` and defines the existing editorial visual
  language, the five biome gallery requirements, provenance, exclusions,
  payload budgets, and the outstanding human-review gate.
- Replaced player-facing milestone/future labels with localized timeless system
  stories for design, watching play, direct Player Pro golf, club operation,
  seasons, and legacy. The long-game arc now has six stages.
- Added equal-weight Tropical Coastal Resort, Temperate Japan, Alpine Mountain,
  Heathland, and Australian Sandbelt gallery cards with original project-bound
  artwork, 1536px JPEG sources, and 768px mobile sources. Existing Vision
  images were recompressed as part of the page media budget work.
- The new art needs browser, accessibility, offline/PWA, and human
  golf/cultural/provenance validation before it can be certified. The active
  Vision audio issue ZK-443 remains an external certification dependency.
- Added a Vision-specific PWA regression: install starts with no Vision media
  in the precache, and the hero plus viewed gallery art enter the runtime
  cache only after the page is opened. `npm run test:pwa` passes this path.

## Biome content-bible wave — 2026-07-31

- Started ZK-572, ZK-579, and ZK-586 after the M52 foundation certification.
  Draft production contracts now live in `docs/biomes/` for Tropical Coastal
  Resort, Temperate Japan, and Alpine Mountain. They define visual identity,
  playable-land requirements, seasonal/care direction, material-dock scope,
  sound, prohibited shortcuts, and explicit human review gates.
- ZK-601 (Heathland) and ZK-608 (Australian Sandbelt) remain in Backlog because
  their actual Linear dependency, the M57 ship/hold report ZK-600, is still
  open. Do not start or claim their formal content-bible work complete until
  that gate is cleared.

## 2026-07-30 — ZK-569 local course wear and care evidence

- Added a pure, bounded surface-care presentation projection. It consumes
  only genuinely observed sparse `surfaceCare` records, their stable topology,
  and the existing effective-surface result; it does not own simulation state
  or persist decals.
- Added deterministic world-anchored cues for traffic wear, divots,
  compaction, mud/softness, dry stress, wet-disease risk, weed pressure,
  overgrowth, thinning, bare failure, reseed/resod work, active recovery
  dressing, and allocated-service-only groundskeeper work. Risk cues are
  labelled as pressure/risk rather than diagnoses absent from authority.
- Commands are capped at 96/240/480 for Low/Medium/High. Anchors remain
  stable across day updates, JSON save/reload, and all four rotations; changes
  to every cue-driving record field enter the renderer invalidation signature.
  Traffic lines align to the nearest authored hole route, and cue headings are
  projected through the same isometric rotation as their world anchors.
- Added a dedicated Pixi layer below markers/objects. Groundskeeper motion is
  cosmetic and exists only for an active repair whose latest
  observation explicitly records suitable-day repair progress and service at
  or above the repair threshold; generic pre-task allocation cannot leak into
  this cue. Reduced motion snaps it to the stable anchor. Repair/recovery/work
  cues vanish when the latest day stalls or the task authority resolves.
- Terrain-chunk invalidation contains only effective terrain, treatment, and
  mowing. A separate compact care-presentation hash owns cue/task/route
  changes, so cue-only changes rebuild the bounded care layer without
  rebuilding terrain chunks.
- Focused verification passes 2 files / 24 tests plus TypeScript.
  Coverage includes no-authority gating, two-hole local divergence at one
  global condition, M51 off-path traffic, drought/understaffing, all cue
  families, repair completion removal, save/reload/rotation/cache behavior,
  effective-physics parity, 224-day determinism, exact dense 128×128
  quality-tier budgets, and runtime bounds.
- The ZK-569 Playwright regression passes 1/1 with all fourteen cue families,
  multiple hole buckets, layer/occlusion ordering, worker gating, populated
  canvas pixels, and exact zero-command cleanup after authoritative
  resolution. On the same mounted canvas, a cue-only transition produces care
  graphics with exactly zero terrain-chunk rebuilds, while a mowing transition
  rebuilds terrain chunks. Its before/after screenshots were retained as
  machine attachments and were not opened. The bundled web-game client also
  emitted valid game text state and captures with no client error artifact;
  the care telemetry is a compact deterministic hash/summary.
- Final repository verification passes 135 Vitest files / 1069 tests with one
  intentional skip, production build, biome consumer and authored-biome
  audits, exact audio manifest, service-worker asset injection, M35/parkland
  asset audits, and lint/i18n with zero errors (12 hook warnings).
- Human visual/readability/accessibility-perception/device/GPU judgments are
  intentionally deferred to the final validation phase. Browser captures may
  be produced as machine evidence but must not be opened or subjectively
  assessed during this implementation wave.

## 2026-07-30 — ZK-567 seasonal terrain implementation

- Added a pure registry-driven seasonal-terrain presentation resolver over
  ZK-566 `SeasonalVisualState` and ZK-379 seasonal coverage signals. It emits
  continuous dormancy, wetness/puddling, drought, frost, climate-gated partial
  snow, leaf-litter, and weather-recovery channels for all ten terrains.
- Parkland/Links/Desert select four-season, exposed-muted, and
  drought/heat-led treatment profiles through declarative coverage data; the
  renderer has no biome-name branch. Water is aquatic-only, has zero snow,
  and can receive only translucent sheen commands.
- Integrated restrained tint transforms into Low tile and Medium/High
  connected-material paths. Medium/High use a bounded world-lattice decal
  command buffer (220/420 max); Low is transform-only with zero decals.
  Seasonal dressing is a separate layer below all tee/pin/route markers, and
  protected tee/pin cells are excluded.
- Color-vision modes retain the existing ten-color palette and apply only a
  luminance multiplier to generated Medium/High textures; cue channels and
  geometry are unchanged. The real reduced-motion setting now reaches Pixi;
  seasonal commands are static in both modes.
- Enabled presentation-only winter snow eligibility in the climate registry:
  Parkland uses a restrained 38°F/.28 contract, Links 34°F/.14, and Desert
  remains disabled. Snow does not enter `weatherForDay`; both pinned four-year
  weather SHA-256 tests remain unchanged and pass.
- Added a canonical 144-state M53 fixture matrix (three biomes × four seasons
  with authoritative severe/cold weather × four rotations × three qualities),
  pinned at SHA-256
  `1c40d21def13a14bc6713c091ca85047e485f28c6abb73c842ba9a69fc9400cd`.
  The 12-state browser slice distributes every biome/season/rotation/quality,
  passes structured terrain/water/snow/frost/drought/budget assertions,
  populated-canvas and pixel-distinctness checks, and reports zero console or
  page errors. Captures were generated as machine attachments only and were
  not opened or subjectively inspected.
- Seasonal treatment signatures now invalidate the mounted terrain chunk
  cache even when the Course and its tile/elevation arrays retain identity.
  A same-canvas Low-quality browser regression advances an authoritative
  Parkland spring fixture to summer drought, observes complete-course chunk
  rebuilds, positive drought state, and changed screenshot bytes without a
  navigation, course reload, or canvas remount.
- Final local verification: focused biome/seasonal coverage/state/terrain
  tests pass (6 files, 38 tests); TypeScript, production build, biome/audio/
  asset audits, and scoped lint (zero errors; 11 existing hook warnings) pass.
  The canonical 12-state Playwright matrix passes, and the same-mounted cache
  regression passes 1/1 under the canonical project configuration. Bundled
  client state is valid with no error artifact; retained PNG evidence includes
  hashes/provenance and was not opened. Human visual/painterly,
  climate-authenticity/readability/accessibility-perception, device,
  physical-GPU, and gameplay judgments remain explicitly deferred to the
  final M53 validation phase; no screenshot has been subjectively inspected.

## M50 implementation wave — 2026-07-30

## M51 ZK-538 Wave 0 mobility/rental foundation — 2026-07-30

- Added a versioned M51 contract layer for group-level walk/pushcart/riding-cart selection, products, individual fleet units, assignments, authorization/settlement transactions, prediction-vs-observation evidence, deterministic decision order/seed, and route-cache identity.
- Durable fleet/evidence is `World.m51`; transient daily contracts are `LiveState.m51`; the existing `LiveState.walkCache` remains the only route cache and the existing concession/`commitDay` economy remains the only money owner. No rental behavior, UI, live movement, or router change is in this Wave 0 packet.
- Save schema v21 migrates older slots to neutral bounded M51 defaults. Focused contract tests cover deterministic identity/canonical normalization, history and save-size bounds, and settlement idempotence/cash ownership.
- Verification: focused M51/save/live-persistence/live/M49 suite passes 5 files / 55 tests; the deterministic release-balance harness passes. Targeted M51-adjacent lint has no errors (one pre-existing hook warning). The bundled browser client emitted valid menu text state and its capture was visually inspected. A later whole-repository typecheck is blocked by unrelated in-progress M50 files in the shared worktree; no M51 diagnostics were reported.

## M51 ZK-541 Wave 1 timed-itinerary extraction — 2026-07-30

- Extracted `TimedItineraryBuilder` as the shared timing/concession/walk-segment authority for ordinary and M47 live planners. It retains legacy walking segments for every reserved M51 mode; no fleet, weighted routing, or UI behavior is implemented.
- The ordinary/M47 focused suite passes after the extraction (36 tests), and TypeScript plus diff integrity pass. New helper coverage verifies no-route fallback, waypoint timing, future-mode walking compatibility, and planner-only wallet reservation. The existing live regression also checks unique concession transaction IDs.
- M47 deterministic plan/outcome/reaction hash coverage remains in its existing focused certification test. The generated historical M47 artifact predates concurrent M50 physics work, so it is not used as a ZK-541 baseline. Do not run generated certification artifacts for this packet; use focused certification tests only.

- Implemented the ranked automated slice for ZK-548, ZK-550, ZK-551, ZK-552, and ZK-553: authoritative obstacle trajectory resolution, low/standard/high Player Pro recovery preview and ruling evidence, live/AI around/under/over recovery choices, rules-backed Architecture Review feedback, and an M50 certification report.
- Added deterministic coverage for obstacle clearance, lie/club effects, recovery scoring, preview/execution parity, penalty and relief invariants, historical evidence labeling, hostile finite shots, legacy behavior, architecture evidence, and bounded 36-hole/100-golfer performance.
- Verified the final source with TypeScript, build plus audio/asset audits, lint/i18n, focused M50/architecture/live/Player Pro rules tests, M36 Playwright direct-play coverage, and the bundled web-game client. The client emitted valid state with no console-error artifact; a gameplay capture was visually inspected.
- The full repository Vitest run initially exposed a performance regression: ordinary architecture/tournament qualification was sampling recovery routes on every tee. That trigger is now restricted to genuine recovery lies, while live follow-ups use a bounded one-sample path; the final full suite passes 109 test files / 882 tests / 1 skipped, including M26 tournaments.
- Follow-up release diagnosis found the remaining tournament cost in `routeObstacle`: it now selects the same deterministic first route obstacle in one pass without allocating or sorting the full obstacle list, and reuses each round's existing rules snapshot for recovery evaluation.
- Human gates intentionally remain open: three-biome visual screenshots, accessibility, audio listening, real-hardware GPU performance, and human golf-authenticity/balance playtesting.

## ZK-326 terrain-authoring completion slice — 2026-07-29

## ZK-377 visual system machine-verification slice — 2026-07-29

- Inventoried the shared workspace navigation and contextual inspector. The workspace/action icons were already owned SVG paths; the remaining native glyphs were the inspect trigger and inspector close control.
- Replaced those glyphs with the shared owned SVG icon component, added tabpanel relationships, and centralized workspace/inspector default, selected, focus, disabled, warning, positive, and reserved destructive visual-state tokens. No terrain, renderer, audio, or gameplay code is in scope.
- Focused pseudo-locale browser coverage initially surfaced a brittle hard-coded transformed-string assertion; the contract now checks the pseudo-localized accessible label format instead.
- The pseudo-locale mobile run found a genuine containment defect: a viewport-derived inspector width overflowed its narrower course-pane containing block. The panel now uses border-box sizing and a containing-block-relative width; the focused desktop and pseudo-locale browser scenarios both pass after the fix.

- Closed a post-commit edit integrity gap: a curved surface dragged wholly into unowned/protected land now remains unchanged instead of committing an empty clipped feature and restoring its former underlay. Partial legal coverage remains clipped and commit-capable.
- Added reducer-level regression coverage for the fully unowned case. Focused surface intent/feature edit/terrain stroke tests pass (26 tests), and the production build/typecheck passes. The existing M35 node/tangent browser test was attempted twice; its first run aborted during the pre-existing first drag with Playwright's `Execution context was destroyed` navigation error, before the new model guard was reached. The failure capture showed a blank Pixi canvas; this needs renderer/test-harness investigation outside this bounded model slice.

## Ranked feature implementation wave — 2026-07-29

- ZK-376: added a contextual inspector surface to the workspace shell. It provides concise course, operations, property, people, and legacy summaries; Cozy/Architect view presets; relaxed/balanced/brisk operations presets; and detail routing without losing workspace context. Added semantic dialog labelling and a focused browser contract.
- ZK-381: expanded the deterministic audio scene selector across menu, design, operate, play, tournament, crisis, evening, and finale routes. Evening yields the file-backed music channel to the authored night ambience bed; inactive or under-construction property assets no longer select campus/resort beds. App wiring now supplies the live day minute. The initial tutorial-minute boundary was corrected after browser regression evidence.
- ZK-382 machine-verifiable slice: contextual inspector semantics are labelled for assistive technology and covered by browser assertions; the broader manual accessibility, scaling, motion, and browser matrix remains deferred.
- Verification: full Vitest passes 98 files / 819 passed / 1 skipped; build, audio manifest audit, lint/i18n, focused inspector E2E, M15 audio browser scenarios, and M35 surface-authoring browser coverage pass. Existing lint output remains 11 React Hook warnings and no errors.
- Human-gated visual, provider, cross-browser, device, and release checks remain intentionally open.

## M35 full-milestone completion pass — 2026-07-25

Current request: “complete m35 from linear”

- Resolved M35 as the 25-issue Linear milestone `M35: Continuous Landscape & Visual Polish`, not only ZK-332.
- Read the milestone, all top-level issue specifications, all renderer-correction subissues, issue comments, attachments, and the explicit rejected human visual gate.
- Current authoritative blocker chain is ZK-468 → ZK-469/ZK-470/ZK-471 → ZK-472 → fresh-agent ZK-473 review → human ZK-466 approval.
- Open top-level scope also remains in ZK-326 (post-commit node/tangent editing), ZK-328 (height/shore/path/structure integration), ZK-329 (biome/tier atlas splitting and demand caching), ZK-330 (bounded world polish), ZK-327 (accepted connected presentation), and ZK-332 (adaptive quality plus certification).
- The implementation baseline for this pass is `49947b4` (checkpoint `8485a52`, M35 hardening `d50533e`, M43 package/Workshop hardening `2a00199`, and M42 desktop/Steam hardening `49947b4`).
- Existing unrelated worktree edits and artifact directories predate this pass and must be preserved.

### M35 implementation checkpoint

- Added tested connected-component geometry with hole-aware rings, bounded
  topology-preserving corner arcs, stable topology keys, and one shared visual
  heightfield. Water/wetlands and tee/green components level coherently;
  buildings and property assets receive flat presentation pads without
  changing authoritative integer elevations.
- Medium/High now render connected terrain meshes over the authoritative Low
  fallback. Mesh UVs come from unrotated world coordinates, use deterministic
  seamless material fields, retain one- and two-subdivision quality tiers, and
  add multi-band shores, bunker lips, fringes, and path shoulders. The visible
  per-diamond quilt is gone in the inspected Parkland/Links/Desert captures.
- Props, buildings, property assets, decorations, markers, golfers, balls,
  impact effects, and ambient wildlife now sample the same visual heightfield.
- Auto quality now evaluates sustained frame-time p95 windows, requires
  consecutive downgrade/upgrade evidence, and holds a post-change cooldown.
  Explicit High/Medium/Low settings remain fixed.
- COZY now opens on a playable hole-scale composition, Architect remains the
  overview, and `F` restores an explicit global overview. Course/save
  replacement triggers one camera refit so a smaller loaded course is not left
  tiny and off-center.
- Focused geometry/quality/contour/relief tests pass (22 tests), TypeScript
  passes, the required bundled client emitted state with no console-error
  artifact, and the M35 plus three-theme ZK-467 Playwright pass is 4/4.
  `artifacts/m35-curved-terrain.png` and all three `zk467-*-relief.png`
  captures were visually inspected against the four Linear SimGolf references.

### M35 TODO

- Post-commit spline/node/tangent editing is implemented with width presets,
  click-spline creation, exact shared preview/commit geometry, atomic economy,
  locked-tile clipping, and undo/redo. Focused model and Playwright coverage
  passes, including save-safe explicit tangent data.
- The deterministic 4×/2× sampled landscape-field pipeline now emits all ten
  materials for Parkland, Links, and Desert. Content-hashed manifests split
  terrain, buildings/decor, props, details, and fields by biome/quality;
  runtime and service-worker caches fetch only the selected bundle. Low omits
  optional field/detail/prop payloads. The contract and automated size/hash
  audit live in `docs/M35_ART_CONTRACT.md` and
  `scripts/m35-asset-audit.mjs`.
- Complete bounded world-polish/detail-density work and the full performance,
  PWA, browser, save, accessibility, legacy, 36-hole, and 100-golfer matrix.
- Produce reproducible contact sheets and the scored fresh-context ZK-473
  comparison report from an exact commit.
- Run the required bundled web-game client after each meaningful renderer change and visually inspect gameplay captures.
- Do not mark M35 complete until ZK-473 returns READY and the explicit human ZK-466 gate is approved.

## M29 Cloudflare playtest completion pass — 2026-07-24

- Verified the production and staging Workers URLs return 200 with strict CSP, revalidating HTML, and noindex headers.
- Verified the Cloudflare production deployment history and two consecutive successful `main` CI deployment jobs, plus the latest successful `develop` staging deployment.
- Confirmed both GitHub deployment environments contain the required Cloudflare account/token secret names.
- Tightened Sentry sanitization to remove separate query strings, request environment, arbitrary contexts/tags, device identifiers, response metadata, state, spans, measurements, transaction names, and SDK processing metadata.
- Explicitly enabled Cloudflare SPA route measurement and added focused regression coverage.
- Passed the full 439-test unit suite, production PWA smoke, Chrome/Firefox/WebKit clean-profile paths, both Wrangler dry runs, and a headed bundled-client course-render inspection.
- Completed a real staging rollback to the previous known-good Worker version, passed the live deep-route/offline/save smoke, restored the current version, and confirmed staging returned healthy headers.
- Recorded the evidence in `docs/M29_CERTIFICATION.md` and removed the temporary GitHub Pages fallback workflow after the stability gate passed.
- Remaining external setup: authenticate to Cloudflare Web Analytics and Sentry, create/select the projects, add the public repository variables and Sentry upload secret, then verify a controlled production error and Web Vitals receipt.

## Golden-path save/reload CI repair — 2026-07-24

- Corrected seasonal automation so layout normalization retains the matching stable hole IDs and active course identity.
- Added a regression that advances the ID-less QA reference course and proves its current-schema save validates.
- Exact golden-path/vision CI passes all nine tests; the full suite passes 432 tests with one intentional skip; build and lint/i18n pass.
- Bundled-client state confirms a normalized `course-primary` layout whose draft and published IDs match all nine stable holes. Its headless Pixi canvas capture was black under software GL, with valid structured state and no reported client error.

## M40 implementation — 2026-07-24

- Added six original authored campaign chapters with three phases each, 12 complications, all four M39 charter variants, cross-chapter facts, scheduled callbacks, consequence previews, recovery guidance, and coherent victory/honorable-loss epilogues.
- Added a recurring six-person cast and story bible with stable IDs, gameplay roles, motivations, relationships, state triggers, reactions, portrait-expression requirements, localization notes, and bounded epilogue outcomes.
- Connected campaign gates to live course construction, architecture evidence, named Living Club regulars, access/staffing/economy, severe-weather recovery, Player Pro rounds, direct cast matches, tournaments, and the actual resumable championship round.
- Added persistent v2 campaign/profile contracts for choices, prior choices, relationships, event pools, exact facts, matches, settlement ledgers, best medals, unlocks, epilogue facts, and retry-safe one-time rewards.
- Advanced saves to schema v17 with v16 migration and hostile-data normalization while preserving M39 seasonal state.
- Added the localized campaign scene and dashboard surfaces, visible mastery criteria, match controls/status, Sandbox handoff, Scenario Select best medals, and structured text-state telemetry.
- Added automated certification for six chapters, 18 phases, 12 complications, six matches, 24 charter paths, three Player Pro builds, three design styles, 18 recovery paths, localization coverage, and a 15.3-hour authored campaign estimate.
- Final verification passes: 65 Vitest files / 415 tests passed with one intentional skip; production build; lint/i18n with seven pre-existing hook warnings and no errors; M36/M38/M39/M40 Playwright regressions; bundled-client structured state and renderer capture; visual inspection of the campaign opening/dashboard and client capture; and `git diff --check`.
- Certification record: `docs/M40_CERTIFICATION.md`. The external moderated first-time-player study in ZK-374 remains a human playtest gate rather than an automated claim.

## M39 implementation — 2026-07-24

- Added a timezone-independent 32-week club calendar advanced only by live-day settlement.
- Added deterministic biome/season weather and stable seven-day forecasts with bounded severe cooldowns.
- Connected one weather modifier contract to live demand, AI shot planning, Player Pro shot snapshots/previews, pace, turf, hospitality, and weekly reports.
- Added four annual club charters, stable-baseline enterprise automation, Advanced Operations/manual overrides, and forecast response previews/commands.
- Added atomic closure/rescheduling cascades plus immutable annual awards, rankings, yearbooks, timeline, Hall of Fame, and one-time rewards.
- Advanced saves to schema v16 with migration preserving explicit M30–M33 settings.
- Final verification passes: 64 Vitest files with 405 tests passed and one intentional skip; production build; lint/i18n with seven pre-existing hook warnings and no errors; eight M24/M31/M32/M33/M36/M38/M39 Playwright regressions; focused M39 browser rerun; bundled-client structured state; visual inspection of the forecast, charter/automation, yearbook, and client captures; and `git diff --check`.
- Certification record: `docs/M39_CERTIFICATION.md`.

## 2026-07-23

- Identified `golf-sim` as the matching Linear project.
- Reviewed the newly added M36–M44 roadmap and its available issue breakdown.
- Scope for the vision update: Player Pro direct golf and growth, play-informed architecture feedback, persistent people and stories, seasons and club identity, rebuilt campaign, premium presentation, desktop/Steam, Workshop, and release certification.

## Implemented

- Added a new `Play It` navigation target and premium-roadmap section.
- Added six story cards covering M36–M44 and a Build → Play → Understand → Redesign loop.
- Updated the hero and north-star copy to include playing the course through the Player Pro.
- Added responsive desktop/tablet/mobile styling and focused E2E assertions/screenshots.

## TODO

- No known follow-up work for this request.

## Verification

- `npm run build` passes. Existing Vite chunk-size warnings remain unchanged.
- `npm run lint` passes with seven pre-existing React Hooks warnings and no errors.
- `git diff --check` passes.
- The web-game Playwright client loads `/?view=vision` without console errors and reports the expected menu state.
- Focused vision E2E passes on desktop and a 390×844 mobile viewport (2 tests).
- Visually inspected the hero, desktop roadmap introduction/grid, and mobile roadmap introduction/grid. Copy, contrast, wrapping, spacing, and sticky navigation are readable at both sizes.

## M36–M37 Player Pro implementation — 2026-07-23

- Added a versioned Player Pro career model, schema-v14 persistence, new-game identity creation, stable legacy defaults, and safe malformed-active-round recovery.
- Added a pure deterministic shot resolver and shared preview contract for power, clubs, lies, hazards, obstructions, rolling, putting, penalties, evidence, and advanced techniques.
- Added the controlled-round authority/state machine, immutable course snapshot, decision pause, editing lock, retained shot overlay, reduced-motion flight timing, boundary autosave, resume, concede, automatic completion, scorecard, historical shot records, and Return to Design.
- Added the career UI for identity, six skills, technique gates, published-route play, facility/coach training, named friendly/wager matches, and hosted tournament entry.
- Added bounded round XP, diminishing evidence returns, training cost/time/daily limits, one-time cash/reputation settlement, tournament fields/leaderboards/payouts, and trophies.
- Added deterministic 3-, 9-, and 18-hole certification coverage plus focused browser coverage.

### M36–M37 verification

- `npm run build` passes.
- `npm run lint` passes with the same seven pre-existing React Hook warnings; both localization guards pass.
- `npm test` passes: 62 files, 385 tests passed, 1 skipped.
- Player Pro plus golden-path browser suite passes: 8 tests.
- Final focused Player Pro browser rerun passes with no console errors.
- Bundled web-game client emits structured Player Pro state without an error artifact.
- Visually inspected `artifacts/m36-player-pro-shot.png` and `artifacts/m36-player-pro-complete.png`.
- Certification report: `docs/M36_M37_CERTIFICATION.md`.

## Suno soundtrack and ambience integration — 2026-07-24

Current request: “I’ve created all the songs and added them as comments to the issues as links to Suno. Give me a quick cover art prompt and let’s wire up these tracks.”

- Read the comments on ZK-409 through ZK-428 and resolved 40 unique public Suno songs: 22 music generations and 18 environmental generations.
- Downloaded locally hosted runtime copies and normalized them to 96 kbps MP3 for a 93 MB lazy-loaded library; the high-quality published masters remain recoverable from Linear/Suno.
- Added `src/audio/sunoLibrary.ts` as the authoritative title, Suno ID, source URL, Linear issue, local path, playlist, and provenance manifest.
- Replaced the generated runtime music playlists with contexts for title, three biome design modes, normal operations, Player Pro, three tournament tiers, financial tension, and victory.
- Added crossfaded authored ambience playlists selected by biome, camera-near water/campus/resort property, rain, dusk/night, and winter. The prior procedural layers remain as quiet camera-reactive detail.
- Updated audio credits and the development music override for the new context contract.
- Focused verification in a clean HEAD validation copy: six audio tests pass, production build passes, lint/i18n passes with the seven existing hook warnings, M15 Playwright acceptance passes, the bundled web-game client emits valid structured state with no error artifact, and its screenshot was visually inspected.

### Integration note

- The shared checkout already contained unresolved user merge conflicts before this request. Audio-specific files and assets are complete, but whole-checkout verification must be rerun after those unrelated conflicts are resolved.

## M40–M44 implementation — 2026-07-24

- Implemented a deterministic, save-versioned six-chapter campaign with three
  objective phases per chapter, recurring cast, state-grounded scenes,
  callbacks, durable choices, medals, rewards, and epilogue facts.
- Replaced the flat in-game feature toolbar with stable Design, Operate, and
  Legacy workspaces, owned SVG iconography, URL-addressable state, alerts, and
  responsive overflow.
- Added a typed browser/desktop/Steam platform boundary and an Electron shell
  with a sandboxed renderer, allowlisted IPC, atomic native storage, rotating
  backups, crash recovery, safe-mode/support plumbing, display bounds, and
  unsigned macOS/Windows CI packaging.
- Added a checksummed, JSON-only content-package format with hostile-input
  limits, identity remapping, quarantine, persistent local library,
  import/export, isolated test play, and optional Workshop publishing.
- Added a demo edition that exposes the complete opening chapter, rejects
  full-only saves, and remains forward-compatible with the full edition.
- Added a single M44 certification manifest and validator. The ship decision
  remains `HOLD` until signing/notarization, licensed-media/store review,
  hardware, ten-player moderated testing, and release-council evidence exist.

### Verification

- Full Vitest suite: 68 files, 414 passed, one intentional skip.
- Native desktop-store tests: 2 passed.
- Full and demo production builds pass with the existing Vite save-store and
  chunk-size warnings.
- Unsigned macOS arm64 application packaging passes; code signing is correctly
  reported as unavailable without a release identity.
- Focused browser acceptance passes for the M40 campaign choice, M43 local
  package/test-play flow, Player Pro/workspace switching, Living Club, and the
  three tournament standards paths.
- The bundled web-game client reports the Legacy workspace, a running
  100-golfer fixture, and no console-error artifact. Campaign, workspace, and
  content-library captures were visually inspected.
- Lint and both localization guards pass with seven pre-existing hook warnings
  and no errors.
- Certification-manifest validation passes and correctly reports `HOLD`.

## M28 and M30 completion pass — 2026-07-24

Current request: “Implement rest of M28 and M30 now”

- Resolved the authoritative remaining scope from Linear: M30 ZK-280–ZK-284 and M28 ZK-253–ZK-261.
- Added the M30 data foundation: bounded per-course 7/28-day pace history, cohort-specific identity, save schema v18 migration, deterministic tee-hour reports, and history normalization.
- Added live operational consequences: configurable last tee/daylight/guest-recovery policies, tournament groups, strict-sunset and congestion exits, marshal pickup recovery, exact course-attributed compensation, and staff overtime.
- Added measured hole occupancy/queue/recovery evidence, spillback-suppressed bottleneck diagnosis, ranked actions/tradeoffs, accessible live heat markers, and grouped pace-report UI.

### Verification and release status

- M30 focused coverage passes alongside live, save, and tournament regressions:
  46/46 tests. The full suite passes 438 tests across 70 files with one
  intentional skip.
- Production build and localization/lint gates pass; lint retains the seven
  pre-existing Hook warnings and no errors.
- M30 browser acceptance passes for identity, measured local peaks, map focus,
  7/28-day filters, and multi-course reporting. The fixture screenshot was
  visually inspected, and the bundled web-game client emitted structured state
  without a console-error artifact.
- M28 clean-profile release acceptance passes on installed Chrome, Playwright
  Firefox, and WebKit (3/3). Golden save/migration/options/accessibility paths
  pass 9/9; PWA offline/install/save persistence and fuzz pass.
- The 81-run, 104-week balance matrix passes. The final-code 30-week soak
  completes 4,638 rounds with 3.01 MB retained-heap growth. Headless renderer work is 0.35 ms
  against the 8 ms budget; headless frame p95 remains report-only.
- Added an evidence-enforcing M28 manifest and validator for `1.0.0-rc.3`.
  Its valid decision is `HOLD`: exact-main deployment, 5–10 unfamiliar-player
  sessions, stable Firefox/Safari sign-off, physical low/mid hardware, and
  resulting triage remain external. No human gate was fabricated.

## Vision/audio audit and Linear bug — 2026-07-24

Current request: “Open a bug in linear that the vision page of the site has two
overlapping background music things playing at same time. Audit test of site and
game to ensure we only have the suno songs we created so there isn’t overlap.”

- Reproduced the Vision-page overlap after the first audio-unlocking gesture:
  `title-01.mp3` and `night-01.mp3` were both unpaused, advancing, and audible.
- Confirmed gameplay similarly mixes one Suno music track with one authored
  Suno ambience track, so the follow-up needs an explicit per-surface policy.
- Audited 40 manifest-owned Suno files, 14 tracked superseded Ogg/M4A tracks,
  and 7 ignored root-level legacy MP3s that can contaminate a local `dist`.
- Confirmed production serves the Suno files and the 14 tracked superseded
  files; runtime TypeScript references only manifest-owned Suno paths.
- Focused checks passed: 6 audio unit tests, 3 audio/Vision browser tests, and
  the bundled web-game Vision smoke with visual inspection and no console error.
  Those tests do not currently assert ambience requests or active audio-element
  exclusivity.
- Opened High-priority Linear bug ZK-443 in `golf-sim`: “Stop overlapping
  background audio on Vision page and enforce Suno-only media.”
- No application code was changed for this audit.

### ZK-443 implementation underway

- Added an explicit `enabled` state to the world ambience mix. Title, setup,
  loading, and Vision surfaces now keep authored and procedural ambience off;
  gameplay enables it.
- Decoupled title music ducking from the paused default game clock so the
  single intended title track plays at its configured volume.
- Replaced shared crossfade tokens with per-element fade ownership and
  request-version guards. Inactive slots now fade to zero and pause even when a
  volume ramp interrupts a transition.
- Moved the 14 tracked superseded Ogg/M4A renders to
  `art/audio/legacy-generated/` and preserved the 7 ignored MP3s in the ignored
  `art/audio/legacy-untracked/` quarantine. Nothing was deleted.
- Added a post-build allowlist audit that requires `public/` and `dist/` to
  contain exactly the 40 assets declared in `sunoLibrary.ts`. The first
  production build passed the new audit.
- Added browser instrumentation for every unattached audio element and all
  file-backed audio requests. Its first rapid Cozy/Architect transition run
  exposed two music slots that never settled because repeated no-op state syncs
  restarted their fades.
- Made unchanged pause and music-context updates no-ops and isolated routine
  ambience-volume updates from music-slot fades. Both focused audio browser
  tests now pass, including Vision exclusivity and rapid transition settlement.

### ZK-443 verification complete

- Added per-slot async play claims so a superseded delayed `play()` cannot pause
  an audio element already claimed by a newer music or ambience transition.
- Final production build passes and the new artifact gate verifies exactly 40
  Suno MP3s in both `public/` and `dist/`, with no other MP3, M4A, Ogg, or WAV
  files.
- Full Vitest passes 439 tests across 70 files with one intentional skip. Lint
  passes with the seven pre-existing Hook warnings and no errors.
- Focused Playwright audio acceptance passes 2/2: Vision has exactly one audible
  title stream, gameplay settles to one music plus one ambience stream, rapid
  Cozy/Architect changes leave no orphaned slot, and every request is a Suno
  MP3.
- The full 53-test browser run produced one unrelated M21 theme-fixture timeout
  under parallel load. Its isolated rerun passes both M21 tests in 3.4 minutes.
- Bundled web-game client captures for Vision and gameplay were visually
  inspected; both emitted structured state without a console-error artifact.
- The source and local production artifact are fixed. Publishing that artifact
  to production remains a separate deployment action.

## ZK-443 follow-up: tutorial/game music ownership — 2026-07-24

Current request: “there is a larger problem that more music starts overlapping
in the game. when i click through to tutorial now sounds like there are 3
different music sounds going on”

- Reproduced the screenshot's Quick Start tutorial-offer path with every
  `HTMLAudioElement` instrumented. The first samples contained three audible
  recordings: `title-01`, `operate-01`, and `rain-01`; after the title fade,
  `operate-01` and `rain-01` remained layered.
- Tightened the product policy from “one score plus one authored ambience bed”
  to one file-backed background recording total. Score context changes now stop
  the outgoing slot before starting the incoming track, and authored Suno
  ambience is allowed only when the music context is silent.
- Procedural camera-aware wind, water, birds, crickets, and crowd detail remains
  on the WebAudio ambience bus because it is environmental texture rather than
  another file-backed song.
- Extended Playwright coverage to sample active audio every 50 ms through
  Vision → Quick Start → tutorial offer → guided tutorial, separate menu →
  game entry, and rapid Cozy/Architect changes. The focused suite passes 3/3
  with no sample containing more than one file-backed background recording and
  no authored ambience request during scored gameplay.
- Final production build passes and still verifies exactly the 40 manifest
  Suno assets in `public/` and `dist/`. Full Vitest passes 441 tests across 70
  files with one intentional skip; lint/i18n passes with the seven pre-existing
  Hook warnings and no errors.
- The bundled web-game client reached the game with structured state and no
  console-error artifact. Its canvas-only capture remained black under both
  headless and headed software GL, so the local tutorial was also verified in
  the full-page in-app browser: the course, guided overlay, highlighted task,
  and controls rendered correctly with no console errors.
- TODO: publish this follow-up and re-run the same active-stream audit against
  the deployed Workers URL before closing ZK-443.

## ZK-445 Hole Wizard zoom ownership — 2026-07-24

Current request: “record a bug in linear that when in hole wizard it won't let
you zoom (looks like it tries to snap to the entire hole). then try to fix the
bug”

- Opened high-priority Linear bug ZK-445 in `golf-sim`, related it to the
  completed general trackpad issue ZK-264, marked it In Progress, and attached
  the user screenshot.
- Reproduced the hole-editor camera feedback defect with a focused Playwright
  regression: a centered manual zoom caused the explicit Fit command to be
  discarded because Pixi classified camera echoes by matching center
  coordinates.
- Replaced coordinate-based echo detection with exact object-identity
  ownership. Manual camera reports now persist the live target zoom and drop
  the auto-fit bounds, preventing a later state round-trip from reapplying the
  whole-hole framing.
- Added Safari `gesturestart`/`gesturechange`/`gestureend` pinch support on the
  course surface, with native page zoom suppressed and pinch scale translated
  into the same cursor-anchored logarithmic zoom contract as wheel input.
- Focused unit coverage and TypeScript checks pass. The targeted browser
  regression now covers wheel zoom, stable settling, explicit Fit after manual
  zoom, Safari-style pinch zoom, and post-pinch persistence.
- The required bundled web-game client completed on the M23 hole-editor fixture
  with structured state, a rendered course capture, and no console-error
  artifact.

### ZK-445 remaining

- None for the scoped fix. The final focused screenshot was inspected; the M12,
  scenic-surround, and ZK-445 browser regressions pass 3/3; focused lint has no
  errors; and a direct production Vite bundle passes.
- Verification evidence was posted to Linear and ZK-445 is Done.
- The aggregate `npm run build` remains blocked by an unrelated concurrent
  `App.tsx` edit that calls `getPinPosition` without importing it. That file is
  outside the ZK-445 change set and was left untouched.

## 2026-07-25 — connected landscape hazards, bunker silhouettes, and tree habitat

Current request: remove hill-shaped water, add semantic collars/fringe/rocky
banks, keep dry-land props out of water, make single and connected bunkers
iconic rather than square, and give trees/rough the grounded detail of the
classic course-builder references.

- Water and wetland strokes now compute authoritative, deterministic grading
  in the same preview/commit transaction as paint. A touched lake is flattened
  as one component; water excavates below its lowest land edge, wetland stays
  shallower, grading never raises terrain, and exact earthwork cost is shown.
- Water edits clear trees, bushes, and boulders only in the touched wet
  component. The removal is atomic with paint/economics, increments obstacle
  invalidation, and round-trips through undo, redo, quick save, and load.
  New obstacle placement on water/wetland is rejected. Protected-tree cells
  are clipped from wet masks and remain explicit dry-land islands.
- Re-authored the water material as a flat low-variance field with restrained
  horizontal ripples instead of crossing contour-like waves. Connected water
  now has a rough bank, stone shelf, waterline, highlight, and deterministic
  capped shoreline rocks.
- Added semantic connected edges: fairway and sand receive rough collars,
  greens receive rough plus a broad fringe, and deep rough feathers into base
  rough. Priorities keep shared borders single-owned and stable at all camera
  rotations.
- Added original deterministic bunker silhouettes. A one-cell bunker becomes
  a compact asymmetric kidney/pot shape fully inset within its cell; connected
  sand merges into one scalloped contour with rounded bays and necks. Rough is
  rendered beneath the complete authoritative footprint, so square sand
  corners cannot leak outside the organic mask.
- Added deterministic tree habitat beds in the decal layer: pine/fir variants
  receive pine straw, broadleaf trees receive leaf litter/exposed soil, and
  desert trees receive dry soil/pebbles. Overlapping lobes, roots, and sparse
  details produce organic boundaries; quality-tier budgets cap the additional
  graphics and tree shadows are reduced so the habitat remains readable.
- Fixed the runtime service-worker cache race discovered by the final PWA
  smoke: cache-on-demand biome responses now await `cache.put` before the
  response resolves, guaranteeing already-loaded biome assets survive an
  immediate offline transition.
- Verification passes: 88 Vitest files / 545 passed with one intentional skip;
  TypeScript; lint/i18n with 12 existing Hook warnings and no errors;
  production build/audio/biome budget audit; strict-CSP PWA/offline/save smoke;
  M20 three-theme/four-rotation/detail browser coverage; the water grading,
  prop clearing, undo/redo, and save/load browser regression; performance smoke
  at 0.36 ms renderer work against the 8 ms budget; bundled-client structured
  state with no error artifact; and `git diff --check`.
- Visually inspected the Parkland/Links/Desert material captures and the final
  water close-up. Bunkers read as inset organic hazards with rough lips; both
  lakes are flat and banked with no props in their coverage; tree habitat is
  differentiated by species instead of using one generic dark stamp.

## 2026-07-25 — M35 certification handoff

- Implementation candidate is complete in the dirty working tree, but release
  certification remains HOLD pending an exact commit, physical-GPU frame p95,
  fresh ZK-473 visual parity review, and explicit ZK-466 human approval.
- Verified now: 88 Vitest files / 552 passed / 1 skipped, TypeScript, lint with
  no errors, production build and asset audit, strict-CSP PWA/offline/save,
  1.08 ms renderer work, and `git diff --check`.
- Focused onboarding M14 B passes the full reload/resume/rerun flow in 11.5m;
  the keyboard save/load case passes in isolation. M17/M27/M6/M7 reruns were
  interrupted and remain pending. Full details and handoff commands are in
  `docs/M35_CERTIFICATION.md`.

## 2026-07-28 — ZK-485 M47 certification preflight HOLD

- Loaded ZK-485 and verified its mandatory rule: stop if ZK-480 through ZK-484
  are marked Done in Linear but their implementations are absent from the task
  base.
- On `develop` at `1dbf9b5`, the five M47 dependency contracts are not present:
  live capabilities, strategic options, shared-physics live outcomes, personal
  reaction evidence, and the expanded Golfer Inspector explanation surface.
- Preserved the pre-existing dirty worktree and added the exact preflight,
  environment, baseline results, missing-contract evidence, matrix status, and
  next-pass requirements to `docs/M47_CERTIFICATION.md`.
- Baseline checks pass: 89 Vitest files / 554 tests with one intentional skip,
  lint with 11 existing Hook warnings and no errors, production build and M35
  asset audit, and `git diff --check`. M47-specific fixtures and full release
  certification were not run because the required preflight stopped first.
- Decision remains HOLD; do not mark ZK-485 Done or unblock ZK-486 until the
  five dependency implementations are integrated and the matrix is rerun.

## 2026-07-28 — ZK-485 dependency implementation pass

- Audited all local branches plus the two additional live remote refs; neither
  contained ZK-480–ZK-484 implementation work, so the missing contracts were
  integrated on `develop` without resetting the pre-existing dirty worktree.
- Added seeded multidimensional golfer capabilities, deterministic strategic
  options with rejected alternatives and facts, shared Player Pro physics for
  live shots, per-hole evidence-based reactions, v4 live-save migration, and
  completed-round evidence retention.
- Expanded the Golfer Inspector with localized identity, capability, plan,
  alternative, outcome-fact, and reaction surfaces. Course-edit replanning now
  preserves committed M47 evidence while rebuilding only the unplayed tail.
- Focused verification passes: M47/live/persistence suites — 3 files, 38
  tests passed; TypeScript build passed. Full M47 certification remains HOLD
  pending release-scale determinism, performance, accessibility, and browser
  evidence listed in `docs/M47_CERTIFICATION.md`.
- Final repository test pass: 92 files, 786 passed, 1 skipped; lint and
  production build remain green.
- Additional regression checks pass: reducer fuzz (3 tests) and the 81-run
  release balance matrix (all states finite; no normal-path bankruptcies).
- The 100-golfer performance smoke also passes at 0.37 ms renderer tick work
  against the 8 ms budget; the 36-hole fixture loaded in 5.27 s.

## 2026-07-28 — ZK-485 M47 certification PASS

- Added deterministic M47 certification fixtures for 9-, 18-, and 36-hole
  rounds, the tournament field, and ten reference-golfer strategy-matrix rows.
  Plan, physical outcome, reaction, and save hashes are written to
  `artifacts/m47/certification.json`.
- Added bounded persistence limits for 36 plans, 240 outcomes, and 36
  reactions, plus save/reload coverage that preserves golfer evidence.
- Added the M47 Inspector browser fixture and release-browser coverage for
  evidence text, rejected alternatives, follow-toggle focus, pseudo locale,
  color-vision, terrain patterns, reduced motion, 130% text, responsive bounds,
  and visual captures at desktop and 390px widths.
- Certification passes: M47 CLI; 30-week/3,854-round soak with 3.02 MiB
  post-GC retained-heap growth; 93 Vitest files / 792 passed / 1 skipped;
  TypeScript; lint/i18n; production build; fuzz; 81-run balance; 0.38 ms
  renderer performance; PWA/offline/save; targeted M47 browser; and 6/6
  Chrome/Firefox/WebKit release-browser tests.
- Updated `docs/M47_CERTIFICATION.md` with exact hashes, counts, screenshots,
  gate results, and the M48 handoff contract. ZK-485 is ready for Done and the
  ZK-486 blocking relation is ready to remove.

## 2026-07-28 — ZK-374 moderated-study handoff

- Re-read ZK-374 and its existing certification record: automated/internal
  certification is complete, while the moderated first-time-player study is
  still the only open gate.
- Launched the current build and inspected the participant path from a fresh
  profile through Career → The Back Nine. Rowan’s opening scene renders with
  the authored phase, live cash/condition facts, and the two opening choices.
- No implementation changes were made. The issue remains In Progress until a
  human participant completes the 12–18 hour study and its report is attached.

## 2026-07-29 — M29 current production telemetry/offline smoke HOLD

- Ran a clean Chromium smoke against the live Workers production URL at the
  current release `coursecraft@1.0.0-rc.3+9717dc42d717` / commit
  `9717dc42d717403e7a5abad34a8a6dd4a0e3df6b`.
- Hosting, current main CI/deploy, online game render, service-worker control,
  offline reload, and local persistence passed.
- The controlled Sentry event carried the expected production release/commit
  tags and sanitized payload shape but was rejected with HTTP 403. The public
  bundle also contains an empty Cloudflare Web Analytics token; no beacon or
  Cloudflare Insights request was observed.
- Attached `artifacts/m29-production-smoke-2026-07-29.md` to ZK-271 and ZK-274
  and added current blocker comments. Both issues remain In Progress; external
  Sentry/Cloudflare configuration must be corrected before rerunning closure.

## 2026-07-29 — M29 final production certification PASS

- Re-ran the clean Chromium telemetry/offline smoke against the canonical
  production origin `https://coursecraftgame.com/`, which is explicitly mapped
  to the production Sentry environment. The Cloudflare beacon request returned
  HTTP 200, and the controlled Sentry event returned HTTP 200 and was
  independently indexed with the expected production release and commit.
- The accepted payload exposed only request `url`; user, breadcrumbs, and extra
  fields were absent. Online render, service-worker control, offline reload,
  and local persistence passed.
- Current and immediately preceding main production deployments passed in
  runs 30417545211 and 30415720800. Workers playtest hosting/offline checks
  also passed on `coursecraft-playtest.zbkutlow.workers.dev`.
- Attached `artifacts/m29-production-smoke-final-2026-07-29.md` to ZK-271 and
  ZK-274, added closure comments, and moved both Linear issues to Done.

## 2026-07-29 — M35 terrain hardening handoff

- Preserved the completed M35 implementation and hardened two agent-verifiable
  edges: legacy 110×70 grid migration now translates surface knots, tangents,
  render rings, and row-major coverage into the centered estate; valid
  same-terrain authoring gestures now persist visual intent instead of being
  treated as no-ops; mismatched feature/stroke metadata is ignored safely; and
  failed lazy biome bundle requests can retry after a transient error.
- Added focused regressions for same-terrain feature persistence and legacy
  surface-intent migration. `npx vitest run` on the relevant 13 files passed
  264 tests; `npx tsc -b --pretty false` passed; `npm run audit:m35-assets`
  passed with all three biome tiers, 10 high/medium fields, low-tier field
  omission, and the 3.54 MiB initial-critical report; `git diff --check`
  passed.
- The pre-change M35 browser rerun passed all 3 required suites in 2.1m. After
  the hardening patch, landscape details and surface authoring passed (2/3);
  water grading was intentionally interrupted at the user's wrap-up request
  and is not reported as green. The inspected M35 screenshots show connected
  water/bunker silhouettes, banks, material fields, and node editing.
- No build or lint was started after the final patch, and no production,
  provider, Linear, or human visual approval was claimed. ZK-466 remains
  explicitly deferred; ZK-473 and physical-GPU certification remain open.

## 2026-07-29 — M35/M42/M43 implementation integration checkpoint

- Integrated the agent-verifiable feature work into clean `develop` commit
  `49947b4`. M35 remains open for fresh-agent visual parity and human approval;
  M42 remains open for real Steam/provider and signed-release confirmation; M43
  remains open for cross-platform/manual Workshop certification.
- Combined validation is green: desktop tests 10/10; full Vitest 97 files,
  811 passed, 1 skipped; lint 0 errors with 11 existing React Hook warnings;
  TypeScript/build passed; M35 asset audit passed.
- Human/provider gates are intentionally deferred in Linear per project-owner
  direction. No issue was marked Done from agent reports alone.

## 2026-07-29 — ZK-470/ZK-471 focused verification hardening

- Reconfirmed the existing render-only shared-vertex heightfield and COZY /
  Architect framing candidate from the clean `b405ed7` baseline in an isolated
  worktree. Added a deterministic regression proving heightfield generation
  leaves the complete serialized course contract unchanged, and a browser
  regression covering COZY, Architect, and the explicit `F` overview control.
- Focused geometry tests (10), the new focused browser test, the existing M35
  landscape-details browser fixture, typecheck, lint (11 existing warnings,
  no errors), build, M35 asset audit, and the bundled client capture passed.
- Visual evidence was inspected locally; the remaining M35 fresh-context and
  human visual gates are still required and are not claimed by this work.

## 2026-07-29 — Ranked implementation wave 2

- Added a topology-skeleton cache for connected landscape components. Dirty
  terrain updates still flood-fill authoritative cells, but unchanged
  components now reuse their rounded rings and bounds; quality-tier corner
  options remain isolated cache namespaces.
- Added cache hit/miss and quality-switch regressions in
  `src/game/render/landscapeGeometry.test.ts` and wired the cache into
  `PixiStage` without changing gameplay ownership, elevation, picking, saves,
  or hashes.
- Focused landscape geometry tests (12), TypeScript, M35 surface-authoring
  browser coverage, and the ZK-470/ZK-471 visual-foundation browser coverage
  passed. The bundled web-game client also loaded without a console-error
  artifact; its latest screenshot was visually inspected.
- Parkland 4× contract hardening was integrated in commit `350fef4`; its
  audit, typecheck, lint/i18n, focused terrain/accessibility tests, and
  production build passed. Generated candidates remain review-only.
- UI iconography/design-system hardening was integrated in commit `40a223d`;
  shared workspace/inspector SVG chrome, state tokens, accessible tabpanels,
  and pseudo-locale overflow coverage passed its focused browser contracts.
- Combined verification now passes: 98 Vitest files / 821 passed / 1 skipped,
  lint with 0 errors and 11 existing React Hook warnings, production build,
  audio/M35/Parkland audits, and independent ZK-376/ZK-377 browser runs.
- Human visual parity, physical-GPU, provider, and release-owner gates remain
  intentionally open.

## 2026-07-29 — Ranked implementation wave 3

- Implemented the machine-verifiable M50 rules foundation in `src/game/rules`:
  shared lie/collision/ruling/relief contracts plus deterministic round-snapshot
  encoding with row-major RLE, connected penalty components, stable ordering,
  malformed-input rejection, and the bounded 4,000,000-byte snapshot cap.
- Fixed the audio manager's recycled `preload=none` slot race. Reused slots now
  explicitly restart resource selection, and identical in-flight music context
  requests are coalesced instead of interrupting the pending playback.
- Expanded ZK-443 certification across Vision/title, Design/Operate, Player Pro,
  tournament, tension, victory, pause, and rapid context changes. The exact 40
  Suno manifest, bounded active streams, media errors, and console/page errors
  are now checked; expected Chromium `ERR_ABORTED` requests from intentional
  slot replacement are excluded from failure reporting.
- Validation is green: focused rules/audio tests 14/14, full Vitest 100 files /
  827 passed / 1 skipped, TypeScript, scoped lint, production build and asset
  audits, four audio E2E tests, and the bundled web-game client smoke capture.
- Human visual/provider/release-owner checks remain intentionally open; M50
  save migration, Player Pro/live integration, and downstream ruling work stay
  sequenced behind this foundation.

## 2026-07-29 — Ranked implementation wave 4

- Implemented the M50 save v20 foundation: deterministic v19→v20 migration,
  active-round snapshot derivation, hostile course/grid invalidation, and
  completed-shot history preservation.
- Added the shared eight-club lie/flight-effects layer with bounded recovery
  scaling, deterministic punch/flop flight profiles, and zero penalties for
  ordinary playable lies. Player Pro and live outcomes now share the same
  physical resolver and optional outcome payload.
- Added frozen penalty-area classification, map/ownership out-of-bounds
  handling, raw ground-path rulings, and deterministic red/yellow/OB relief
  candidate selection. `render_game_to_text` now exposes snapshots, lie
  effects, flight, collision, ruling, relief, physical rest, and final position
  for active and completed rounds.
- Completed the machine-verifiable ZK-443 artifact closure: superseded local
  legacy audio was quarantined, release audits reject non-Suno runtime media,
  and the exact 40-file manifest remains enforced.
- Validation is green: full Vitest 105 files / 859 passed / 1 skipped, typecheck,
  lint with 0 errors and 11 existing React Hook warnings, production build and
  asset audits, M36 Player Pro E2E, four ZK-443 audio E2E tests, and the bundled
  web-game smoke capture.
- Human licensing/listening confirmation for audio and broader manual visual
  acceptance remain intentionally open; no Linear issue is marked Done from
  automated evidence alone.

## 2026-07-30 — ZK-542 M51 portable-state foundation

- Moved Cart Rental offers and individually addressable fleet ownership to
  portable course M51 state; World now retains only bounded settled evidence
  and compact pace/economic aggregates.
- Save v22 deterministically migrates legacy Cart Rental price to riding-cart,
  synthesizes the balance-defined pushcart offer, and preserves tier/building
  compatibility. Live snapshots, hashes, and course packages normalize the
  same canonical contract and remap building references on import.
- Focused validation: 35 M51/save/live/package/hash tests and TypeScript
  typecheck pass; no broad certification commands were run.

## 2026-07-30 — ZK-543 M51 weighted travel router

- Added a bounded deterministic M51 timed-leg router/cache for walk, pushcart,
  and riding-cart modes. Walking delegates directly to the established
  passability/path authority; carts apply mode terrain/slope/path/weather rules
  and only then use a safe walking fallback.
- Cache identity includes mode, endpoints, geometry revision, and weather or
  operational restriction identity. Full tile evidence is retained before
  renderer waypoint simplification; the prediction API is read-only.
- Focused routing, itinerary, ordinary-live, and M47 regressions pass (43
  tests), along with TypeScript typecheck and whitespace validation.

## 2026-07-30 — M51 Wave 3 coordinated mobility operations

- Implemented ZK-545 group-level walk/pushcart/riding-cart selection using
  stable golfer preferences, burden, course condition/value, price and wallet,
  weather, authored-path utility, facility tier, and service coverage.
  Reservations use group-size pushcarts or ceil(group/2) riding carts with
  stable seats and per-golfer core concession transactions. Stockout,
  affordability, disabled/no-facility, tournament, reload, edit, daylight, and
  abandonment paths fall back/release without duplicate charges or fleet leaks.
- Implemented ZK-546 product-level revenue, per-use cost, utilization,
  stockout, return, condition, and wear settlement. Daily ledgers are
  idempotent and bounded to 28 days; weekly reports merge exact-cent product
  rows and retain deterministic course/facility allocation. Rental revenue
  remains in the existing concession/cash authority.
- Implemented ZK-547 itinerary application through the weighted M51
  router/cache. Riding carts prefer authored paths, pushcarts receive a modest
  speed improvement, protected/inaccessible/wet endpoints walk legally, and
  actual travel/service delay flows through existing pace, blockage, daylight,
  marshal, satisfaction, and observed evidence. Off-path wear is bounded.
- Added focused operation, routing, persistence, settlement, weekly-ledger,
  day-rollover, interruption, edit/reload, and no-duplicate-charge coverage.
  No ZK-554–ZK-557 UI, demand/value, or identity work was added.
- Final verification passes: 12 focused files / 98 tests, TypeScript project
  build, and whitespace validation. The bundled gameplay client reached a
  fresh live game with valid text state; its rendered capture was inspected
  and no console-error artifact was produced.

## 2026-07-30 — M51 Wave 4 operations, architecture, and visuals

- Added ZK-554's read-only Operate mobility report. It derives current-day and
  bounded 7/28-day values exclusively from live M51 evidence and settled
  product ledgers, including fleet/utilization, demand-state distinctions,
  factual recommendations, observed minutes saved, and net per occupied tee
  hour. It does not settle cash or introduce a new economics authority.
- Added ZK-555's bounded predicted Mobility Architecture Review overlay. It
  uses the existing timed router and weather restrictions, exposes mode
  filters, traces/cells/transfers/utilization, and gives separate prohibited
  versus unreachable/missing-link explanations without mutating live state.
- Added ZK-556's shared fleet-unit renderer contract. Unit IDs deduplicate
  riding-cart riders, include parked and walking-connection states, preserve
  mobility evidence in the golfer inspector, and use static shape fallbacks
  without optional/unlicensed art.
- Focused Wave 4/M51 tests pass (23 assertions across five files), as do the
  application TypeScript check and whitespace validation. Per request, no
  human visual/accessibility/gameplay check or ZK-557 work was performed.

## 2026-07-30 — ZK-557 demand, value, and course identity

- M49 now consumes only completed M51 assignment facts: selected mode, actual
  travel and round pace, price/service delay, walking fallback, stock-outs,
  weather/policy restrictions, and tournament walking-only policy. Current
  path/offering state remains explicitly predictive; fleet quantity never
  increases M49 value without observed use.
- Segment demand, satisfaction/value, willingness to pay, return/recommend
  intent, churn, amenity support, identity, report causes/alerts, and mobility
  marketing credibility now reflect bounded observed mobility history. Old M49
  records keep mobility absent, rather than receiving fabricated observations.
- Fixed-seed tests cover walking-first, pushcart-oriented, and riding-cart
  viable fixtures; segment-sensitive stock-out/price/policy outcomes; honest
  marketing and tournament policy; report causes/alerts; migration; and
  normalized save/hash stability. Focused M49/M51/tournament/save suite: 32
  tests passed. Production TypeScript build and asset checks passed.

## 2026-07-30 — ZK-558 final machine-only certification

- The pre-addition M51/M49/save/live/M47/M50 compatibility slice passes 19 files / 126 tests.
- Isolated and repaired two in-scope machine failures: the mobility Architecture Review state was not reachable from its overlay selector, and all new M51 UI copy failed the typed i18n extraction guard.
- Added localized Operate, Architecture Review, and Golfer Inspector mobility copy plus a browser contract for selector reachability, dialog/tab/select semantics, structured text state, and pseudo locale.
- Added final deterministic fixtures for three viable mobility strategies, M47/M49/M50 compatibility, save/import and active snapshot hashing, and a bounded 220×140/36-hole/100-golfer route/live/render workload. The focused certification passes 2/2 tests in 43.98s; TypeScript and i18n pass.
- No distinct product feature work was introduced; both repairs are ZK-558 certification regressions. Human and external release gates remain deferred, and no Linear/commit/push/deploy action was taken.

## 2026-07-30 — M50 bounded AI round hot-path repair

- Added a narrowly gated round-summary fast path for explicit manual-par,
  complete, in-bounds, non-fallback tee/pin setups. It supplies only the
  completion, validity, and par facts needed by strategic round planning, so
  eligible rounds avoid the full per-hole Dijkstra scoring pass.
- AUTO, malformed/manual-invalid, missing, out-of-bounds, overlapping, and
  tee/pin-fallback setups still call the existing `scoreCourseHoles` path.
- Added focused M47 regression coverage for fast-path eligibility and fallback
  boundaries. Final M47 certification: 6/6 tests, 11.42s Vitest / 11.81s
  process wall time. Final M50 certification: 3/3 tests, 4.02s Vitest /
  4.41s process wall time. M50 internal performance fields: AI round
  630.686ms, full-estate fixture 16.883ms, render-state average 0.009834ms.
- TypeScript build check passed in 5.24s process wall time; diff check passed.
- No commit, push, deploy, Linear update, or generated artifact was left.

## 2026-07-30 — ZK-559 biome and climate content contract

- Added one typed biome registry owning current generation tuning, climate and
  four-season phenology, presentation/preview metadata, material/prop/structure
  ownership, audio routing, and save/content compatibility for Parkland, Links,
  and Desert. `LandTheme` and the runtime theme list now derive from its keys.
- M39 weather consumes resolved semantic climate state with no theme-string
  branches. Full-output SHA-256 baselines pin nine generated estates and four
  weather years per biome to their pre-M52 results.
- Registry/theme/generation/seasons tests pass (27), adjacent material/prop/
  audio/authoring tests pass (211), and the application TypeScript check passes.
- This is a contract/model migration with deliberately identical visuals and
  gameplay output, so no bundled-client run was warranted. ZK-560 retains the
  wider registry-driven consumer migration.
- Independent review tightened the boundary: the original top-level
  `LandThemeDefinition` API is preserved through a facade derived entirely
  from the new registry, leaving consumer-shape migration to ZK-560. The
  runtime audit now rejects malformed generation/climate ranges, preview
  colors, compatibility versions/keys, and colliding legacy aliases.

## 2026-07-30 — ZK-561 deterministic biome climate and phenology

- Added the pure, frozen `biomeClimatePhenologyForDay(theme, absoluteDay)`
  projection. It carries fixed calendar progress, a bounded 14-day transition
  (seven days on each side of a calendar boundary), blended numeric climate
  and vegetation values, and categorical foliage/moisture handoff metadata.
  It does not serialize or mutate calendar, weather, or save state.
- Extended the biome contract with phenotype regime/exposure metadata:
  Parkland is temperate, Links is explicitly exposed coastal, and Desert uses
  an arid heat/drought cycle. Tropical wet/dry and Alpine frost/snow are typed
  future contracts only; `BIOME_KEYS` remains Parkland/Links/Desert.
- Focused tests prove deterministic seed/biome/day output, each boundary's
  bounded continuity, calendar immutability, save/reload/long-year stability,
  and the pre-M52 four-weather-year SHA-256. Registry validation rejects an
  unsupported phenology regime.
- Verification: focused biome/seasons/theme suite (3 files, 32 tests),
  TypeScript project build, and `git diff --check` all pass. No visual-client
  run is needed because this is a read-only semantic contract with no visible
  consumer yet. No ZK-560 consumer/package/render migration was added.

## 2026-07-30 — ZK-560 registry-driven biome consumers

- Routed generation, terrain economics and penalties, estate values, relief,
  material fields/details, natural props, structures, decorations, scenic
  surround, previews, labels, audio, scenarios, content packages, Player Pro,
  live snapshots, developer fixtures, balance runs, and atlas tooling through
  `BIOME_DEFINITIONS` or `BIOME_KEYS`.
- Removed renderer cross-biome Parkland substitution. Registered biomes now
  keep their own content owner and use an explicitly warned, observable
  procedural fallback when optional art is missing; atlas diagnostics retain
  bounded fallback evidence.
- Build tools parse the authoritative TypeScript registry with the TypeScript
  AST, authoring profiles fail closed on key drift, and the production build
  runs a static consumer audit. The one explicit current-schema theme allowlist
  in `save.ts` is asserted as a narrow ZK-563-owned exception.
- Added exhaustive generation/render-contract smoke coverage and a browser
  flow that creates a playable course from every registered new-game card.
  Focused Vitest passes 13 files / 270 tests; TypeScript, i18n, biome audit,
  production build and asset audits pass. M21 plus ZK-560 Playwright passes
  3/3 with no asset, console, or page errors.
- The bundled client produced valid structured Parkland gameplay state and no
  error artifact; its SwiftShader canvas capture was black. Full-page
  Parkland, Links, and Desert Playwright captures were inspected and showed
  distinct intact course renders. Tracked M21 baseline images were restored.
- ZK-563 still owns replacement of the save normalizer's explicit legacy
  theme allowlist. No commit, push, deploy, or Linear mutation was performed.
- Independent review found and repaired one remaining fixed-biome HUD label.
  Course vibe tone still uses the existing slope/difficulty/aesthetics
  thresholds, while biome identity now comes from `BIOME_DEFINITIONS` through
  localized message templates. Unit coverage pins every registered biome and
  pseudo locale; the consumer audit rejects the stale fixed phrases.
- The refreshed ZK-560 browser flow passes 1/1 for all three registered
  new-game paths with exact positive/negative HUD identity assertions and no
  asset, console, or page errors. Fresh Parkland, Links, and Desert captures
  were visually inspected and show the correct biome-specific label and
  distinct intact terrain.

## 2026-07-30 — ZK-562 seasonal biome bundles and incremental loading

- Upgraded the stable biome discovery manifest to schema v2: every
  biome/quality tier now owns one immutable base bundle plus optional
  per-season material, prop, and decal overlays. The build convention emits
  only authored overlay layers; absent seasons remain base-only, and Low
  rejects all expensive seasonal detail.
- Added a strict runtime schema and an explicit in-memory v1-to-v2
  compatibility path. Base and overlay requests have separate promise/cache
  identities, selected content-owner routes stay isolated, required-base and
  manifest failures remain retryable, and an optional overlay failure records
  bounded diagnostics while leaving the base playable.
- Hash/bundle audits now validate either deployed v1 or current v2, every
  overlay asset hash and selected base-plus-overlay payload, allowed season
  keys, and the Low policy. PWA smoke now inspects CacheStorage to reject
  unselected-biome leakage and prove every requested biome asset is available
  offline.
- Focused schema/loader coverage passes 7 tests, including v1 compatibility,
  selected-season isolation, missing-overlay fallback, overlay retry without a
  base redownload, and Low omissions. TypeScript, targeted lint/syntax checks,
  production build, both terrain/asset audits, and whitespace validation pass.
- Actual selected payloads are bounded: Parkland/Links/Desert High peak at
  3.344 MiB, Medium at 2.821 MiB, and Low at 2.093 MiB, all below 6 MiB;
  initial critical transfer is 3.582 MiB.
- The bundled client reached Spring Parkland gameplay with valid structured
  text state, no console/page-error artifact, and a visually inspected intact
  Pixi course capture in `artifacts/zk-562/bundled-client/`.
- Final exact-candidate PWA smoke passes strict-CSP gameplay, selected-biome
  cache isolation with no unselected-biome leakage, scoped service-worker
  install, offline reload of every requested hashed asset, and local save
  persistence. No machine-only infrastructure check remains open.
- Independent-review repair: `App` now passes the existing world-owned club
  season into `PixiStage`; both initial atlas load and the post-ready reload
  include it, and the reload effect depends on season. Atlas activation uses a
  monotonically increasing request identity, so a late prior-season download
  can populate its cache but cannot replace the current base/overlay.
- The focused loader suite now passes 8 tests, including a controlled
  late-Spring/current-Autumn race. A production Playwright regression injects
  missing Spring and Winter overlays, observes both current-season requests,
  advances the real M39 calendar, and proves the base remains rendered with no
  console/page errors. Its full-page Winter capture and the required bundled
  client's Spring capture were visually inspected; client text reports Pixi,
  Parkland, High quality, and the correct Spring calendar with no error file.

## 2026-07-30 — ZK-563 biome persistence and package compatibility

- Added save schema v23 with canonical, versioned biome/content/climate
  compatibility evidence on courses and active Player Pro/live round
  snapshots. Historical Parkland/Links/Desert key or display-label spellings
  normalize losslessly; unsupported or contradictory evidence fails closed
  before a save slot or active run can be partially replaced.
- Registered-biome identity now survives manual saves, rotating autosaves,
  export/import, native desktop atomic-file storage, scenario definitions and
  fixtures, active-round restoration, and both course and challenge packages.
- CourseCraft packages now verify manifest/course biome agreement, supported
  content versions, and exact climate phenology/exposure metadata. Older
  compatible packages are canonicalized and re-checksummed on import; future
  or unknown contracts are quarantined with explicit errors.
- Package revisions use content-addressed storage keys and update the library
  manifest atomically. Interrupted imports preserve the previous readable
  revision, while interrupted deletes preserve the manifest until committed.
- The ZK-560 save allowlist exception is removed. The consumer audit now
  requires registry-based key/metadata validation and forbids all fixed save
  allowlists.
- Automated verification: TypeScript, lint/i18n, the biome-consumer audit, 12
  focused save/package/scenario/round/platform files (98 tests), and the full
  repository suite (124 files, 969 passed, one intentional skip) pass,
  including package fuzzing, malformed inputs, interrupted commits,
  deterministic state, and all registered biome round trips. No browser run
  was needed because this packet changes serialization/validation/storage
  only and no visible path.

## 2026-07-30 — ZK-623 biome-aware UI theming contract

- Added a typed `BiomeUiTheme` boundary sourced from `BIOME_DEFINITIONS`.
  It exposes only contrast-safe contextual accent, low-emphasis surface/edge,
  climate-derived motif, and season/weather cue variables. It explicitly
  forbids biome-specific layout, command order, shortcuts, typography, icons,
  semantic roles, permanent controls, and the CourseCraft focus indicator.
- The stable CourseCraft shell now receives data attributes and CSS variables
  for its course frame/sidebar edge; the new-game wizard uses the same narrow
  contract for selected-land feedback and a non-interactive contextual motif.
  Invalid/incomplete biome input falls back to the registry default. Color
  vision variants use distinguishable safe accents; reduced motion removes the
  contextual transition. No UI state enters saves or simulation.
- Focused contract tests cover registry mapping, WCAG-AA accent contrast,
  fallback, CVD/reduced-motion variables, and weather cues. Browser coverage
  verifies Parkland/Links/Desert wizard and in-game shells preserve one command
  hierarchy and focus token, plus reduced-motion behavior. Shell references
  now load the populated M21 fixture and first capture the Pixi terrain
  canvas, preventing a timing-only blank-canvas screenshot from becoming
  evidence. Reference captures:
  `artifacts/zk-623/{wizard,terrain,shell}-{parkland,links,desert}.png`.
- Verification: focused `biomeUiTheme` Vitest (4 tests), integrated
  TypeScript, lint/i18n (0 errors; existing hook warnings only), and ZK-623
  Playwright (2 tests) pass. The required bundled web-game client produced
  valid menu text state with no error output and its capture was inspected.
  Human visual/aesthetic approval remains intentionally deferred to the final
  validation gate.

## 2026-07-30 — ZK-564 deterministic biome authoring audits and fixtures

- Added one registry-driven, deterministic authoring reference course for each
  registered biome. Every fixture guarantees all 10 terrains, all three
  natural-prop families, all four structures, all 11 decorations, all four
  semantic climate states, compatibility provenance, and 16 standard camera
  bookmarks: overview/build/golfer-follow/direct-play at rotations 0–3.
- Added a fail-closed manifest/frame audit covering terrain families, natural
  props, buildings, decorations, audio contexts and provenance, content-
  addressed asset provenance, Low/Medium/High policy, explicit biome fallback,
  and a 6 MiB selected-payload cap. Machine-readable outputs are
  `artifacts/zk-564/biome-{authoring-audit,missing-assets,payload-report}.json`
  plus `biome-reference-fixtures.json`. Current result is PASS with zero
  required gaps and zero over-budget tiers; 45 optional base/seasonal omissions
  and three explicit fallback contracts are distinguished rather than hidden.
- Negative coverage removes required Parkland tree frames and a Links bridge
  fixture, sets the payload budget to exactly `selectedBytes - 1` and proves
  `overByBytes = 1`, rejects a real SHA-256 content/filename digest mismatch,
  and rejects Low tiers that ship prohibited detail, prop, or field layers.
  Current logical report SHA-256 is
  `009f7acf540f7ba1d2f3e7e38cd6964070fe9fe53b896468478480bb13fcdf4e`;
  fixture-report SHA-256 is
  `12ae3d207c058174e15c11faf183004538fbb7755c4bebc4f6a29beabfb88ad9`.
- Verification: focused Vitest passes 6/6; TypeScript, targeted lint (zero
  errors; existing App hook warnings only), biome-consumer audit, and diff
  integrity pass. ZK-564 Playwright executes all 48 states across three
  biomes × four modes × four rotations, including real golfer-follow and
  direct-play behavior, and produces 12 bounded mode captures. The captures
  were visually inspected as populated and distinct with no console/page
  errors. The bundled web-game client reached the Links fixture twice with
  structured state covering every terrain/prop/decor category, no error
  artifact, and an inspected populated canvas/minimap capture.
- Human art direction, aesthetics, and final gameplay validation remain
  intentionally deferred to the final human gate.

## 2026-07-30 — ZK-565 M52 machine certification

- Certified immutable candidate
  `a26e1346a6af451d1f42f7d1face459f3971327b` as machine **PASS**. The first
  candidate exposed a real schema-v23 save/reload hash-parity defect; the
  reviewed repair now canonicalizes and validates top-level and active-round
  biome identity before hashing.
- Fresh exact-candidate verification passes: full Vitest (125 files, 980
  passed, one intentional skip), production build, lint/i18n, biome consumer
  and authoring/asset audits, 9 focused save/package/atlas files (71 tests),
  13 Playwright scenarios including all 48 biome/view/rotation states, PWA
  offline/cache isolation, the 100-golfer performance smoke, and two bundled
  client scenarios with inspected screenshots/text and no error artifact.
- Fresh budgets: 847 ms cold start, 3,913 ms fixture load, 0.369 ms renderer
  JS work, 3.582 MiB initial non-audio critical payload, 3.344 MiB largest
  selected-biome tier, and 1,183,165-byte largest atlas pair. Headless frame
  p95 remains report-only because software GL throttles near 10 fps.
- Reports:
  `artifacts/zk-565/{machine-certification-v1.json,ZK-565_MACHINE_CERTIFICATION_V1.md}`.
  Physical-GPU p95 plus human art, gameplay, accessibility, and aesthetic
  approval remain intentionally deferred to the final validation phase.

## 2026-07-30 — ZK-565 M52 machine certification v2

- V2 supersedes, but preserves, the V1 record. Descendant candidate
  `b895812981df39cf0cf01044bd9223b8511026db` was rejected by GitHub run
  `30559567366`: the generation baseline expected `c3d46b2f…`, while the CI
  runtime produced `e09728b7…`. The root cause was seeded RNG consumption
  inside `Array.sort` comparators, whose call order/count varies by runtime.
- Repaired candidate `c69316ae8133b6fe484aadc2006fd9a3bfaf4552`
  uses fixed-draw Fisher-Yates shuffles. Node 24.11.1 and Node 25.8.2 produce
  the same canonical generation SHA-256 `df29422e3bf81b077c22191d563ce1d84d1fd6396c5da80adc62c8b7cc9e65f5`;
  the four-year weather SHA-256 remains
  `57fde66c427db1bf4bb494a03d96e59103deed8630d16f648c0af0de5ba88cd7`.
  Existing saved terrain/obstacles/elevations remain compatible. Same-seed
  newly generated Parkland/Desert courses intentionally change to the
  portable sequence.
- Fresh exact-candidate gates pass: full Vitest (125 files, 981 passed, one
  skip), TypeScript, lint/i18n, build and asset audits, 9 focused
  save/package/atlas files (71 tests), 13 browser scenarios/all 48 reference
  states, PWA, performance smoke, and two V2 bundled-client scenarios with
  inspected populated/distinct captures and zero error artifacts. Exact-SHA
  CI run `30560782249` and its playtest deployment also passed.
- Fresh budgets: 1,033 ms cold start, 3,874 ms fixture load, 0.434 ms
  renderer work, 3.582 MiB initial critical payload, 3.344 MiB largest
  selected tier, and 1,183,165-byte largest atlas pair. Headless frame p95 is
  report-only.
- V2 reports:
  `artifacts/zk-565/{machine-certification-v2.json,ZK-565_MACHINE_CERTIFICATION_V2.md}`.
  Human playtesting, art/aesthetic judgment, human accessibility/device
  validation, and physical-GPU p95 remain explicitly deferred and open.

## 2026-07-30 — ZK-647 M53 local playing-surface care

- Added a deterministic, sparse `SurfaceCareStateV1` authority keyed by stable
  M35 surface identity plus bounded 8×8 maintenance cells. Legacy surfaces use
  deterministic connected-component identities; untouched natural rough is
  not persisted. Exact overlap reconciliation carries condition through
  repaint, split, merge, marker edits, undo/redo, and save/reload without
  changing authored terrain or legal tee/green targets.
- Daily care now combines local area/terrain demand with biome/climate/weather,
  traffic traces, mobility wear, budget, staff, mowing, irrigation, drainage,
  and operating policy. It models missed-mowing, drought, saturation, wear,
  dormancy, failure, natural recovery, explicit reseed/resod economics and
  suitable-day establishment, including elevated post-resod water demand.
- Renderer, live/player physics snapshots, shot AI, hole evaluation/rating,
  architecture, reactions, M49 reports, and tournament qualification consume
  the same effective-surface projection or local quality evidence. M49 uses
  observed surface/cell evidence instead of invented quadrants when care
  history exists. Seasons & Legacy exposes localized local-condition evidence
  and explicit repair controls.
- Save schema v25 round-trips sparse care state, preserves authored tiles, does
  not invent history for v24 saves, and clamps or drops hostile records.
  Coverage includes all eight authored biome-pressure contracts, max-grid
  sparsity, exact degradation/recovery/repair windows, deterministic 224-day
  years, local divergence, consumer agreement, edit/reload stability, and
  dormancy-not-death behavior.
- Review hardening caps hostile timestamps, repair costs, and telemetry against
  the loaded world day and zone size; overlap-weights topology changes without
  duplicating paid repairs; makes resod establishment consume and charge for
  elevated water only while actual serviced days progress; and invalidates
  terrain chunks for treatment/mowing-only visual changes. Architecture Review
  hazards/rules now share the effective-surface path while evidence geometry
  identity remains authored. Irrigation accounting separates per-tile root-zone
  depth from area-weighted volume, so equal acreage has the same resod surcharge
  regardless of how its M35 surfaces are split or merged.
- Machine verification: TypeScript passes; full Vitest passes 134 files with
  1,060 tests and one intentional skip; production build and all asset audits
  pass; lint/i18n passes with zero errors and 12 existing React-hook warnings.
  The bundled web-game browser client reached Quick Start, emitted structured
  game state and a screenshot, and produced no console/page error artifact.
  The screenshot was intentionally not judged visually.
- Human gameplay, visual/aesthetic review, accessibility/device checks, and
  final repair-workflow validation remain intentionally deferred to the final
  human-testing phase.

## 2026-07-30 — ZK-648 M53 illustrated Design dock and exact edit preview

- Replaced the duplicated text-first terrain/obstacle/decor controls with one
  registry-driven Design dock. Terrain, Nature, and Decor cards derive from
  the authoritative terrain, plant, decoration, and biome registries while
  preserving semantic plant IDs and shared installation/removal economics.
  The dock uses biome/quality atlas material and prop frames with explicit
  safe same-biome fallbacks that do not change gameplay semantics.
- Added a compact curve/spline/area/edit, width, undo, and redo toolbar; a
  two-row desktop palette; a narrow side drawer; roving keyboard navigation;
  touch long-press; non-color-only lock/affordability/risk states; and a
  persistent selected-item inspector. The inspector reports exact ecological
  fit, build, salvage, weekly care, water, degradation, and current-season
  risk facts from shared authorities. Player-visible copy is in the typed
  localization catalog.
- Terrain and surface-feature previews now locate protected, unowned, locked,
  outside, unchanged, and duplicate cells separately. The map ghost uses the
  active biome/season/color-vision material plus shapes and patterns for
  unaffordable or excluded cells. The precommit summary reports exact changed
  cells, construction, terrain and natural salvage, natural clearing,
  earthwork, removed features, upkeep weight, irrigation demand and weekly
  cost, cash, affordability, climate warnings, and the exact season, weather,
  scarcity, and policy multipliers used by the shared irrigation quote.
- Machine verification passes: TypeScript; lint/i18n with zero errors and 12
  existing React-hook warnings; focused registry/economics/edit coverage
  (4 files, 32 tests); full Vitest (136 files, 1,074 passed, one intentional
  skip); production build plus biome consumer/audio/offline/M35/Parkland asset
  audits; biome authoring audit; and two Playwright scenarios covering
  desktop/narrow layout, keyboard, touch, atlas/fallback evidence, semantic
  selection, decoration controls, material ghost, and the full precommit
  summary. The bundled web-game client independently entered the Desert
  fixture with the dock visible and emitted structured game state with no
  console/page error artifact.
- Browser captures were produced as machine artifacts but intentionally not
  visually judged. Human gameplay, visual/aesthetic approval,
  accessibility/device validation, and final cross-feature testing remain
  explicitly deferred to the end-of-milestone human validation phase.

### ZK-648 independent-review hardening

- Closed all eight review findings. Live Pixi ghosts now invalidate on
  terrain, color-vision, quality, reduced-motion, and seasonal treatment
  changes; stale stroke materials are rejected. Surface edits preview every
  authoritative changed cell with its final per-cell material and locate
  protected/unowned exclusions instead of reducing them to color-only counts.
- Tutorial start and paint-corridor resume now restore Design, Architect,
  Paint/curve, and Fairway state while keeping the authoritative Design dock
  mounted and interactive. Bridge/boardwalk inspector facts, map footprint,
  affordability, and commit all normalize the live span through the shared
  decoration authority.
- Terrain and surface edits now compare exact before/after managed-area plus
  player-planting demand after removed natural features, including the exact
  weekly planting-care delta. Swatches use the active authoritative seasonal
  terrain/plant tint and alpha with a safe fallback. New terrain, biome,
  degradation, risk, warning, and fallback copy is routed through typed
  localization keys and structured warning data.
- Category tabs now implement wrapping arrow, Home, and End activation with
  roving focus, stable mounted tabpanel targets, and valid `aria-controls`.
  Regression coverage exercises tab semantics, live span re-quoting,
  authoritative seasonal swatch refresh, stale material-ghost clearing, and
  an actual Fairway tutorial drag after starting from another workspace and
  material.
- Final machine gates: TypeScript and `git diff --check` pass; lint/i18n passes
  with zero errors and the 12 existing hook warnings; full Vitest passes 136
  files / 1,079 tests with one intentional skip; production build and all
  biome/audio/offline/M35/Parkland audits pass; the five focused Playwright
  scenarios pass in one clean run. The bundled browser client independently
  entered the Desert summer/drought fixture with the Design dock visible,
  emitted structured state, and produced no console/page error artifact.
- The bundled capture was retained under `/tmp/zk648-bundled-smoke` but not
  visually judged. Human gameplay, visual/aesthetic approval,
  accessibility/device validation, and final cross-feature testing remain
  deferred to the end-of-milestone human validation phase.

### ZK-648 final review follow-up

- Centralized terrain, obstacle, and decoration activation so editor mode,
  semantic plant/decor choice, selected catalog item, terrain, and inferred
  dock category move together. Curve/Spline/Area/Edit, keyboard shortcuts,
  tutorial entry, initial state, and fresh-run reset now use the same coherent
  terrain path; obstacle activation resolves a biome-correct semantic plant.
- Replaced selection-derived card tab stops with a true per-category roving
  focus target. Arrow/Home/End updates the sole `tabindex="0"` option, and
  reverse Tab returns to the last focused option.
- Routed every plant and decor primary label through exhaustive typed
  `PlantId` and `DecorationKind` localization maps. Pseudo-locale coverage now
  asserts translated labels in Terrain, Nature, and Decor.
- Verification passes: focused catalog tests (7/7), TypeScript, lint/i18n
  (zero errors; 12 existing hook warnings), full Vitest (136 files, 1,079
  passed and one intentional skip), production build/audits, and a clean
  six-scenario Design dock Playwright run. The expanded coherence scenario
  also passes alone after adding keyboard T/O assertions.
- The bundled web-game client independently entered the Desert summer/drought
  fixture with Design visible and emitted a coherent Paint/curve/Fairway tuple
  with no console/page error artifact. Its screenshot was produced under
  `/tmp/zk648-final-bundled-smoke-coherent` and intentionally not inspected.

### ZK-648 final navigation cleanup

- Routed the HUD Design button through the centralized terrain activation
  path, so entering Design from Decor restores the selected terrain item,
  clears the plant selection, and returns the dock to Terrain.
- Removed Hole Inspector's duplicate legacy Paint/Obstacle buttons and raw
  ten-terrain palette, along with their obsolete raw state-setter props. The
  illustrated Design dock remains the sole terrain/nature/decor palette.
- Focused HUD coherence E2E passes. TypeScript, focused catalog tests,
  lint/i18n, production build/audits, and isolated reruns of the two full-suite
  timeout cases pass. The full suite otherwise passed 134/136 files; the two
  initial failures were timeout-only under parallel load with no assertion
  mismatch.
- Bundled-client state/error smoke passed with a coherent Paint/curve/Fairway
  tuple and no error artifact. The screenshot under
  `/tmp/zk648-final-cleanup-smoke` was intentionally not inspected.

## 2026-07-30 — ZK-626 contextual biome UI contract

- Added one exhaustive registry-backed contextual UI profile for Parkland,
  Links, and Desert. Contextual course, setup/loading, design, inspector,
  Seasons/Legacy, upkeep, advisor, empty-state, and notification surfaces now
  carry typed biome/character/motif/illustration/season/weather/status
  attributes without changing shell commands, layout, typography, icons,
  shortcuts, permanent navigation, focus tokens, or simulation/save state.
- Closed independent-review findings by actually consuming the subordinate
  seasonal surface token and rendering restrained non-colour canopy,
  wind-line, or irrigation-ring geometry from the registry illustration.
  Positive/advisory/warning/critical semantic surfaces and edges retain
  precedence while biome geometry remains distinguishable when color-vision
  modes intentionally collapse the accent hue.
- Seasons/Legacy condition evidence, yearbook empty state, timeline empty
  state, and a real supporting illustration all use the same typed child
  helper and full context attributes. Loading now captures the pending wizard,
  scenario, recent-save, or selected-save destination biome before entering
  the loading screen and releases that transient context after entry/failure,
  rather than showing the stale active course.
- Verification passes: TypeScript/build; focused theme tests (6/6); full
  Vitest (136 files, 1,081 passed and one intentional skip); lint/i18n with
  zero errors and the 12 existing hook warnings; production biome,
  audio/offline, M35, Parkland, and explicit biome-authoring audits; and three
  Playwright scenarios. Browser coverage verifies all 12 biome/season states
  at desktop/narrow widths, stable command/layout signatures, CVD,
  reduced-motion/focus, warning and positive status precedence, subordinate
  season surfaces, actual named Seasons/Legacy children/empty variants,
  WeekClose upkeep, and Desert wizard plus Links scenario loading
  destinations.
- The bundled browser client independently entered the Links winter/frost
  fixture, emitted structured state with the expected biome/season/weather,
  and produced no console/page error artifact. Its machine capture under
  `/tmp/zk626-review-bundled-smoke` was intentionally not opened or visually
  assessed. Generated audit JSON was restored; unrelated shared skills,
  blueprint documentation, and hole-template work remain untouched.

### ZK-626 final loading-context hardening

- Replaced the transient loading-theme scalar with a complete typed
  destination context. New-game and scenario loading use the selected biome
  with neutral summer/clear presentation; pre-payload manifests do the same,
  and missing pre-M13 manifest themes resolve to canonical Parkland rather
  than inheriting the active course. Once a save parses, its normalized biome,
  calendar season, and deterministic weather derive from the saved live day.
- Continue paints the manifest context first and then the parsed-save context.
  Continue and selected-slot loading defer game application until the parsed
  loading state has committed to a browser frame. All success, invalid/missing
  payload, title, setup-cancel, defeat-exit, and fixture paths clear transient
  context, with an invariant cleanup when the flow is not loading.
- Focused verification passes: TypeScript; theme/loading unit coverage (8/8);
  lint/i18n with zero errors and the 12 existing warnings; and four browser
  scenarios covering stale Desert/winter source state, neutral wizard and
  scenario destinations, legacy manifest Parkland-neutral to parsed Links
  ordering, selected-save parsed season/weather, and missing-payload cleanup.
  Full Vitest passes 136 files / 1,083 tests with one intentional skip, and
  production build plus biome/audio/offline/M35/Parkland audits pass.
- No screenshots were opened or inspected. Transient Playwright failure
  artifacts were removed after the render-commit race was corrected.

## ZK-636 M61 release certification — 2026-08-02

- Added one focused certification contract covering flat/uphill/downhill,
  both sidehill lies and handednesses, matching/counter shapes, caddie club
  progression, fixed-seed preview/commit/save parity, unchanged historical
  traces, replay/design evidence agreement, and bounded analysis, preview,
  strategic-plan, Player Pro round, and live-day workloads.
- Added a real M36 browser scenario that selects uphill, downhill, and
  sidehill targets through the visible Player Pro controls, commits the
  chosen sidehill shot, checks text-state parity, and covers animation,
  responsive layout, reduced motion, color-safe terrain, and live-region
  semantics. The stable run passed without console or page errors.
- All temporary browser/report artifacts live under `/private/tmp`; no
  generated certification artifact is retained in the repository. Final
  integrated build, broader release checks, and promotion remain coordinator
  gates after the concurrent ZK-644 packet is integrated.

## 2026-08-03 — Bug-only delivery wave ZK-697, ZK-694, ZK-672

- ZK-697 now guarantees a deterministic natural pond and wetland fringe on a
  new Parkland starter property only when estate-wide generation placed no
  water there. The setup preview and committed course share the same generator,
  preserving exact terrain, elevation, and natural-obstacle parity.
- ZK-694 suppresses delegated fallback tooltips on Golfopedia's self-explanatory
  tabs and sidebar navigation while retaining meaningful glossary tooltips,
  keyboard focus visibility, and non-color selected-state cues.
- ZK-672 removes the automatic flyover trigger from Hole Wizard confirmation;
  the camera now remains exactly where the player left it, while the explicit
  inspector Flyover action continues to start and skip the cinematic normally.
- Focused unit, type, lint, Playwright, state, and visual checks passed in the
  isolated worktrees. The combined branch still requires the full development
  and production promotion gate before any issue is marked Done.

## ZK-693 Vision core landscapes — 2026-08-03

- Replaced the partial Vision landscape list with one typed, complete
  eight-biome catalog. Parkland, Links, and Desert now lead a labeled
  foundational collection; the expanded collection retains all existing
  editorial cards.
- Reused only project-owned Vision/game captures: clean Parkland and Desert
  crops plus the existing coastal-routing panorama for Links, with responsive
  mobile sources, lazy loading, and the established runtime-cache path intact.
- Added exact catalog, copy/alt-text, collection, keyboard-anchor, desktop,
  tablet, and phone Playwright coverage. Final browser/build validation and
  screenshot review are recorded with this isolated implementation packet.

## ZK-645 M62 final certification packet — 2026-08-03

- Added a deterministic 9-check certification runner and committed JSON packet
  spanning fourteen named green fixtures, 100 AI cohorts, the complete 1–3
  automatic-putt domain, A/B/C setup consequences, maintenance and recovery,
  preview/commit/replay/Architecture parity, persistence/package hardening, a
  220 x 140 / 36-hole / 100-golfer estate, and bounded accessible overlays.
- Focused coverage passes 14 files / 92 tests with report hash `c468d4dc`.
  TypeScript, lint/i18n (zero errors and the 12 existing warnings), production
  build/audits, and the representative desktop/mobile browser contract also
  pass; the browser test asserts all six selectors, fully exercises
  preferred/risk overlays, keeps overlay evidence bounded, and reports no
  console/page errors.
- The certification document and machine report explicitly separate proven
  automation from human authenticity, assistive-technology/text-scaling,
  physical browser/PWA/desktop, GPU/thermal, and release-owner production gates.
- A diagnostic maximum-estate base Architecture Review took about 53.3 seconds
  before the lazy M62 overlay path (about 148 ms). This is documented as a proposed
  high-priority follow-up rather than hidden or misreported as M62 overlay cost.
- No Linear mutation, push, production promotion, or production claim was made.
