import type { Course, Terrain } from "../models/types";

/**
 * A compact non-M19 renderer fixture with three authored landform levels,
 * one level water plane, and a recessed bunker. It is deliberately radial so
 * rotation tests cannot accidentally pass on one privileged screen axis.
 */
export function createMacroLandformFixture(): Course {
  const width = 28;
  const height = 22;
  const tiles = new Array<Terrain>(width * height).fill("rough");
  const elevations = new Array<number>(width * height).fill(0);
  const set = (x: number, y: number, terrain: Terrain, elevation?: number) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const index = y * width + x;
    tiles[index] = terrain;
    if (elevation != null) elevations[index] = elevation;
  };

  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const dx = (x - 14) / 10.5;
    const dy = (y - 10.5) / 7.5;
    const radius = dx * dx + dy * dy;
    elevations[y * width + x] = radius < 0.38 ? 2 : radius < 1.08 ? 1 : 0;
  }
  for (let x = 3; x <= 24; x++) {
    const center = 10 + Math.round(Math.sin(x / 5) * 2);
    for (let y = center - 2; y <= center + 2; y++) set(x, y, "fairway");
  }
  for (let y = 13; y <= 19; y++) for (let x = 4; x <= 11; x++) {
    const dx = (x - 7.5) / 4.5;
    const dy = (y - 16) / 3.8;
    if (dx * dx + dy * dy <= 1) set(x, y, "water", 0);
  }
  for (let y = 5; y <= 9; y++) for (let x = 18; x <= 24; x++) {
    const dx = (x - 21) / 3.8;
    const dy = (y - 7) / 2.5;
    if (dx * dx + dy * dy <= 1) set(x, y, "sand");
  }

  return {
    width,
    height,
    tiles,
    elevations,
    holes: [{
      tee: { x: 4, y: 9 },
      green: { x: 24, y: 10 },
      parMode: "MANUAL",
      parManual: 4,
      holeIndex: 1,
      name: "Three-level traverse",
    }],
    obstacles: [],
    buildings: [],
    yardsPerTile: 10,
    name: "M35 Macro Landform Laboratory",
    baseGreenFee: 40,
    condition: 1,
    theme: "parkland",
  };
}
