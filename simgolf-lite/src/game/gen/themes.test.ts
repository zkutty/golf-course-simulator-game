import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { generateWildLandWithObstacles } from "./generateWildLand";
import { LAND_THEMES } from "../models/themes";
import { computeTerrainChangeCost, themeBuildMult } from "../models/terrainEconomics";
import { computeExpectedLandingPenalty } from "../sim/shots/landingPenalty";
import { normalizeLoadedSave } from "../../utils/save";
import { DEFAULT_COURSE, DEFAULT_WORLD } from "../models/defaults";
import type { LandTheme, Terrain } from "../models/types";
import { DAYS_PER_YEAR, weatherForDay } from "../seasons/seasons";

const W = 110;
const H = 70;
const SEEDS = [7, 1234, 99001];

function gen(seed: number, theme?: LandTheme) {
  return generateWildLandWithObstacles(W, H, seed, [], theme);
}

function frac(tiles: Terrain[], t: Terrain): number {
  return tiles.filter((x) => x === t).length / tiles.length;
}

function outputHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

describe("land themes (ZKU-166)", () => {
  it("matches the runtime-independent generation and weather output baseline", () => {
    const themes = ["parkland", "links", "desert"] as const satisfies readonly LandTheme[];
    const generation = themes.flatMap((theme) => SEEDS.map((seed) => gen(seed, theme)));
    const weather = themes.flatMap((theme) =>
      Array.from({ length: DAYS_PER_YEAR * 4 }, (_, absoluteDay) =>
        weatherForDay(222, theme, absoluteDay)
      )
    );

    expect(outputHash(generation)).toBe("df29422e3bf81b077c22191d563ce1d84d1fd6396c5da80adc62c8b7cc9e65f5");
    expect(outputHash(weather)).toBe("57fde66c427db1bf4bb494a03d96e59103deed8630d16f648c0af0de5ba88cd7");
  });

  it("parkland is the identity theme — bit-identical to themeless generation", () => {
    for (const seed of SEEDS) {
      expect(gen(seed, "parkland")).toEqual(gen(seed));
    }
  });

  it("generation is deterministic per seed + theme", () => {
    for (const theme of ["parkland", "links", "desert"] as const) {
      expect(gen(42, theme)).toEqual(gen(42, theme));
    }
    expect(gen(42, "links").tiles).not.toEqual(gen(43, "links").tiles);
  });

  it("themes produce statistically distinct tile mixes", () => {
    for (const seed of SEEDS) {
      const parkland = gen(seed, "parkland").tiles;
      const links = gen(seed, "links").tiles;
      const desert = gen(seed, "desert").tiles;

      // Desert: sand-heavy, water-scarce.
      expect(frac(desert, "sand")).toBeGreaterThan(frac(parkland, "sand") * 2);
      expect(frac(desert, "water")).toBeLessThan(frac(parkland, "water"));
      // Links: more deep rough and more (dune) sand than parkland.
      expect(frac(links, "deep_rough")).toBeGreaterThan(frac(parkland, "deep_rough"));
      expect(frac(links, "sand")).toBeGreaterThan(frac(parkland, "sand"));
    }
  });

  it("links gets a coastal water edge; parkland borders stay dry", () => {
    for (const seed of SEEDS) {
      const isBorderWater = (tiles: Terrain[]) => {
        let count = 0;
        for (let x = 0; x < W; x++) {
          if (tiles[x] === "water") count++;
          if (tiles[(H - 1) * W + x] === "water") count++;
        }
        for (let y = 0; y < H; y++) {
          if (tiles[y * W] === "water") count++;
          if (tiles[y * W + W - 1] === "water") count++;
        }
        return count;
      };
      expect(isBorderWater(gen(seed, "links").tiles)).toBeGreaterThan(Math.min(W, H) / 2);
      expect(isBorderWater(gen(seed, "parkland").tiles)).toBe(0);
    }
  });

  it("links sea is edge-connected, naturally contoured, and leaves buildable land", () => {
    for (const seed of SEEDS) {
      const tiles = gen(seed, "links").tiles;
      const water = tiles.reduce<number[]>((indices, tile, index) => tile === "water" ? [...indices, index] : indices, []);
      expect(water.length / tiles.length).toBeGreaterThan(0.1);
      expect(water.length / tiles.length).toBeLessThan(0.31);

      const edgeWater = water.filter((index) => {
        const x = index % W;
        const y = Math.floor(index / W);
        return x === 0 || y === 0 || x === W - 1 || y === H - 1;
      });
      const seen = new Set(edgeWater.map(String));
      const queue = [...edgeWater];
      while (queue.length) {
        const index = queue.shift()!;
        const x = index % W;
        const y = Math.floor(index / W);
        for (const next of [index - 1, index + 1, index - W, index + W]) {
          const nx = next % W;
          const ny = Math.floor(next / W);
          if (next < 0 || next >= tiles.length || Math.abs(nx - x) + Math.abs(ny - y) !== 1) continue;
          if (tiles[next] === "water" && !seen.has(String(next))) {
            seen.add(String(next));
            queue.push(next);
          }
        }
      }
      expect(seen.size).toBe(water.length);

      const shorelineDepths: number[] = [];
      for (let x = 0; x < W; x++) {
        let north = 0;
        while (north < H && tiles[north * W + x] === "water") north++;
        if (north > 0) shorelineDepths.push(north);
        let south = 0;
        while (south < H && tiles[(H - 1 - south) * W + x] === "water") south++;
        if (south > 0) shorelineDepths.push(south);
      }
      for (let y = 0; y < H; y++) {
        let west = 0;
        while (west < W && tiles[y * W + west] === "water") west++;
        if (west > 0) shorelineDepths.push(west);
        let east = 0;
        while (east < W && tiles[y * W + W - 1 - east] === "water") east++;
        if (east > 0) shorelineDepths.push(east);
      }
      expect(new Set(shorelineDepths).size).toBeGreaterThan(3);
      expect(tiles.filter((tile) => !["water", "wetland"].includes(tile)).length / tiles.length).toBeGreaterThan(0.7);
    }
  });

  it("obstacle species mix follows the theme", () => {
    const share = (theme: LandTheme, type: "tree" | "bush" | "rock", seed: number) => {
      const { obstacles } = gen(seed, theme);
      if (obstacles.length === 0) return 0;
      return obstacles.filter((o) => o.type === type).length / obstacles.length;
    };
    // Averages across seeds to keep the assertion robust.
    const avg = (theme: LandTheme, type: "tree" | "bush" | "rock") =>
      SEEDS.reduce((a, s) => a + share(theme, type, s), 0) / SEEDS.length;

    expect(avg("links", "tree")).toBeLessThan(avg("parkland", "tree"));
    expect(avg("desert", "tree")).toBeLessThan(avg("parkland", "tree"));
    expect(avg("desert", "rock")).toBeGreaterThan(avg("parkland", "rock"));
  });

  it("keeps generated props off invalid terrain and protected corridors", () => {
    for (const theme of ["parkland", "links", "desert"] as const) {
      const reserved = [{ x: 35, y: 25 }, { x: 70, y: 45 }];
      const generated = generateWildLandWithObstacles(W, H, 210225, reserved, theme);
      for (const obstacle of generated.obstacles) {
        expect(["rough", "deep_rough", "waste_area"]).toContain(generated.tiles[obstacle.y * W + obstacle.x]);
        for (const point of reserved) expect((obstacle.x - point.x) ** 2 + (obstacle.y - point.y) ** 2).toBeGreaterThan(4);
      }
      expect(new Set(generated.obstacles.map((obstacle) => `${obstacle.x},${obstacle.y}`)).size).toBe(generated.obstacles.length);
    }
  });

  it("forms deterministic theme-specific shoreline ecology", () => {
    const nearWater = (theme: LandTheme, seed: number) => {
      const generated = gen(seed, theme);
      return generated.obstacles.filter((obstacle) => {
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
          const x = obstacle.x + dx;
          const y = obstacle.y + dy;
          if (x >= 0 && y >= 0 && x < W && y < H && ["water", "wetland"].includes(generated.tiles[y * W + x])) return true;
        }
        return false;
      });
    };
    expect(SEEDS.flatMap((seed) => nearWater("parkland", seed)).some((obstacle) => obstacle.type === "bush")).toBe(true);
    expect(SEEDS.flatMap((seed) => nearWater("desert", seed)).some((obstacle) => obstacle.type === "tree")).toBe(true);
    expect(nearWater("links", 1234)).toEqual(nearWater("links", 1234));
  });

  it("elevation character follows the theme (links stays low)", () => {
    for (const seed of SEEDS) {
      const maxOf = (theme: LandTheme) => Math.max(...gen(seed, theme).elevations);
      expect(maxOf("links")).toBeLessThanOrEqual(
        LAND_THEMES.links.generation.elevation.maxStep
      );
    }
  });

  it("desert water costs more to build; other themes neutral", () => {
    expect(themeBuildMult("desert", "water")).toBeGreaterThan(1);
    expect(themeBuildMult("desert", "fairway")).toBe(1);
    expect(themeBuildMult("links", "water")).toBe(1);
    expect(themeBuildMult(undefined, "water")).toBe(1);

    const parkland = computeTerrainChangeCost("rough", "water", 1, "parkland");
    const desert = computeTerrainChangeCost("rough", "water", 1, "desert");
    expect(desert.net).toBeCloseTo(parkland.net * 1.5, 5);
    // Salvage scales symmetrically so refunds stay proportional.
    const salvageDesert = computeTerrainChangeCost("water", "rough", 1, "desert");
    const salvageParkland = computeTerrainChangeCost("water", "rough", 1, "parkland");
    expect(salvageDesert.refunded).toBeCloseTo(salvageParkland.refunded * 1.5, 5);
  });

  it("links deep rough punishes shots slightly harder", () => {
    const width = 20;
    const height = 20;
    const tiles: Terrain[] = Array.from({ length: width * height }, () => "deep_rough" as Terrain);
    const course = (theme: LandTheme) => ({
      ...DEFAULT_COURSE,
      width,
      height,
      tiles,
      elevations: new Array(width * height).fill(0),
      theme,
    });
    const pen = (theme: LandTheme) =>
      computeExpectedLandingPenalty({
        course: course(theme),
        target: { x: 10, y: 10 },
        dispersionTiles: 2,
      }).expectedPenalty;
    expect(pen("links")).toBeCloseTo(pen("parkland") * 1.15, 5);
    expect(pen("desert")).toBeCloseTo(pen("parkland"), 5);
  });

  it("legacy themes survive save/load while unsupported themes fail closed", () => {
    const save = (theme: unknown) => ({
      schemaVersion: 1,
      savedAt: 0,
      course: { ...DEFAULT_COURSE, theme, biomeCompatibility: undefined },
      world: DEFAULT_WORLD,
    });
    expect(normalizeLoadedSave(save("links"))!.course.theme).toBe("links");
    expect(normalizeLoadedSave(save("moonbase"))).toBeNull();
    expect(normalizeLoadedSave(save(undefined))!.course.theme).toBe("parkland");
  });
});
