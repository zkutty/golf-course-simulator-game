Original prompt: Update my vision HTML for the new features from the new milestones added to linear

## M50 implementation wave — 2026-07-30

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
