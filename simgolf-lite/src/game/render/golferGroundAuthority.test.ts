import { describe, expect, it } from "vitest";
import { DEFAULT_COURSE } from "../models/defaults";
import type { Course, Terrain } from "../models/types";
import { ELEVATION_STEP_YARDS } from "../rules/obstacleCollision";
import { createLiveGolferGroundAuthority, GOLFER_GROUND_FOOT_RADIUS_TILES, type LiveGolferGroundInput } from "./golferGroundAuthority";
import { ISO_ROTATIONS, isoToWorld, tileCenterIso } from "./iso";
import { sampleLandscapeSurfaceHeight } from "./landscapeGeometry";

function fixture(): LiveGolferGroundInput {
  const course: Course = { ...structuredClone(DEFAULT_COURSE), width: 8, height: 8, tiles: Array<Terrain>(64).fill("fairway"), elevations: Array(64).fill(0), buildings: [], obstacles: [], decorations: [], holes: [] };
  return { course, effectiveTiles: course.tiles, field: { width: 8, height: 8, vertices: new Float32Array(81) }, componentsByCell: Array(64).fill(null), quality: "high", surfaceRevision: "surface:1" };
}
const at = (g: ReturnType<typeof createLiveGolferGroundAuthority>, x: number, y: number) => ({ x, y, heightYards: g.heightAt(x + .5, y + .5) * ELEVATION_STEP_YARDS });

