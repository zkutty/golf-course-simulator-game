# M12 renderer parity audit

The Pixi isometric path is the sole production renderer. This checklist records the final audit against the removed `CanvasCourse.tsx` path.

## Preserved in Pixi

- Terrain editing: paint hover, affordability / `not-allowed` feedback, grid overlay, all terrain types, color-vision palettes, and optional terrain patterns.
- Elevation editing: sculpt radius preview, raised tile tops, slope lighting, cliff faces, and fixed-level water.
- Hole wizard: tee and green drafts, confirm/move states, route and shot-plan lines, marker decals, active-hole focus, and cinematic flyover.
- Hole diagnosis: failed-corridor and fix overlays, shot corridor visualization, course/hole camera presets, and click-to-jump iso minimap.
- World objects: obstacles, multi-tile buildings, flags, animated water, swaying props, and depth sorting.
- Live simulation: pooled directional golfers, selection, ball flight/shadow/landing effects, emotes, ambient life, and time-of-day tint.
- Camera and input: smooth pan, zoom-to-cursor, cardinal rotation, edge scrolling, remapped keyboard controls, minimap viewport/bearing, fullscreen layout, and exact flyover restoration.
- Performance tooling: chunk culling/debugging, entity culling, pool occupancy and per-layer performance HUD, reproducible 100-golfer fixture, and perf smoke test.

## Intentionally retired

- Flat square-tile rendering and its soft-edge/gradient helpers. The iso autotile and elevation pipeline is the authored replacement.
- The canvas-only hover distance preview. The shot-plan/corridor overlays are the supported design feedback and avoid an extra full-course solve on pointer movement.
- Canvas camera transform helpers. Pixi owns one world-container transform and uses the shared pure isometric math.
- Renderer selection in Options and legacy `coursecraft_renderer` preference. Existing profiles migrate by ignoring the obsolete value.

## Verification gates

- `rg 'CanvasCourse|renderMode|graphics\.renderer|coursecraft_renderer' src` returns no production references.
- `npm run build`, `npm run lint`, `npm test`, and `npm run test:perf` pass.
- The bundled web-game Playwright client reaches gameplay with no console errors; screenshots cover the north-up minimap, hole thumbnail, tycoon chrome, and Pixi world.
