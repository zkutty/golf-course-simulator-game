import { describe, expect, it } from "vitest";
import { applyAction } from "../../core/reducer";
import { DEFAULT_COURSE, DEFAULT_WORLD } from "../models/defaults";
import type { Course } from "../models/types";
import { validateGreenSurfaceV1 } from "./greenSurface";
import {
  FINE_GREEN_BRUSHES,
  computeFineGreenSculptPreview,
  fineGreenEarthworkSteps,
} from "./fineGreenSculpt";
import {
  GREEN_OVERLAY_COMMAND_BUDGET,
  buildGreenSurfaceOverlayCommands,
} from "./greenSurfaceRender";

function greenCourse(width = 3, height = 2): Course {
  return {
    ...DEFAULT_COURSE,
    width,
    height,
    tiles: new Array(width * height).fill("green"),
    elevations: new Array(width * height).fill(2),
    holes: [{ ...DEFAULT_COURSE.holes[0], id: "fine-green", green: { x: 1, y: 0 } }],
    obstacles: [],
    buildings: [],
    decorations: [],
    greenSurface: undefined,
  };
}

function sample(surface: ReturnType<typeof computeFineGreenSculptPreview>["surface"], x: number, y: number, sx: number, sy: number): number {
  return surface.tiles.find((tile) => tile.x === x && tile.y === y)?.offsets[sy * 4 + sx] ?? 0;
}

describe("ZK-638 fine-green authoring", () => {
  it("authors every brush as a bounded canonical green-only edit", () => {
    const course = greenCourse();
    for (const brush of FINE_GREEN_BRUSHES) {
      const seeded = brush === "smooth" || brush === "flatten"
        ? { ...course, greenSurface: computeFineGreenSculptPreview({ course, points: [{ x: 1.5, y: 0.5 }], brush: "raise", radius: 1 }).surface }
        : course;
      const preview = computeFineGreenSculptPreview({
        course: seeded,
        points: brush === "tilt" || brush === "ridge"
          ? [{ x: 0.7, y: 0.5 }, { x: 2.3, y: 0.5 }]
          : [{ x: 1.5, y: 0.5 }],
        brush,
        radius: 1,
      });
      expect(preview.changedSamples, brush).toBeGreaterThan(0);
      expect(preview.surface.tiles.every((tile) => seeded.tiles[tile.y * seeded.width + tile.x] === "green")).toBe(true);
      expect(preview.surface.tiles.flatMap((tile) => tile.offsets).every((offset) => Number.isInteger(offset) && Math.abs(offset) <= 2_048)).toBe(true);
      expect(validateGreenSurfaceV1(preview.surface, seeded).ok).toBe(true);
      expect(JSON.parse(JSON.stringify(preview.surface))).toEqual(preview.surface);
    }
  });

  it("shares seam heights, blends the green perimeter to coarse terrain, and clips off-green input", () => {
    const course = greenCourse(2, 2);
    course.tiles[3] = "rough";
    const preview = computeFineGreenSculptPreview({
      course,
      points: [{ x: 0.65, y: 0.45 }, { x: 1.35, y: 0.45 }, { x: 1.6, y: 1.6 }],
      brush: "ridge",
      radius: 1,
    });
    expect(preview.clippedPoints).toBe(1);
    // The shared x=1 edge has one physical height on both tile records.
    expect(sample(preview.surface, 0, 0, 3, 1)).toBe(sample(preview.surface, 1, 0, 0, 1));
    expect(sample(preview.surface, 0, 0, 3, 2)).toBe(sample(preview.surface, 1, 0, 0, 2));
    // Outer edge samples remain the coarse survey handoff.
    for (let sx = 0; sx < 4; sx++) expect(sample(preview.surface, 0, 0, sx, 0)).toBe(0);
    expect(preview.surface.tiles.some((tile) => tile.x === 1 && tile.y === 1)).toBe(false);
  });

  it("charges exact changed fixed-point volume and applies atomically in the reducer", () => {
    const course = greenCourse();
    const preview = computeFineGreenSculptPreview({ course, points: [{ x: 1.5, y: 0.5 }], brush: "bowl", radius: 1 });
    const state = {
      course,
      world: { ...DEFAULT_WORLD, cash: 100_000, isBankrupt: false },
      selectedTerrain: "fairway" as const,
      terrainVersion: 0,
      obstaclesVersion: 0,
      markersVersion: 0,
      economyVersion: 0,
    };
    const next = applyAction(state, { type: "SCULPT_GREEN", surface: preview.surface });
    expect(next.course.greenSurface).toEqual(preview.surface);
    expect(next.world.cash).toBeLessThan(state.world.cash);
    expect(next.terrainVersion).toBe(1);
    expect(next.economyVersion).toBe(1);
    expect(fineGreenEarthworkSteps(course, course.greenSurface, preview.surface)).toBeCloseTo(preview.earthworkSteps, 10);

    const unaffordable = applyAction({ ...state, world: { ...state.world, cash: 0 } }, { type: "SCULPT_GREEN", surface: preview.surface });
    expect(unaffordable).toEqual({ ...state, world: { ...state.world, cash: 0 } });
  });

  it("projects bounded, deterministic, non-colour-only contours, arrows, fall lines, and shading", () => {
    const course = greenCourse(12, 8);
    let sculpted = course;
    for (const point of [{ x: 2.5, y: 2.5 }, { x: 5.5, y: 3.5 }, { x: 8.5, y: 5.5 }]) {
      const preview = computeFineGreenSculptPreview({ course: sculpted, points: [point], brush: "tilt", radius: 1.5 });
      sculpted = { ...sculpted, greenSurface: preview.surface };
    }
    const standard = buildGreenSurfaceOverlayCommands({ course: sculpted, quality: "high", colorVision: "standard" });
    const cvd = buildGreenSurfaceOverlayCommands({ course: sculpted, quality: "high", colorVision: "deuteranopia" });
    expect(standard).toEqual(buildGreenSurfaceOverlayCommands({ course: sculpted, quality: "high", colorVision: "standard" }));
    expect(standard.contours.length).toBeGreaterThan(0);
    expect(standard.arrows.length).toBeGreaterThan(0);
    expect(standard.fallLines.length).toBe(standard.arrows.length);
    expect(standard.shades.length).toBe(standard.arrows.length);
    expect(standard.contours.length + standard.arrows.length + standard.fallLines.length + standard.shades.length).toBeLessThanOrEqual(GREEN_OVERLAY_COMMAND_BUDGET);
    expect(cvd.palette).not.toEqual(standard.palette);
    // Geometry does not change with color-vision mode; dots, double-stroked
    // contours, and arrowheads carry the non-colour distinctions in Pixi.
    expect(cvd.contours).toEqual(standard.contours);
    expect(cvd.arrows).toEqual(standard.arrows);
  });
});
