import type { Course, Terrain } from "../models/types";
import { generateWildLandWithObstacles } from "../gen/generateWildLand";
import { createNewGame } from "../gen/newGame";

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

/** M23 visual/live acceptance scene with all tee sets and pin rotations. */
export function createM23CourseSetupReferenceCourse(): Course {
  const base = createParklandVisualReferenceCourse();
  const hole = base.holes[0];
  return {
    ...base,
    name: "M23 Course Standards Club",
    activePinRotation: "B",
    holes: [{
      ...hole,
      teeBoxes: {
        forward: { x: 9, y: 17 },
        member: hole.tee,
        championship: { x: 5, y: 17 },
      },
      pinPositions: {
        A: hole.green,
        B: { x: 39, y: 20 },
        C: { x: 41, y: 20 },
      },
    }],
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

/** M21 course-only biome acceptance scene with deterministic ecology. */
export function createM21BiomeReferenceCourse(theme: NonNullable<Course["theme"]> = "parkland"): Course {
  const width = 64;
  const height = 44;
  const seed = 210225;
  const tee = { x: 7, y: 21 };
  const green = { x: 55, y: 23 };
  const generated = generateWildLandWithObstacles(width, height, seed, [tee, green], theme);
  const tiles = [...generated.tiles];
  const elevations = [...generated.elevations];
  const set = (x: number, y: number, terrain: Terrain) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    tiles[y * width + x] = terrain;
  };
  // One restrained maintained corridor makes the environmental identity
  // legible without letting props obscure golfer-critical surfaces.
  for (let x = tee.x; x <= green.x; x++) {
    const center = 21 + Math.round(Math.sin(x / 8) * 2);
    for (let y = center - 2; y <= center + 2; y++) set(x, y, "fairway");
  }
  for (let y = tee.y - 1; y <= tee.y + 1; y++) for (let x = tee.x - 1; x <= tee.x + 1; x++) set(x, y, "tee");
  for (let y = green.y - 2; y <= green.y + 2; y++) for (let x = green.x - 3; x <= green.x + 3; x++) {
    const dx = (x - green.x) / 3.5;
    const dy = (y - green.y) / 2.5;
    if (dx * dx + dy * dy <= 1) set(x, y, "green");
  }
  const obstacles = generated.obstacles.filter((obstacle) => {
    const terrain = tiles[obstacle.y * width + obstacle.x];
    return terrain === "rough" || terrain === "deep_rough" || terrain === "waste_area";
  });
  return {
    width,
    height,
    tiles,
    elevations,
    holes: [{ tee, green, parMode: "MANUAL", parManual: 5, name: `${theme} Coast`, holeIndex: 1 }],
    obstacles,
    buildings: [],
    yardsPerTile: 8,
    name: `M21 ${theme} Biome Preserve`,
    baseGreenFee: 90,
    condition: 0.94,
    theme,
  };
}

/** M22 course-only visual acceptance scene: every structure and decor kind. */
export function createM22VisualReferenceCourse(theme: NonNullable<Course["theme"]> = "parkland"): Course {
  const base = createM21BiomeReferenceCourse(theme);
  const tiles = [...base.tiles];
  const elevations = [...base.elevations];
  for (const y of [6, 10]) for (let x = 9; x <= 13; x++) {
    tiles[y * base.width + x] = x === 9 || x === 13 ? "path" : y === 6 ? "water" : "wetland";
    elevations[y * base.width + x] = 1;
  }
  return {
    ...base,
    tiles,
    elevations,
    name: `M22 ${theme} Visual Release Club`,
    buildings: [
      { type: "clubhouse", x: 4, y: 29 },
      { type: "pro_shop", x: 9, y: 29, tier: 3, price: 40 },
      { type: "snack_bar", x: 13, y: 29, tier: 2, price: 15 },
      { type: "cart_rental", x: 17, y: 29, tier: 1, price: 30 },
    ],
    decorations: [
      { kind: "bridge", x: 9, y: 6, rotation: 0, span: 3 },
      { kind: "boardwalk", x: 9, y: 10, rotation: 0, span: 3 },
      { kind: "fence", x: 5, y: 34, rotation: 0 },
      { kind: "bench", x: 7, y: 34, rotation: 1 },
      { kind: "tee_sign", x: 8, y: 21, rotation: 0 },
      { kind: "lamp", x: 10, y: 34, rotation: 0 },
      { kind: "bin", x: 12, y: 34, rotation: 0 },
      { kind: "parked_cart", x: 14, y: 34, rotation: 2 },
      { kind: "flower_bed", x: 16, y: 34, rotation: 0 },
      { kind: "planter", x: 18, y: 34, rotation: 3 },
      { kind: "ornamental_feature", x: 20, y: 34, rotation: 0 },
    ],
  };
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
export function createRenderPerfCourse(theme: NonNullable<Course["theme"]> = "parkland"): Course {
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
      obstacles.push({ x, y, type: obstacles.length % 40 === 0 ? "bush" : obstacles.length % 20 === 0 ? "rock" : "tree" });
    }
  }

  const decorations: NonNullable<Course["decorations"]> = [];
  for (let y = 2; y < height - 2 && decorations.length < 320; y += 2) for (let x = 2; x < width - 2 && decorations.length < 320; x += 3) {
    const terrain = tiles[y * width + x];
    if (terrain !== "rough" || obstacles.some((obstacle) => obstacle.x === x && obstacle.y === y)) continue;
    decorations.push({ kind: decorations.length % 7 === 0 ? "flower_bed" : decorations.length % 5 === 0 ? "lamp" : "bench", x, y, rotation: (decorations.length % 4) as 0 | 1 | 2 | 3 });
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
    decorations,
    yardsPerTile: 4,
    name: "M12 Render Performance Club",
    baseGreenFee: 120,
    condition: 0.92,
    theme,
  };
}

