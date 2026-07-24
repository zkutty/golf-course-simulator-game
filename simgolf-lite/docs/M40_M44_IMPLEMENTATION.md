# M40–M44 implementation record

This document separates locally verified product work from certification that
requires people, credentials, licensed media, Steamworks access, or physical
hardware.

## M40 — authored campaign

- Six chapters use data-only phase, scene, choice, callback, medal, and reward
  definitions. The campaign reducer remains deterministic and bounded.
- Six recurring cast members have stable IDs, motivations, voice direction,
  expressions/fallback portraits, chapter appearances, and epilogue facts.
- Campaign state is save-schema v16 data and completion metadata is stored in
  the separate career profile.
- Full blind and moderated playtest certification remains external.

## M41 — premium UX and presentation

- Design, Operate, and Legacy are stable URL-addressable workspaces with owned
  SVG iconography, keyboard semantics, contextual action groups, alerts, and
  responsive overflow.
- Final PixelLab production art, licensed/Suno audio, and the complete
  accessibility/performance matrix remain separate asset and certification
  work. Placeholder initials and existing audio are deliberately retained
  where no approved final asset exists.

## M42 — desktop and Steam foundation

- Electron uses a context-isolated sandboxed renderer and an allowlisted
  preload bridge. Browser and desktop builds consume one typed
  `PlatformServices` contract.
- Native data writes are temp/sync/rename atomic, preserve rotating backups,
  enforce path and size limits, and produce privacy-safe support bundles.
- Steam/Workshop/cloud/overlay calls degrade to explicit unavailable or
  offline states; no browser-only control blocks local play.
- CI packages unsigned macOS and Windows smoke artifacts. Real App IDs,
  credentials, code signing, notarization, and Steamworks verification remain
  release-owned gates.

## M43 — sandbox longevity

- `.coursecraft-course` is JSON-only, versioned, checksummed, capped, scanned
  for unsafe paths/URLs/prototype keys, and distinct from save files.
- Imports remap stable course/hole/layout/property identities and quarantine
  corrupt or future-incompatible packages.
- The local library supports authoring, import, export, isolated test play,
  deletion, Workshop refresh, and explicit publishing where supported.
- Workshop legal acceptance and real Steam client transfer testing remain
  external.

## M44 — demo and certification

- `VITE_EDITION=demo` exposes the complete opening campaign chapter, labels the
  build, rejects full-only saves, and produces saves the full edition accepts.
- `release/m44-certification.json` is the single gate manifest.
  `npm run release:certify` refuses a GO decision while any required gate is
  missing or any external pass lacks evidence.
- The manifest is intentionally HOLD until signing, licensing/store review,
  hardware, ten-player moderated testing, and release-council evidence exist.