describe("LIVE existing-ground footprint certificate", () => {
  it.each(["high", "medium", "low"] as const)("matches the current shared surface sampler at %s quality", quality => {
    const f = fixture();
    for (let y = 0; y <= 8; y++) for (let x = 0; x <= 8; x++) f.field.vertices[y * 9 + x] = Math.sin(x) + y * .1;
    f.course.tiles[18] = "rough"; f.course.elevations[18] = 3;
    const g = createLiveGolferGroundAuthority({ ...f, quality });
    for (const [x, y] of [[2.5, 2.5], [3.12, 2.81], [6.8, 6.3]]) {
      const i = Math.floor(y) * 8 + Math.floor(x), expected = quality === "low" && f.course.tiles[i] === "rough" ? 3 : sampleLandscapeSurfaceHeight(f.field, f.componentsByCell[i], x, y, true);
      expect(g.heightAt(x, y)).toBe(expected);
      expect(g.sampleFootprintAt(x, y).heightYards).toBe(expected * ELEVATION_STEP_YARDS);
    }
  });

  it("certifies the whole bounded flat corridor and detaches endpoints", () => {
    const f = fixture(), before = structuredClone(f.course), g = createLiveGolferGroundAuthority(f);
    const a = at(g, 2, 2), b = at(g, 3.2, 3.1), result = g.sweepFootprint(a, b, 32)!;
    expect(result).toMatchObject({ supportedThroughout: true, continuousHeight: true, inBounds: true, footprintsTested: 4 });
    expect(Object.isFrozen(result)).toBe(true); a.x = 99; b.y = 99; expect(result.from.x).toBe(2); expect(result.to.y).toBe(3.1);
    expect(f.course).toEqual(before);
  });

  it.each(["water", "building", "decoration"] as const)("rejects a blocked %s in the corridor even with legal endpoints", kind => {
    const f = fixture();
    if (kind === "water") f.course.tiles[3 * 8 + 3] = "water";
    if (kind === "building") f.course.buildings = [{ type: "snack_bar", x: 3, y: 3, tier: 1, price: 5 }];
    if (kind === "decoration") f.course.decorations = [{ kind: "fence", x: 3, y: 3, rotation: 0, span: 1 }];
    const g = createLiveGolferGroundAuthority(f);
    expect(g.sweepFootprint(at(g, 1, 1), at(g, 5, 5), 32)).toBeNull();
  });

  it("uses the existing valid bridge permission and rejects unsupported water", () => {
    const f = fixture(); f.course.tiles[2 * 8 + 4] = "water";
    expect(createLiveGolferGroundAuthority(f).sampleFootprintAt(4.5, 2.5).supportedFootprint).toBe(false);
    // A distinct immutable course instance avoids the existing authority cache.
    const bridged = structuredClone(f.course); bridged.decorations = [{ kind: "bridge", x: 3, y: 2, rotation: 0, span: 1 }];
    expect(createLiveGolferGroundAuthority({ ...f, course: bridged }).sampleFootprintAt(4.5, 2.5).supportedFootprint).toBe(true);
  });

  it("covers actual authored walking shoe geometry in all8views throughout the gait", async () => {
    const model = await import(new URL("../../../scripts/lib/natural-golfer-model.mjs", import.meta.url).href);
    for (const direction of model.DIRECTIONS) for (let i = 0; i <= 120; i++) {
      const degrees = model.bodyAngle(direction, "walk"), origin = model.project({ s: 0, f: 0, h: 0 }, degrees);
      const skeleton = model.skeletonFor(model.poseFor("walk", i / 720));
      for (const leg of skeleton.legs) for (const side of [-1, 1]) for (const forward of [-1, 1]) {
        const p = model.project({ s: leg.ankle[0] + side * 1.54, f: leg.ankle[1] + .8 + forward * (model.MODEL.shoeLength / 2 + .14), h: 0 }, degrees);
        const world = isoToWorld((p.x - origin.x) * 26 / 48, (p.y - origin.y) * 26 / 48);
        expect(Math.abs(world.x)).toBeLessThan(GOLFER_GROUND_FOOT_RADIUS_TILES);
        expect(Math.abs(world.y)).toBeLessThan(GOLFER_GROUND_FOOT_RADIUS_TILES);
      }
    }
    const f = fixture(); f.course.tiles[2 * 8] = "water";
    expect(createLiveGolferGroundAuthority(f).sampleFootprintAt(1.121, 2.5).supportedFootprint).toBe(false);
  });

  it.each([NaN, Infinity, -Infinity])("rejects nonfinite Low endpoint and interior heights: %s", value => {
    const f = fixture(); f.course.tiles.fill("rough"); f.course.elevations[2 * 8 + 2] = value;
    const g = createLiveGolferGroundAuthority({ ...f, quality: "low" });
    expect(g.sampleFootprintAt(2.5, 2.5).supportedFootprint).toBe(false);
    expect(g.sweepFootprint({ x: 2, y: 2, heightYards: 0 }, { x: 2.1, y: 2, heightYards: 0 }, 32)).toBeNull();
    expect(g.sweepFootprint(at(g, 1, 2), at(g, 3, 2), 32)).toBeNull();
  });

  it("bounds work and rejects invalid endpoints, missing geometry and clipped footprints", () => {
    const f = fixture(), g = createLiveGolferGroundAuthority(f), a = at(g, 1, 1), b = at(g, 6, 6);
    for (const budget of [0, 33, NaN, 1.5, 4]) expect(g.sweepFootprint(a, b, budget)).toBeNull();
    expect(g.sweepFootprint(a, { ...a, heightYards: 1 }, 32)).toBeNull();
    for (const x of [-1, .1, 8, Infinity, NaN]) expect(g.sampleFootprintAt(x, 2).supportedFootprint).toBe(false);
    const missing = createLiveGolferGroundAuthority({ ...f, field: { ...f.field, vertices: new Float32Array(0) } });
    expect(missing.sampleFootprintAt(2, 2).supportedFootprint).toBe(false); expect(missing.sweepFootprint(a, a, 32)).toBeNull();
  });

  it("rejects Low tile steps and hazard-floor discontinuities rather than certifying a smooth path", () => {
    const f = fixture(); f.course.tiles.fill("rough"); f.course.elevations[2 * 8 + 3] = 1;
    const low = createLiveGolferGroundAuthority({ ...f, quality: "low" });
    expect(low.sweepFootprint(at(low, 2, 2), at(low, 3, 2), 32)).toBeNull();
    const sand = fixture(); sand.course.tiles[2 * 8 + 3] = "sand";
    (sand.componentsByCell as (NonNullable<LiveGolferGroundInput["componentsByCell"][number]> | null)[])[19] = { terrain: "sand", cells: [19], presentationCells: [19], rings: [], bounds: { minX: 3, maxX: 4, minY: 2, maxY: 3 }, topologyKey: "sand" };
    const g = createLiveGolferGroundAuthority(sand);
    expect(g.sweepFootprint(at(g, 2, 2), at(g, 3, 2), 32)).toBeNull();
  });

  it.each(["slope", "crest", "basin"] as const)("analytically bounds all-camera continuous derivative across a %s", terrain => {
    const f = fixture();
    for (let y = 0; y <= 8; y++) for (let x = 0; x <= 8; x++) f.field.vertices[y * 9 + x] = terrain === "slope" ? .2 * x + .3 * y : (terrain === "crest" ? 1 : -1) * Math.abs(x - 3) * .3 + .2 * y;
    const g = createLiveGolferGroundAuthority(f), a = at(g, 1.8, 2.1), b = at(g, 4.1, 3.1), receipt = g.sweepFootprint(a, b, 32)!;
    expect(receipt).not.toBeNull();
    for (const rotation of ISO_ROTATIONS) for (let i = 0; i < 1000; i++) {
      const p = i / 1000, q = (i + 1) / 1000;
      const sample = (t: number) => { const x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t; return tileCenterIso(x, y, g.heightAt(x + .5, y + .5), rotation); };
      const before = sample(p), after = sample(q);
      expect(Math.hypot(after.x - before.x, after.y - before.y) * 1000).toBeLessThanOrEqual(receipt.maxProjectedDerivativePx + 1e-6);
    }
  });
});
