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

/** Reproducible renderer stress scene for M12 (`?perfFixture=1`). */
export function createRenderPerfCourse(): Course {
  const width = 110;
  const height = 70;
  const tiles = Array.from({ length: width * height }, () => "rough" as Terrain);
  const elevations = Array.from({ length: width * height }, (_, index) => {
    const x = index % width;
    const y = Math.floor(index / width);
    return Math.max(0, Math.min(7, Math.round(3 + Math.sin(x / 10) * 2 + Math.cos(y / 8) * 2)));
  });
  const holes: Course["holes"] = [];

  for (let i = 0; i < 18; i++) {
    const y = 5 + i * 3;
    const leftToRight = i % 2 === 0;
    const tee = { x: leftToRight ? 10 : 99, y };
    const green = { x: leftToRight ? 99 : 10, y };
    const lo = Math.min(tee.x, green.x);
    const hi = Math.max(tee.x, green.x);
    for (let yy = y - 1; yy <= y + 1; yy++) {
      for (let x = lo; x <= hi; x++) {
        const index = yy * width + x;
        tiles[index] = "fairway";
        // Keep the playable corridors gently rolling and deterministic.
        elevations[index] = 2 + Math.round((Math.sin((x + i * 7) / 13) + 1) * 1.5);
      }
    }
    tiles[tee.y * width + tee.x] = "tee";
    for (let yy = green.y - 1; yy <= green.y + 1; yy++) {
      for (let x = green.x - 1; x <= green.x + 1; x++) tiles[yy * width + x] = "green";
    }
    holes.push({ tee, green, parMode: "MANUAL", parManual: 5, name: `Performance Hole ${i + 1}`, holeIndex: i + 1 });
  }

  // Water and sand dress the gaps between corridors without blocking play.
  for (let y = 2; y < height - 2; y++) {
    for (let x = 2; x < width - 2; x++) {
      const index = y * width + x;
      if (tiles[index] !== "rough") continue;
      if ((x * 17 + y * 31) % 173 === 0) tiles[index] = "water";
      else if ((x * 29 + y * 11) % 137 === 0) tiles[index] = "sand";
    }
  }

  const obstacles: Course["obstacles"] = [];
  for (let y = 1; y < height - 1 && obstacles.length < 540; y++) {
    for (let x = 1; x < width - 1 && obstacles.length < 540; x++) {
      const terrain = tiles[y * width + x];
      if (terrain !== "rough" || (x * 37 + y * 19) % 3 !== 0) continue;
      obstacles.push({ x, y, type: obstacles.length % 7 === 0 ? "rock" : obstacles.length % 4 === 0 ? "bush" : "tree" });
    }
  }

  return {
    width,
    height,
    tiles,
    elevations,
    holes,
    obstacles,
    buildings: [
      { type: "clubhouse", x: 2, y: 31 },
      { type: "pro_shop", x: 6, y: 31, tier: 3, price: 40 },
      { type: "snack_bar", x: 52, y: 31, tier: 3, price: 15 },
      { type: "cart_rental", x: 6, y: 36, tier: 3, price: 30 },
    ],
    yardsPerTile: 4,
    name: "M12 Render Performance Club",
    baseGreenFee: 120,
    condition: 0.92,
    theme: "parkland",
  };
}
