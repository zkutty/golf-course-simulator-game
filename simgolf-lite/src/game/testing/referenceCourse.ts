import type { Course, Terrain } from "../models/types";

export const PARKLAND_VISUAL_SEED = 1900212;
export const PARKLAND_CAMERA_BOOKMARKS = {
  overview50: { center: { x: 24, y: 18 }, zoom: 0.5, rotation: 0 as const },
  hole100: { center: { x: 24, y: 18 }, zoom: 1, rotation: 0 as const },
  green200: { center: { x: 39, y: 20 }, zoom: 2, rotation: 0 as const },
} as const;

/** Deterministic M19 landscaped par-4 visual acceptance scene. */
export function createParklandVisualReferenceCourse(): Course {
  const width = 48;
  const height = 36;
  const tiles = Array.from({ length: width * height }, () => "rough" as Terrain);
  // A single broad clubhouse hill keeps the golf corridor seamless while
  // still exercising authored elevation joins and exposed-earth faces.
  const elevations: number[] = Array.from({ length: width * height }, (_, index) => {
    const x = index % width;
    const y = Math.floor(index / width);
    return x < 15 && y < 12 ? 2 : 1;
  });
  const set = (x: number, y: number, terrain: Terrain) => {
    if (x >= 0 && y >= 0 && x < width && y < height) tiles[y * width + x] = terrain;
  };

  // Curved maintained corridor: a soft dogleg whose width changes along the hole.
  for (let x = 7; x <= 40; x++) {
    const centerY = 18 + Math.round(Math.sin((x - 8) / 8) * 3);
    const radius = x < 12 || x > 35 ? 2 : 3;
    for (let y = centerY - radius; y <= centerY + radius; y++) {
      if (Math.abs(y - centerY) + ((x * 7 + y * 11) % 5 === 0 ? 1 : 0) <= radius) set(x, y, "fairway");
    }
  }
  for (let y = 15; y <= 19; y++) for (let x = 5; x <= 9; x++) set(x, y, "tee");
  for (let y = 17; y <= 23; y++) for (let x = 36; x <= 43; x++) {
    const dx = (x - 39.5) / 4.5;
    const dy = (y - 20) / 3.5;
    if (dx * dx + dy * dy <= 1) set(x, y, "green");
  }
  // Lake, two shaped bunkers, and a meandering cart path exercise all seams.
  for (let y = 22; y <= 31; y++) for (let x = 18; x <= 30; x++) {
    const dx = (x - 24) / 7;
    const dy = (y - 26) / 5;
    if (dx * dx + dy * dy + Math.sin(x * 1.7) * 0.08 <= 1) { set(x, y, "water"); elevations[y * width + x] = 0; }
  }
  for (let y = 13; y <= 17; y++) for (let x = 29; x <= 34; x++) if ((x - 31.5) ** 2 / 10 + (y - 15) ** 2 / 5 <= 1) set(x, y, "sand");
  for (let y = 22; y <= 25; y++) for (let x = 37; x <= 41; x++) if ((x - 39) ** 2 / 7 + (y - 23.5) ** 2 / 3 <= 1) set(x, y, "sand");
  for (let x = 3; x <= 44; x++) {
    const y = 10 + Math.round(Math.sin(x / 6) * 2);
    set(x, y, "path");
  }
  for (let y = 2; y < height - 2; y++) for (let x = 2; x < width - 2; x++) {
    if (tiles[y * width + x] === "rough" && ((x * 41 + y * 67 + PARKLAND_VISUAL_SEED) % 79 < 4)) set(x, y, "deep_rough");
  }

  const obstacles: Course["obstacles"] = [];
  for (let y = 2; y < height - 2; y++) for (let x = 2; x < width - 2; x++) {
    const terrain = tiles[y * width + x];
    const value = (x * 73 + y * 101 + PARKLAND_VISUAL_SEED) % 113;
    if ((terrain === "rough" || terrain === "deep_rough") && value < 7) {
      obstacles.push({ x, y, type: value === 0 ? "rock" : value < 3 ? "bush" : "tree" });
    }
  }

  return {
    width,
    height,
    tiles,
    elevations,
    holes: [{ tee: { x: 7, y: 17 }, green: { x: 40, y: 20 }, parMode: "MANUAL", parManual: 4, name: "Founder's Bend", holeIndex: 1 }],
    obstacles,
    buildings: [{ type: "clubhouse", x: 3, y: 4 }],
    yardsPerTile: 10,
    name: "M19 Parkland Reference Club",
    baseGreenFee: 95,
    condition: 0.94,
    theme: "parkland",
  };
}

/** M20 acceptance scene: all ten surfaces with identical geometry per theme. */
export function createM20TerrainReferenceCourse(theme: Course["theme"] = "parkland"): Course {
  const base = createParklandVisualReferenceCourse();
  const tiles = [...base.tiles];
  const set = (x: number, y: number, terrain: Terrain) => { tiles[y * base.width + x] = terrain; };
  // Firm waste apron by the approach bunker.
  for (let y = 11; y <= 14; y++) for (let x = 26; x <= 34; x++) {
    if (tiles[y * base.width + x] === "rough") set(x, y, "waste_area");
  }
  // Vegetated shallow shelf along the lake's north/east banks.
  for (let y = 20; y <= 29; y++) for (let x = 17; x <= 32; x++) {
    const index = y * base.width + x;
    if (tiles[index] !== "rough") continue;
    const nearWater = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => tiles[(y + dy) * base.width + x + dx] === "water");
    if (nearWater) tiles[index] = "wetland";
  }
  return { ...base, tiles, theme, name: `M20 ${theme} Terrain Laboratory` };
}

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
