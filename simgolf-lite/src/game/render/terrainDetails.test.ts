import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_COURSE } from "../models/defaults";
import type { Terrain } from "../models/types";
import {
  deriveTerrainDetail,
  TERRAIN_DETAILS,
  TERRAIN_DETAIL_FRAMES,
} from "./terrainDetails";

describe("terrain detail registry", () => {
  it("ships two atlas frames for every detail family", () => {
    expect(TERRAIN_DETAIL_FRAMES).toHaveLength(TERRAIN_DETAILS.length * 2);
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
    const atlas = JSON.parse(readFileSync(path.join(root, "public/atlases/terrain-details.json"), "utf8")) as {
      frames: Record<string, unknown>;
    };
    for (const frame of TERRAIN_DETAIL_FRAMES) expect(atlas.frames[frame]).toBeTruthy();
  });

  it("is deterministic and does not dress maintained turf", () => {
    const course = {
      ...DEFAULT_COURSE,
      theme: "parkland" as const,
      width: 5,
      height: 5,
      tiles: Array<Terrain>(25).fill("rough"),
    };
    expect(deriveTerrainDetail(course, 412, 2, 2)).toEqual(deriveTerrainDetail(course, 412, 2, 2));
    course.tiles[2 * course.width + 2] = "fairway";
    expect(deriveTerrainDetail(course, 412, 2, 2)).toBeNull();
  });

  it("reserves shoreline and bunker dressing for matching edges", () => {
    const tiles = Array<Terrain>(25).fill("fairway");
    tiles[2 * 5 + 2] = "rough";
    const course = { ...DEFAULT_COURSE, theme: "parkland" as const, width: 5, height: 5, tiles };
    const withoutEdge = Array.from({ length: 256 }, (_, seed) => deriveTerrainDetail(course, seed, 2, 2))
      .filter((placement) => placement?.frame.includes("shore_stones") || placement?.frame.includes("bunker_tuft"));
    expect(withoutEdge).toEqual([]);

    course.tiles[2 * 5 + 3] = "water";
    const withWater = Array.from({ length: 512 }, (_, seed) => deriveTerrainDetail(course, seed, 2, 2));
    expect(withWater.some((placement) => placement?.frame.includes("shore_stones"))).toBe(true);
  });

  it("uses fescue for Links deep rough and scrub/pebbles for waste", () => {
    const links = {
      ...DEFAULT_COURSE,
      theme: "links" as const,
      width: 1,
      height: 1,
      tiles: ["deep_rough" as const],
    };
    const linksFrames = Array.from({ length: 512 }, (_, seed) => deriveTerrainDetail(links, seed, 0, 0)?.frame);
    expect(linksFrames.some((frame) => frame?.includes("fescue"))).toBe(true);

    const desert = { ...links, theme: "desert" as const, tiles: ["waste_area" as const] };
    const wasteFrames = Array.from({ length: 512 }, (_, seed) => deriveTerrainDetail(desert, seed, 0, 0)?.frame);
    expect(wasteFrames.some((frame) => frame?.includes("pebbles") || frame?.includes("scrub"))).toBe(true);
  });
});