/** Fully configured M24 host layout with three tees and three valid pins. */
export function createTournamentStandardsCourse(): Course {
  const base = createRenderPerfCourse();
  const tiles = base.tiles.slice();
  const holes = base.holes.map((hole, holeIndex) => {
    const member = hole.tee!;
    const pinA = hole.green!;
    const direction = pinA.x > member.x ? 1 : -1;
    const forward = { x: member.x + direction * 4, y: member.y };
    const championship = { x: member.x - direction * 4, y: member.y };
    const pinB = { x: pinA.x - direction, y: pinA.y };
    const pinC = { x: pinA.x, y: pinA.y + 1 };
    tiles[forward.y * base.width + forward.x] = "tee";
    tiles[championship.y * base.width + championship.x] = "tee";
    if (holeIndex < 9) for (let step = 1; step < 4; step++) {
      tiles[championship.y * base.width + championship.x + direction * step] = "water";
    }
    for (let yy = pinA.y - 1; yy <= pinA.y + 1; yy++) for (let xx = pinA.x - 1; xx <= pinA.x + 1; xx++) {
      const keepGreen = (xx === pinA.x && yy === pinA.y) || (xx === pinB.x && yy === pinB.y) || (xx === pinC.x && yy === pinC.y);
      tiles[yy * base.width + xx] = keepGreen ? "green" : "sand";
    }
    return {
      ...hole,
      teeBoxes: { forward, member, championship },
      pinPositions: { A: pinA, B: pinB, C: pinC },
    };
  });
  return { ...base, name: "M24 Tournament Standards Club", tiles, holes, yardsPerTile: 3, activePinRotation: "B" };
}

/** M26 acceptance estate: one published 18-hole championship routing and one
 * independently priced 9-hole course sharing the same clubhouse/terrain. */
export function createM26MultiCourseReferenceCourse(): Course {
  const base = createReferenceCourse();
  const width = 48;
  const height = 32;
  const tiles = Array.from({ length: width * height }, () => "fairway" as Terrain);
  const makeHole = (prefix: string, index: number, teeX: number, greenX: number) => {
    const y = 3 + index * 3;
    const tee = { x: teeX, y };
    const green = { x: greenX, y };
    tiles[y * width + teeX] = "tee";
    tiles[y * width + greenX] = "green";
    return { id: `${prefix}-${index + 1}`, name: `${prefix === "north" ? "North" : "South"} ${index + 1}`, tee, green, teeBoxes: { member: tee }, pinPositions: { A: green }, parMode: "MANUAL" as const, parManual: 3 as const };
  };
  const north = Array.from({ length: 9 }, (_, index) => makeHole("north", index, 3, 18));
  const south = Array.from({ length: 9 }, (_, index) => makeHole("south", index, 29, 44));
  return {
    ...base,
    name: "M26 Twin Courses Estate",
    width,
    height,
    tiles,
    elevations: new Array(width * height).fill(0),
    holes: [...north, ...south],
    obstacles: [],
    buildings: [],
    decorations: [],
    estate: undefined,
    yardsPerTile: 8,
    layouts: [
      { id: "north", name: "North Course", draftHoleIds: north.map((hole) => hole.id!), publishedHoleIds: north.map((hole) => hole.id!), roundLength: 9, state: "open", greenFee: 120 },
      { id: "south", name: "South Nine", draftHoleIds: south.map((hole) => hole.id!), publishedHoleIds: south.map((hole) => hole.id!), roundLength: 9, state: "open", greenFee: 55 },
    ],
    activeCourseId: "north",
    baseGreenFee: 120,
  };
}

