Original prompt: Update my vision HTML for the new features from the new milestones added to linear

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
