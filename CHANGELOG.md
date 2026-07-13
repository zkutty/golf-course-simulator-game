# Changelog

All notable changes to this project are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versioning follows [SemVer](https://semver.org/).

## [Unreleased]

### Added
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

### Fixed
- All 24 standing ESLint errors: render purity in App/CanvasCourse,
  SettingsModal setState-in-effect, explicit `any`s across renderers and
  utils (ZKU-80).

## [0.1.0] - 2026-07-12

Baseline of the existing prototype: canvas course painter with terrain
economics, 9-hole wizard, dogleg-aware shot planning, weekly simulation with
P&L breakdowns, live golfer simulation with real-time clock, and Monte Carlo
balance tuning.
