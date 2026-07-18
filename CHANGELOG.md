# Changelog

All notable changes to this project are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versioning follows [SemVer](https://semver.org/).

## [Unreleased]

### Added
- Staff as people — M5 (ZKU-121/122/123/124): staff are no longer a
  spreadsheet line item. The world carries a roster of individual employees
  (groundskeepers, cart attendants, pro shop staff, marshals) with names,
  per-role weekly wages, and Full day / Morning / Afternoon shifts; during
  their shift each one clocks in at the entrance and works the course as a
  live entity rendered through the golfer sprite pipeline in a role-colored
  uniform. Groundskeepers pick greens and tees and visibly mow them —
  completed tasks lift course condition intra-day (golfers' moods notice)
  and credit real condition recovery at the day commit. Holes with too many
  groups stacked on them now count as congested: golfers stuck there bleed
  mood ("Pace of play is dragging…") unless a marshal patrols over and
  hurries play along with a walk-speed boost; cart attendants shave walking
  time course-wide and staffed pro shops send finishers off a bit happier.
  The old "Staff level" upgrade button is replaced by a roster panel in the
  Upgrades tab (hire by role for a signing fee, fire, click a shift chip to
  reschedule, live payroll total), and the live bar shows staff on duty.
  Pre-M5 saves migrate their staff level into an equivalent roster with
  payroll unchanged to the dollar.
- Render performance budget (ZKU-160): a dev perf HUD in the Pixi renderer
  (enable with `localStorage.coursecraft_perfhud = "on"`) showing fps,
  mean/p95/max frame time, the renderer's own per-tick work split by
  section, chunk-culling counts, and sprite-pool occupancy — mirrored to
  `window.__ccPerf` for scripts. Golfers outside the viewport now skip all
  animation and texture work (entity culling, matching the chunk culler),
  and `npm run test:perf` runs a headless smoke that fails if the
  renderer's tick work regresses past its budget. Documented in the README
  dev section.
- Cinematic hole flyover (ZKU-157): confirming a hole (or hitting Flyover in
  the HUD / hole inspector) glides the camera from wide behind the tee,
  along the shot corridor with a hold over the landing zone, settling in
  tight behind the green — ~7s, with a hole title card (number, par,
  yardage). Any click or Esc skips it and restores the exact prior camera;
  editor input is suspended during the glide while the live course keeps
  playing underneath.
- Ambient world life (ZKU-156): soft cloud shadows drifting across the
  course on a constant daily wind, a small flock of birds crossing the sky
  every few in-game hours, an occasional light-band grass shimmer synced to
  the tree-sway wind, a shoreline heron that flies off when a ball splashes
  down nearby, and a subtle time-of-day color grade (cool morning → neutral
  midday → warm evening, always continuous — no popping, scales with sim
  speed). All of it sits behind a new "Ambient life" toggle in Settings,
  separate from the Animations toggle, and costs nothing when off.
- SimGolf-style emote bubbles (ZKU-155): golfers announce how they feel with
  comic thought bubbles above their heads — ★ for birdies, a smile for pars,
  a frown for bogeys, a storm cloud for blow-up holes or gutter mood, "!"
  when a ball finds sand or water, "$" opinions about the green fee on
  walk-in, and Zzz when someone is stuck standing still. Bubbles pop in,
  hold ~2.5s, and fade up and out at a fixed screen size (readable at any
  zoom and rotation), capped at five at once with per-golfer cooldowns, and
  near-coincident bubbles fan out sideways. The selected golfer's bubbles
  take priority, and their recent thoughts mirror into the golfer
  inspector as a feed.
- Ball flight 2.0 (ZKU-154): shots now rise along a parabolic arc whose apex
  scales with distance, with a separate ground shadow that hugs the terrain
  (elevation-sampled) and telegraphs the landing spot; a subtle comet trail
  while airborne; and surface-specific landings — firm bounce and long roll
  on fairway, check-up on green, dead plug with a sand puff in bunkers,
  splash ripple on water, muffled drop in rough. Putts stay ground-level
  with an eased roll. The whole profile is driven by shot progress so 2x/3x
  speeds compress it cleanly, it converges exactly on the sim's rest point,
  and the camera gently follows the selected golfer's ball in flight.
- Golfer character sprites (ZKU-153): chibi golfers with 8-way directional
  walk cycles, idle, full-swing and putt animations, and hole-out reactions
  (cheer/frustration), replacing the colored dots in the isometric renderer.
  Three procedural body/outfit variants × per-golfer palette-swap tinting
  (grayscale clothing layer tinted by archetype color) keep a full tee sheet
  visibly diverse. Swings are driven by the pre-shot pause so the club's
  contact frame lands exactly at ball launch; facing tracks movement/shot
  direction under camera rotation; sprites stay pooled, depth-sorted, and
  elevation-aware, with drop shadows, a pulsing selection ring, and
  click-to-select golfers in the Pixi renderer. New `golfers` atlas + grid
  sprite-sheet support in the art pipeline.
- Real save system: named save slots, three rotating autosaves (one per
  committed game day), quicksave slot, rename/delete, and export/import as
  `.coursecraft` files. Saves live in IndexedDB with localStorage fallback;
  the old single-slot save migrates automatically to a "Migrated save"
  slot. Slot manager opens from the in-game Save/Load buttons and the
  title screen's Load Game (ZKU-174).
- Autotiled terrain transitions and dithered tile texture variants — no
  more hard diamond seams between terrains (ZKU-148).
- Course dressing: mow stripes along each hole's axis, tee pads with
  markers, green cup, and a fluttering pin flag (ZKU-149).
- Animated water: shimmer with glints, shore foam, and splash ripples when
  a ball lands in water (ZKU-150).
- Prop drop shadows and per-tree wind sway (ZKU-151).
- Buildings: multi-tile structure model with placement validation, golfers
  path around footprints, and a starter clubhouse auto-placed on new
  courses (ZKU-152).
- Isometric projection core (`src/game/render/iso.ts`): 2:1 dimetric
  world↔screen math with cardinal rotation, picking, and depth keys (ZKU-137).
- Production Pixi renderer: layered scene graph, camera-aware input, clean
  lifecycle (ZKU-138); the course now renders in isometric with full editor
  parity and live golfers, and is the default renderer (ZKU-139).
- Per-tile elevation: data model with save migration and sculpt economics
  (ZKU-143); rolling generated land rendered with height offsets, NW-sun
  slope shading, and cliff faces (ZKU-144).
- Free camera: middle/right-drag pan, wheel zoom-to-cursor, WASD/arrow pan,
  and Q/E 90-degree rotation with an eased tween (ZKU-141).
- Sculpt editor mode: raise/lower/smooth/level brushes in three sizes with
  auto-terracing, footprint preview, and earthworks costs (ZKU-145).
- Elevation-aware gameplay: uphill shots play longer through the whole shot
  planner, slopes cost walking effort, 2+ step cliffs are impassable, and
  tee/green sites must be near-flat (ZKU-146).
- Footprint-based depth sorting for props, golfers, balls, and future
  buildings; golfers are now properly occluded by trees (ZKU-140).
- CI pipeline: typecheck, lint (zero errors), tests, and production build on
  every PR and push to main; build artifact uploaded (ZKU-184).
- GitHub Pages deploy workflow (activates once Pages is enabled with
  "Source: GitHub Actions") (ZKU-184).
- App version injected from package.json and shown on the title screen
  (ZKU-184).
- Objective engine: data-driven goals (cash, reputation, course rating,
  holes built, weekly profit, profit streak, total rounds, condition) with
  all/any composition and week deadlines, evaluated deterministically at sim
  commit points; pinned HUD mini-tracker + objectives panel with progress
  bars; victory celebration with "keep playing"; unified defeat screen
  (bankruptcy or missed deadline) with retry-same-seed / load / new game.
  Goal state persists in saves; free play shows a Free Play badge (ZKU-163).
- New-game setup wizard: Mode (Challenge / Sandbox / Career-soon) → Land
  (theme pick + four seeded land previews with reroll and a shareable,
  re-enterable seed) → Difficulty → Details (course name with a fun name
  generator, optional founder, sandbox starting-cash slider). Quick Start on
  the title screen skips it with sensible defaults. One typed `GameSetup`
  feeds a single `createNewGame` path used by the wizard, quick start,
  defeat-retry, and save reset; the course name now shows in the HUD header
  and browser tab (app retitled "CourseCraft") (ZKU-162).
- Difficulty levels: Easy / Normal / Hard as a data-driven multiplier layer
  (`getEffectiveBalance`) over balanceConfig — starting cash, terrain build
  costs, weekly + live demand, golfer patience/spend, loan APR and bridge
  cooldown, condition wear rate, and reputation gain/loss asymmetry. Normal
  is bit-identical to the previous tuning (regression tested + verified via
  the Monte Carlo tuner). Difficulty is fixed per run, shown as a HUD badge
  and in save-slot metadata; the tuner now reports per-difficulty survival
  curves (ZKU-165).
- Land themes: parkland, links, and desert. Theme-driven wild-land
  generation (terrain mix, coastal water edge on links, sand washes and
  scarce water on desert, obstacle species mix, per-theme elevation
  character), flat-color palette variants read by the renderer from theme
  data, and data-driven gameplay flavor (desert water costs 1.5× to build,
  links deep rough penalizes shots 1.15×). Parkland is the identity theme —
  bit-identical to pre-theme generation per seed. Theme is recorded on the
  course, shown in save-slot metadata, and survives save/load (ZKU-166).
- Career mode: a six-scenario ladder (The Back Nine → Muni Rescue → Swamp
  Deal → Links by the Sea → The Members Club → Championship Dream) with
  sequential unlocks, medals, best-result tracking, and replayability.
  Scenario definitions are pure data (seed/theme/difficulty/goals/
  constraints); two prebuilt authored courses ship as deterministic
  fixtures (a run-down muni, a manicured members club). Constraints are
  enforced in the sim/UI: no-loans deals, committee-fixed green fees, and
  heritage trees that can't be removed. Career progress lives in its own
  localStorage store so restarting a scenario never wipes medals (ZKU-164).

### Fixed
- All 24 standing ESLint errors: render purity in App/CanvasCourse,
  SettingsModal setState-in-effect, explicit `any`s across renderers and
  utils (ZKU-80).

## [0.1.0] - 2026-07-12

Baseline of the existing prototype: canvas course painter with terrain
economics, 9-hole wizard, dogleg-aware shot planning, weekly simulation with
P&L breakdowns, live golfer simulation with real-time clock, and Monte Carlo
balance tuning.
