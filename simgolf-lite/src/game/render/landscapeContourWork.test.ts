import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createM27ReleaseReferenceCourse, createParklandVisualReferenceCourse } from "../testing/referenceCourse";
import { courseWithEffectiveSurfaces } from "../conditions/surfaceCare";
import type { Terrain } from "../models/types";
import { buildTerrainPresentationMap } from "./terrainPresentationPolicy";
import { createLandscapeComponentCache, type LandscapeOptions } from "./landscapeGeometry";
import * as sharedContours from "./sharedBoundaryContours";

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value, (_, item: unknown) => {
    if (typeof item !== "number") return item;
    const bytes = Buffer.alloc(8); bytes.writeDoubleBE(item);
    return ["f64", bytes.toString("hex")];
  })).digest("hex");
}

afterEach(() => vi.restoreAllMocks());

describe("landscape cache shared-contour work", () => {
  it("matches the original ordered full-plan IEEE goldens across fixtures, domains and qualities", () => {
    const hashes: string[] = [];
    for (const fixture of ["m19", "m27"] as const) {
      for (const theme of fixture === "m19" ? ["parkland"] as const : ["parkland", "links", "desert"] as const) {
        const course = fixture === "m19" ? createParklandVisualReferenceCourse() : createM27ReleaseReferenceCourse(theme);
        const effective = courseWithEffectiveSurfaces(course).tiles;
        const presentation = buildTerrainPresentationMap(effective, course.width, course.height, course.theme).presentationTiles;
        for (const quality of ["high", "medium", "low"] as const) {
          const options = { cornerRadius: quality === "high" ? 0.4 : 0.32, cornerSegments: quality === "high" ? 4 : 2 };
          const cache = createLandscapeComponentCache();
          for (const tiles of [effective, presentation, presentation, effective]) {
            hashes.push(digest(cache.update(tiles, course.width, course.height, options)));
          }
        }
      }
    }
    expect(hashes).toHaveLength(48);
    // Captured from unmodified 4da landscapeGeometry before this packet's source edit.
    expect(createHash("sha256").update(JSON.stringify(hashes)).digest("hex")).toBe("954c05225260bdc0bbf72fd13a3cd8e4b458c570b1d0f49cf130eb9622a13185");
  });

  it("skips only dead all-hit contour work, still observing same-array dirty boundaries", () => {
    const build = vi.spyOn(sharedContours, "buildSharedBoundaryContours");
    const tiles: Terrain[] = ["rough", "rough", "rough", "rough", "fairway", "rough", "rough", "rough", "rough"];
    const cache = createLandscapeComponentCache();
    const first = cache.update(tiles, 3, 3);
    expect(build).toHaveBeenCalledTimes(1);
    const repeated = cache.update(tiles, 3, 3);
    expect(build).toHaveBeenCalledTimes(1);
    expect(repeated.stats).toEqual({ hits: 2, misses: 0, components: 2 });
    expect(repeated.changed).toEqual([]);
    expect(repeated.components[0]).toBe(first.components[0]);
    tiles[0] = "sand"; // A diagonal halo edit dirties a component without changing its cells.
    const dirty = cache.update(tiles, 3, 3);
    expect(build).toHaveBeenCalledTimes(2);
    expect(dirty.components.find((c) => c.terrain === "fairway")).not.toBe(first.components.find((c) => c.terrain === "fairway"));
    const copy = cache.update([...tiles], 3, 3);
    expect(build).toHaveBeenCalledTimes(2);
    expect(copy.components[0]).toBe(dirty.components[0]);
    tiles[4] = "rough"; cache.update(tiles, 3, 3);
    tiles[4] = "fairway"; cache.update(tiles, 3, 3);
    tiles[0] = "rough"; cache.update(tiles, 3, 3);
    expect(build).toHaveBeenCalledTimes(5);
    cache.clear();
    const cleared = cache.update(tiles, 3, 3);
    expect(build).toHaveBeenCalledTimes(6);
    expect(cleared.stats.hits).toBe(0);
    expect(cleared.components[0]).not.toBe(first.components[0]);
  });

  it.each(["normal", "different", "nan", "infinity", "radiusThrow", "segmentsThrow", "coercion"] as const)("preserves shared option getter reads and errors: %s", (mode) => {
    const cache = createLandscapeComponentCache();
    const tiles: Terrain[] = ["rough", "rough", "rough", "rough", "fairway", "rough", "rough", "rough", "rough"];
    cache.update(tiles, 3, 3, { cornerRadius: 0.4, cornerSegments: 4 });
    const trace: string[] = []; let radiusReads = 0, segmentReads = 0;
    const options = {
      get cornerRadius() {
        trace.push("radius"); radiusReads++;
        if (radiusReads === 2) {
          if (mode === "radiusThrow") throw new Error("radius secondread");
          if (mode === "different") return 0.1;
          if (mode === "nan") return NaN;
          if (mode === "infinity") return Infinity;
          if (mode === "coercion") return { valueOf() { trace.push("coerce"); throw new Error("coercion"); } } as unknown as number;
        }
        return 0.4;
      },
      get cornerSegments() {
        trace.push("segments"); segmentReads++;
        if (mode === "segmentsThrow" && segmentReads === 2) throw new Error("segments secondread");
        return 4;
      },
    };
    const run = () => cache.update(tiles, 3, 3, options);
    if (mode === "radiusThrow") expect(run).toThrow("radius secondread");
    else if (mode === "segmentsThrow") expect(run).toThrow("segments secondread");
    else if (mode === "coercion") expect(run).toThrow("coercion");
    else expect(run().stats).toEqual({ hits: 2, misses: 0, components: 2 });
    expect(trace).toEqual(mode === "radiusThrow" ? ["radius", "segments", "radius"] : mode === "coercion" ? ["radius", "segments", "radius", "segments", "coerce"] : ["radius", "segments", "radius", "segments"]);
  });

  it("preserves subsequent materialization getter reads on a path miss", () => {
    const trace: string[] = [];
    const options = {
      get cornerRadius() { trace.push("radius"); return 0.4; },
      get cornerSegments() { trace.push("segments"); return 4; },
    };
    const cache = createLandscapeComponentCache();
    expect(cache.update(["path"], 1, 1, options).stats).toEqual({ hits: 0, misses: 1, components: 1 });
    expect(trace).toEqual(["radius", "segments", "radius", "segments", "radius", "segments"]);
  });

  it("preserves original malformed dimension/option outcomes on first and repeated updates", () => {
    const dimensions: Array<[number, number, Terrain[]]> = [[0, 0, []], [-1, 1, []], [Infinity, 1, []], [NaN, 1, []], [0.5, 2, ["rough"]], [1.5, 2, ["rough", "sand", "rough"]], [2, 2, ["rough"]], [1, 1, ["rough"]], [3, 1, ["rough", "sand", "path"]]];
    const options = [{}, { cornerRadius: NaN, cornerSegments: NaN }, { cornerRadius: Infinity, cornerSegments: Infinity }, { cornerRadius: -1, cornerSegments: 0 }, { cornerRadius: 0.32, cornerSegments: 2 }, { cornerRadius: "0.4", cornerSegments: "4" }, { cornerRadius: Symbol("r"), cornerSegments: 4 }, null];
    const outcomes: unknown[] = [];
    for (const [width, height, tiles] of dimensions) for (const option of options) {
      const cache = createLandscapeComponentCache();
      for (let repeat = 0; repeat < 2; repeat++) {
        try { outcomes.push({ value: cache.update(tiles, width, height, option as unknown as LandscapeOptions) }); }
        catch (error) { const exception = error as Error; outcomes.push({ error: { name: exception.name, message: exception.message } }); }
      }
    }
    expect(outcomes).toHaveLength(144);
    expect(digest(outcomes)).toBe("eb54d600afbd883fff8a100ee8759d53d1e63522171a07e9e2ef234130283d08");
  });
});
