# SimGolf-lite Tycoon (web)

Canvas-based course editor + simple tycoon sim loop inspired by SimGolf.

## Run

```bash
npm install
npm run dev
```

Open `http://localhost:5173/`.

## What you can do

- **Paint a course** on a tile grid (terrain types: rough/fairway/green/sand/water/tee/path).
- **Lay out 9 holes**:
  - **Hole Setup Wizard**: click tee → click green → confirm → auto-advance to next hole.
  - Tee/green markers + shot lines are drawn on the canvas.
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

## Useful code pointers

- **Game models**: `src/game/models/*`
- **Hole scoring + ratings**: `src/game/sim/holes.ts`, `src/game/sim/holeMetrics.ts`
- **Weekly sim tick**: `src/game/sim/tickWeek.ts`
- **Terrain economics**: `src/game/models/terrainEconomics.ts`
- **UI**: `src/ui/HUD.tsx`, `src/ui/CanvasCourse.tsx`