/** M27 release fixture: the complete 220×140 estate, two independent
 * published eighteens, every parcel owned, dense scenery, and stable IDs. */
export function createM27ReleaseReferenceCourse(theme: NonNullable<Course["theme"]> = "parkland"): Course {
  const generated = createNewGame({ mode: "sandbox", courseName: "M27 Thirty-Six Hole Estate", seed: 270252, theme, difficulty: "normal", sandboxOverrides: { startingCash: 1_000_000 } }).course;
  const tiles = generated.tiles.slice();
  const elevations = generated.elevations.slice();
  const holes: Course["holes"] = [];
  for (let courseIndex = 0; courseIndex < 2; courseIndex++) for (let index = 0; index < 18; index++) {
    const y = 6 + index * 7;
    const leftToRight = index % 2 === 0;
    const west = courseIndex === 0 ? 7 : 117;
    const east = courseIndex === 0 ? 102 : 212;
    const tee = { x: leftToRight ? west : east, y };
    const green = { x: leftToRight ? east : west, y };
    const direction = green.x > tee.x ? 1 : -1;
    for (let x = tee.x; x !== green.x + direction; x += direction) for (let dy = -1; dy <= 1; dy++) {
      const tileIndex = (y + dy) * generated.width + x;
      tiles[tileIndex] = "fairway";
      elevations[tileIndex] = 2 + ((index + Math.floor(x / 18)) % 3);
    }
    tiles[tee.y * generated.width + tee.x] = "tee";
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) tiles[(green.y + dy) * generated.width + green.x + dx] = "green";
    const id = `${courseIndex === 0 ? "heritage" : "meadow"}-${index + 1}`;
    holes.push({ id, name: `${courseIndex === 0 ? "Heritage" : "Meadow"} ${index + 1}`, tee, green, teeBoxes: { member: tee }, pinPositions: { A: green }, parMode: "MANUAL", parManual: index % 6 === 0 ? 3 : index % 5 === 0 ? 5 : 4, holeIndex: index + 1 });
  }
  const occupied = new Set(holes.flatMap((hole) => [hole.tee, hole.green]).filter(Boolean).map((point) => `${point!.x},${point!.y}`));
  const obstacles = generated.obstacles.filter((obstacle) => tiles[obstacle.y * generated.width + obstacle.x] === "rough" && !occupied.has(`${obstacle.x},${obstacle.y}`)).slice(0, 900);
  const decorations: NonNullable<Course["decorations"]> = [];
  for (let y = 3; y < generated.height - 3 && decorations.length < 600; y += 3) for (let x = 3; x < generated.width - 3 && decorations.length < 600; x += 4) {
    if (tiles[y * generated.width + x] !== "rough") continue;
    decorations.push({ kind: decorations.length % 5 === 0 ? "flower_bed" : decorations.length % 3 === 0 ? "lamp" : "bench", x, y, rotation: (decorations.length % 4) as 0 | 1 | 2 | 3 });
  }
  const heritage = holes.slice(0, 18).map((hole) => hole.id!);
  const meadow = holes.slice(18).map((hole) => hole.id!);
  return {
    ...generated,
    tiles,
    elevations,
    holes,
    obstacles,
    decorations,
    layouts: [
      { id: "heritage", name: "Heritage Course", draftHoleIds: heritage, publishedHoleIds: heritage, roundLength: 18, state: "open", greenFee: 125 },
      { id: "meadow", name: "Meadow Course", draftHoleIds: meadow, publishedHoleIds: meadow, roundLength: 18, state: "open", greenFee: 85 },
    ],
    activeCourseId: "heritage",
    baseGreenFee: 125,
    condition: .94,
    estate: generated.estate ? { ...generated.estate, ownedParcelIds: generated.estate.parcels.map((parcel) => parcel.id) } : undefined,
  };
}
