Original prompt: Update my vision HTML for the new features from the new milestones added to linear

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
