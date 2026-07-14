# SimGolf-lite Tycoon (web)

Canvas-based course editor + simple tycoon sim loop inspired by SimGolf.

## Run

```bash
npm install
npm run dev
```

Open `http://localhost:5173/`.

## What you can do

- **Paint a course** on a tile grid (terrain types: rough/deep_rough/fairway/green/sand/water/tee/path).
- **Lay out 9 holes**:
  - **Hole Setup Wizard**: click tee → click green → confirm → auto-advance to next hole.
  - Tee/green markers + straight shot line are drawn on the canvas.
- **Dogleg-aware hole evaluation (pathfinding-lite)**:
  - Computes a **best playable path** from tee → green using a terrain traversal-cost grid.
  - Shows **Straight dist** vs **Effective dist** and renders the chosen route as a thin highlighted polyline.
  - Holes can be **invalid if blocked** (no path).
- **Obstacles overlay (not terrain)**:
  - Place/remove **trees** and **bushes** without changing terrain.
  - Obstacles affect playability/difficulty/aesthetics depending on whether they’re on/near/off the playable corridor.
- **Per-hole ratings** (0–100):
  - Playability, Difficulty, Aesthetics, Overall (plus layout issue flags if tee/green missing).
  - Hole list shows which hole is dragging down the course.
- **Weekly simulation**:
  - Demand, satisfaction, visitors, revenue/costs/profit, condition wear, reputation changes.
  - Deterministic “why people like/don’t like it” tips based on worst holes.
- **Save / Load / Reset** (localStorage, schema versioned).
- **Upgrades**: Staff + Marketing (costs cash; influences demand/satisfaction).
- **Terrain economics (capex + opex)**:
  - Painting tiles is a **capital expense** (delta-based build cost minus salvage).
  - Reverting to rough refunds salvage.
  - Painting is blocked if you don’t have enough cash (hover tooltip previews cost/refund).
  - Terrain types contribute differently to **weekly wear** (greens wear fastest).
  - Results show **capital spending** breakdown; Metrics show terrain mix + maintenance burden.
- **Responsive layout**:
  - Full-viewport layout with a two-column grid (canvas pane + control panel).
  - Canvas tile size auto-scales so the whole course fits without scroll.

## Dev: performance HUD & perf smoke (ZKU-160)

The Pixi renderer has a built-in frame-time HUD. Enable it from the browser
console and it appears top-left within a second:

```js
localStorage.setItem("coursecraft_perfhud", "on");   // "off" to hide
```

It shows fps / mean / p95 / max frame time over a rolling 180-frame window,
the renderer's own per-tick "work" time split by section (hover+flags,
water+sway, ambient, fx, golfers+emotes), visible/total terrain chunks,
golfer sprite-pool occupancy, live bubbles, and objects-layer children.
While the flag is on, the same numbers are exposed on `window.__ccPerf`
for scripts.

Related toggles: `coursecraft_ambience` ("off" disables cloud shadows,
birds, shimmer, day tint — also in Settings), and the HUD Animations
checkbox (disables all cosmetic animation).

`npm run test:perf` runs a headless perf smoke: boots the app, builds a
hole, runs the live day at 3x with a slow camera pan, and fails if the
renderer's per-tick JS work exceeds `PERF_WORK_BUDGET_MS` (default 8ms —
generous on purpose; it exists to catch order-of-magnitude regressions).
Raw frame times are reported too, but only asserted with
`PERF_ASSERT_FRAME=1` on real hardware — headless software-GL throttles
rAF to ~10fps regardless of app code. Not part of `npm run test`/CI.

## Useful code pointers

- **Game models**: `src/game/models/*`
- **Hole scoring + ratings**: `src/game/sim/holes.ts`, `src/game/sim/holeMetrics.ts`
- **Dogleg pathfinding**: `src/game/sim/pathfind.ts`
- **Weekly sim tick**: `src/game/sim/tickWeek.ts`
- **Terrain economics**: `src/game/models/terrainEconomics.ts`
- **UI**: `src/ui/HUD.tsx`, `src/ui/CanvasCourse.tsx`
