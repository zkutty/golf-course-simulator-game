import { describe, expect, it } from "vitest";
import { DEFAULT_COURSE } from "../models/defaults";
import type { Course, Terrain } from "../models/types";
import { findWalkPathCells } from "../live/walkPath";
import { ISO_ROTATIONS, tileCenterIso } from "./iso";
import { buildLandscapeComponents, buildVisualHeightfield, sampleLandscapeSurfaceHeight } from "./landscapeGeometry";
import {
  GOLFER_CONTACT_SHADOW,
  GOLFER_GROUNDING_RENDER_BUDGET,
  ZK330_GROUNDED_GOLFER_CAPTURE_MANIFEST,
  advanceGroundedWalkPhase,
  groundedGolferFrame,
} from "./golferGrounding";

function groundedCourse(): Course {
  const width = 10;
  const height = 5;
  const tiles = Array.from({ length: width * height }, () => "fairway" as Terrain);
  const elevations = Array.from({ length: width * height }, () => 0);
  const set = (x: number, y: number, terrain: Terrain, elevation: number) => {
    tiles[y * width + x] = terrain;
    elevations[y * width + x] = elevation;
  };
  set(2, 2, "fairway", 0);
  set(3, 2, "rough", 1);
  set(4, 2, "fairway", 2);
  set(5, 2, "rough", 0);
  set(7, 2, "green", 1);
  return { ...DEFAULT_COURSE, width, height, tiles, elevations, buildings: [], decorations: [] };
}

function heightAt(course: Course, x: number, y: number): number {
  return course.elevations[Math.floor(y) * course.width + Math.floor(x)] ?? 0;
}

describe("ZK-330 grounded golfer traversal", () => {
  it("shares the connected recessed floor with golfer feet without changing walk authority", () => {
    const course = groundedCourse();
    course.tiles[22] = "sand";
    const before = JSON.stringify(course);
    const field = buildVisualHeightfield(course);
    const sand = buildLandscapeComponents(course.tiles, course.width, course.height).find((component) => component.terrain === "sand")!;
    const floor = (x: number, y: number) => sampleLandscapeSurfaceHeight(field, sand, x, y, true);
    for (const rotation of ISO_ROTATIONS) {
      const grounded = groundedGolferFrame(2, 2, rotation, floor);
      expect(grounded.elevation).toBe(floor(2.5, 2.5));
      expect(grounded.screen).toEqual(tileCenterIso(2, 2, floor(2.5, 2.5), rotation));
    }
    expect(JSON.stringify(course)).toBe(before);
  });
  it("samples the same landscape surface for feet, shadow, and depth through flat, slope, crest, basin, and green", () => {
    const course = groundedCourse();
    for (const rotation of ISO_ROTATIONS) {
      for (const sample of ZK330_GROUNDED_GOLFER_CAPTURE_MANIFEST.traversal) {
        const frame = groundedGolferFrame(sample.x, sample.y, rotation, (x, y) => heightAt(course, x, y));
        expect(frame.elevation).toBe(sample.elevation);
        expect(frame.screen).toEqual(tileCenterIso(sample.x, sample.y, sample.elevation, rotation));
        expect(frame.shadow).toBe(GOLFER_CONTACT_SHADOW);
        expect(Number.isFinite(frame.depth)).toBe(true);
      }
    }
  });

  it("has a finite, continuous fixed traversal with no teleport-sized step", () => {
    const samples = ZK330_GROUNDED_GOLFER_CAPTURE_MANIFEST.traversal;
    expect(samples[0]).toMatchObject(ZK330_GROUNDED_GOLFER_CAPTURE_MANIFEST.traveller.start);
    expect(samples.at(-1)).toMatchObject(ZK330_GROUNDED_GOLFER_CAPTURE_MANIFEST.traveller.destination);
    for (let index = 1; index < samples.length; index++) {
      const previous = samples[index - 1];
      const current = samples[index];
      expect(Math.hypot(current.x - previous.x, current.y - previous.y)).toBeLessThanOrEqual(2);
    }
  });

  it("does not advance a foot cycle during pauses or unchanged walking positions", () => {
    const initial = 3.25;
    const current = { x: 4, y: 2 };
    expect(advanceGroundedWalkPhase(initial, { x: 3, y: 2 }, current, "pause", 1.35)).toBe(initial);
    expect(advanceGroundedWalkPhase(initial, current, current, "walk", 1.35)).toBe(initial);
    expect(advanceGroundedWalkPhase(initial, { x: 3, y: 2 }, current, "walk", 1.35)).toBeCloseTo(4.6);
    expect(GOLFER_GROUNDING_RENDER_BUDGET).toEqual({
      holdersPerGolfer: 1,
      contactShadowsPerHolder: 1,
      newWorldEffectsPerTick: 0,
    });
  });

  it("keeps the existing walker authority: bridge crossings are valid and a water bank is blocked", () => {
    const course = groundedCourse();
    for (let y = 0; y < course.height; y++) course.tiles[y * course.width + 4] = "water";
    course.decorations = [{ kind: "bridge", x: 3, y: 2, rotation: 0, span: 1 }];
    const crossing = findWalkPathCells(course, { x: 2, y: 2 }, { x: 7, y: 2 });
    expect(crossing).not.toBeNull();
    expect(crossing!.some((cell) => cell.x === 4 && cell.y === 2)).toBe(true);

    // Route authority caches are intentionally keyed by an immutable course
    // snapshot, as editor commits replace rather than mutate the snapshot.
    const blockedCourse = { ...course, decorations: [] };
    expect(findWalkPathCells(blockedCourse, { x: 2, y: 2 }, { x: 7, y: 2 })).toBeNull();
  });

  it("declares four camera/quality capture states including reduced motion", () => {
    const captures = ZK330_GROUNDED_GOLFER_CAPTURE_MANIFEST.captures;
    expect(captures.map((capture) => capture.rotation)).toEqual([0, 90, 180, 270]);
    expect(captures.filter((capture) => capture.reducedMotion)).toHaveLength(2);
    expect(new Set(captures.map((capture) => capture.graphicsQuality))).toEqual(new Set(["low", "medium", "high"]));
  });
});
