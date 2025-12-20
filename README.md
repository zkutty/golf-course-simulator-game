# golf-course-simulator-game

A lightweight, “SimGolf-lite” tycoon + course editor prototype built with **Vite + React + TypeScript + Canvas**, created to capture some of the charm of SimGolf and iterate quickly with Cursor.

## Run the web app

```bash
cd simgolf-lite
npm install
npm run dev
```

Then open `http://localhost:5173/`.

## Project layout

- `simgolf-lite/`: the playable web prototype:
  - canvas course painter + terrain build economics (capex + salvage)
  - 9-hole setup wizard
  - deep rough + tree/bush obstacle overlay
  - dogleg-aware pathfinding (“effective distance”) + route visualization
  - weekly sim + breakdowns + tips
