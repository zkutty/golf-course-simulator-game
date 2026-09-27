import type { Course, LandTheme, Terrain } from "../models/types";

/** Compact visual fixture whose single green crosses one- and two-step tiers. */
export function createZk677TieredGreenFixture(theme: LandTheme = "parkland"): Course {
  const width = 18;
  const height = 12;
  const tiles = new Array<Terrain>(width * height).fill("rough");
  const elevations = new Array<number>(width * height).fill(0);
  const set = (x: number, y: number, terrain: Terrain, elevation?: number) => {
    const index = y * width + x;
    tiles[index] = terrain;
    if (elevation != null) elevations[index] = elevation;
  };

  for (let x = 2; x <= 10; x++) for (let y = 5; y <= 7; y++) set(x, y, "fairway");
  for (let y = 3; y <= 9; y++) for (let x = 9; x <= 15; x++) {
    const dx = (x - 12) / 3.7;
    const dy = (y - 6) / 3.4;
    if (dx * dx + dy * dy > 1) continue;
    set(x, y, "green", x <= 10 ? 0 : x <= 12 ? 1 : 3);
  }
  for (let y = 0; y < height; y++) for (let x = 11; x < width; x++) {
    const index = y * width + x;
    if (tiles[index] !== "green") elevations[index] = x <= 12 ? 1 : 3;
  }

  return {
    width,
    height,
    tiles,
    elevations,
    holes: [{
      id: "zk677-tiered-green",
      tee: { x: 2, y: 6 },
      green: { x: 12, y: 6 },
      teeBoxes: {
        forward: { x: 3, y: 6 },
        member: { x: 2, y: 6 },
        championship: { x: 1, y: 6 },
      },
      pinPositions: {
        A: { x: 10, y: 6 },
        B: { x: 12, y: 6 },
        C: { x: 14, y: 6 },
      },
      parMode: "MANUAL",
      parManual: 3,
      holeIndex: 1,
      name: "Tiered Green",
    }],
    activePinRotation: "B",
    obstacles: [],
    buildings: [],
    yardsPerTile: 10,
    name: `ZK-677 ${theme} Tiered Green`,
    baseGreenFee: 50,
    condition: 1,
    theme,
  };
}
