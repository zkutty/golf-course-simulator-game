# Changelog

All notable changes to this project are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versioning follows [SemVer](https://semver.org/).

## [Unreleased]

### Added
- Isometric projection core (`src/game/render/iso.ts`): 2:1 dimetric
  world↔screen math with cardinal rotation, picking, and depth keys (ZKU-137).
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
