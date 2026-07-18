import type { Course, Terrain } from "../models/types";

/** Deterministic, fully playable course used by QA, fuzz, and soak fixtures. */
export function createReferenceCourse(): Course {
  const width = 110;
  const height = 70;
  const tiles = Array.from({ length: width * height }, () => "rough" as Terrain);
  const holes: Course["holes"] = [];

  // One long, valid hole keeps 30-week headless soaks fast while still driving
  // the full arrival, pathfinding, shot, scoring, reaction, and economy loops.
  // The separate renderer perf fixture supplies the 100-golfer visual load.
  for (let i = 0; i < 1; i++) {
    const y = 7 + i * 7;
    const leftToRight = i % 2 === 0;
    const tee = { x: leftToRight ? 8 : 101, y };
    const green = { x: leftToRight ? 101 : 8, y };
    const lo = Math.min(tee.x, green.x);
    const hi = Math.max(tee.x, green.x);
    for (let yy = y - 2; yy <= y + 2; yy++) {
      for (let x = lo; x <= hi; x++) tiles[yy * width + x] = "fairway";
    }
    tiles[tee.y * width + tee.x] = "tee";
    for (let yy = green.y - 1; yy <= green.y + 1; yy++) {
      for (let x = green.x - 1; x <= green.x + 1; x++) tiles[yy * width + x] = "green";
    }
    holes.push({ tee, green, parMode: "AUTO", name: `QA Hole ${i + 1}` });
  }

  return {
    width,
    height,
    tiles,
    elevations: new Array(width * height).fill(0),
    holes,
    obstacles: [],
    buildings: [{ type: "clubhouse", x: 2, y: 32 }],
    yardsPerTile: 10,
    name: "QA Reference Links",
    baseGreenFee: 85,
    condition: 0.85,
    theme: "parkland",
  };
}
