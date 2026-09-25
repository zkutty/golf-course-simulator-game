import { describe, expect, it } from "vitest";
import { courseForCourseSetup } from "../models/courseSetup";
import type { PinRotation, Point } from "../models/types";
import { createM23CourseSetupReferenceCourse, createParklandVisualReferenceCourse } from "../testing/referenceCourse";
import { deriveCourseSceneComposition } from "./courseSceneComposition";
import {
  COURSE_SCENE_CAMERA_NORMAL_MARGIN,
  COURSE_SCENE_CAMERA_OVERVIEW_MARGIN,
  COURSE_SCENE_CAMERA_SEMANTIC_CLEARANCE_PX,
  deriveCourseSceneCamera,
} from "./courseSceneCamera";
import { ISO_ROTATIONS, worldToIso, type IsoRotation } from "./iso";

const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 800, height: 500 },
] as const;

function screenOffset(point: Point, center: Point, zoom: number, rotation: IsoRotation): Point {
  const projected = worldToIso(point.x, point.y, 0, rotation);
  const projectedCenter = worldToIso(center.x, center.y, 0, rotation);
  return { x: (projected.x - projectedCenter.x) * zoom, y: (projected.y - projectedCenter.y) * zoom };
}

function oldCozyZoom(
  tee: Point,
  pin: Point,
  viewport: (typeof VIEWPORTS)[number],
): number {
  const minX = Math.min(tee.x, pin.x) - 4;
  const minY = Math.min(tee.y, pin.y) - 4;
  const maxX = Math.max(tee.x, pin.x) + 4;
  const maxY = Math.max(tee.y, pin.y) + 4;
  const projectedWidth = ((maxX - minX + 1) + (maxY - minY + 1)) * 32;
  const projectedHeight = ((maxX - minX + 1) + (maxY - minY + 1)) * 16;
  return Math.min(viewport.width * 0.95 / projectedWidth, viewport.height * 0.95 / projectedHeight) * 1.08;
}

describe("deriveCourseSceneCamera", () => {
  it("keeps authored landing and approach waypoints plus the owned strategic landmark in normal frames", () => {
    const course = createM23CourseSetupReferenceCourse();
    const waypoints = course.holes[0].waypoints;
    expect(waypoints).toEqual([{ x: 20, y: 18 }, { x: 31, y: 19 }]);
    const composition = deriveCourseSceneComposition({ course, seed: 1202 });
    const landmark = composition.landmarks.find((entry) => entry.kind === "strategic_hazard");
    expect(landmark).toBeDefined();

    for (const pinRotation of ["A", "B", "C"] as const) {
      for (const rotation of ISO_ROTATIONS) for (const viewport of VIEWPORTS) {
        const frame = deriveCourseSceneCamera({
          course,
          composition,
          activeHoleIndex: 0,
          teeSet: "member",
          pinRotation,
          viewport,
          rotation,
          mode: "normal",
        });
        expect(frame.route).toEqual([
          course.holes[0].tee,
          ...waypoints!,
          course.holes[0].pinPositions?.[pinRotation],
        ]);
        expect(frame.visiblePoints).toEqual(expect.arrayContaining([...waypoints!, landmark!.point]));
        for (const point of frame.visiblePoints) {
          const offset = screenOffset(point, frame.center, frame.zoom, rotation);
          expect(Math.abs(offset.x)).toBeLessThan(viewport.width / 2 - COURSE_SCENE_CAMERA_SEMANTIC_CLEARANCE_PX);
          expect(Math.abs(offset.y)).toBeLessThan(viewport.height / 2 - COURSE_SCENE_CAMERA_SEMANTIC_CLEARANCE_PX);
        }
      }
    }
  });

  it("frames authoritative M19 A/B/C setups and their accepted habitat at both supported viewport sizes", () => {
    const source = createM23CourseSetupReferenceCourse();
    const m19 = createParklandVisualReferenceCourse();
    expect({ width: source.width, height: source.height, tiles: source.tiles, elevations: source.elevations, obstacles: source.obstacles })
      .toEqual({ width: m19.width, height: m19.height, tiles: m19.tiles, elevations: m19.elevations, obstacles: m19.obstacles });
    const composition = deriveCourseSceneComposition({ course: source, seed: 1202 });
    expect(composition.sceneBounds).toEqual({ minX: 0, minY: 0, maxX: 47, maxY: 35 });
    const before = structuredClone({ source, composition });
    const habitatOwners = new Set<string>();
    const holeOwners = new Set<string>();
    const ownershipBySetup = new Map<PinRotation, string>();

    for (const pinRotation of ["A", "B", "C"] as const) {
      const resolved = courseForCourseSetup(source, "member", pinRotation).holes[0];
      let setupOwnership: string | null = null;
      for (const rotation of ISO_ROTATIONS) for (const viewport of VIEWPORTS) {
        const frame = deriveCourseSceneCamera({
          course: { ...source, activePinRotation: pinRotation },
          composition,
          activeHoleIndex: 0,
          teeSet: "member",
          viewport,
          rotation,
          mode: "normal",
        });

        expect(frame.source).toBe("active-hole");
        expect(frame.route[0]).toEqual(resolved.tee);
        expect(frame.route.at(-1)).toEqual(resolved.green);
        expect(frame.habitatZoneIds.length).toBeGreaterThan(0);
        expect(frame.visiblePoints).toEqual(expect.arrayContaining([resolved.tee, resolved.green]));
        expect(frame.visiblePoints.every((point) => point.x >= frame.bounds.minX && point.x <= frame.bounds.maxX
          && point.y >= frame.bounds.minY && point.y <= frame.bounds.maxY)).toBe(true);
        // Connected source-derived habitat extends beyond the old tee/pin-only
        // envelope, so the authoritative frame must widen rather than crop it.
        expect(frame.zoom).toBeLessThan(oldCozyZoom(resolved.tee!, resolved.green!, viewport));
        for (const point of frame.visiblePoints) {
          const offset = screenOffset(point, frame.center, frame.zoom, rotation);
          expect(Math.abs(offset.x)).toBeLessThanOrEqual(viewport.width * COURSE_SCENE_CAMERA_NORMAL_MARGIN / 2);
          expect(Math.abs(offset.y)).toBeLessThanOrEqual(viewport.height * COURSE_SCENE_CAMERA_NORMAL_MARGIN / 2);
        }
        frame.habitatZoneIds.forEach((id) => habitatOwners.add(id));
        holeOwners.add(frame.holeId!);
        const ownership = JSON.stringify(frame.habitatZoneIds);
        if (setupOwnership == null) setupOwnership = ownership;
        else expect(ownership).toBe(setupOwnership);
      }
      ownershipBySetup.set(pinRotation, setupOwnership!);
    }

    expect(holeOwners).toEqual(new Set(["hole-1"]));
    expect(new Set(ownershipBySetup.values()).size).toBe(1);
    expect(habitatOwners).toEqual(new Set(composition.habitatZones
      .filter((zone) => zone.occupancy.some((point) => point.x >= 2 && point.x <= 46 && point.y >= 12 && point.y <= 25))
      .map((zone) => zone.id)));
    expect({ source, composition }).toEqual(before);
  });

  it("is deterministic for all cardinal rotations while setup selection follows real course resolution", () => {
    const source = createM23CourseSetupReferenceCourse();
    const composition = deriveCourseSceneComposition({ course: source, seed: 1202 });

    for (const pinRotation of ["A", "B", "C"] as const) {
      const frames = ISO_ROTATIONS.map((rotation) => deriveCourseSceneCamera({
        course: { ...source, activePinRotation: pinRotation },
        composition,
        activeHoleIndex: 0,
        teeSet: "member",
        viewport: VIEWPORTS[0],
        rotation,
        mode: "normal",
      }));
      expect(frames.slice(1).every((frame) => frame.center.x === frames[0].center.x
        && frame.center.y === frames[0].center.y
        && frame.zoom === frames[0].zoom
        && JSON.stringify(frame.bounds) === JSON.stringify(frames[0].bounds))).toBe(true);
      expect(deriveCourseSceneCamera({
        course: { ...source, activePinRotation: pinRotation },
        composition,
        activeHoleIndex: 0,
        teeSet: "member",
        viewport: VIEWPORTS[0],
        rotation: 0,
        mode: "normal",
      })).toEqual(frames[0]);
    }

    const setupPins = (["A", "B", "C"] as PinRotation[]).map((pinRotation) => deriveCourseSceneCamera({
      course: { ...source, activePinRotation: pinRotation },
      composition,
      activeHoleIndex: 0,
      teeSet: "member",
      viewport: VIEWPORTS[0],
      rotation: 0,
      mode: "normal",
    }).route.at(-1));
    expect(new Set(setupPins.map((point) => `${point?.x},${point?.y}`)).size).toBe(3);
  });

  it("clips a large habitat owner to the deterministic active-route window", () => {
    const course = createParklandVisualReferenceCourse();
    const composition = deriveCourseSceneComposition({ course, seed: 1202 });
    const template = composition.habitatZones[0];
    const oversized = {
      ...template,
      id: "habitat-zone:test:oversized",
      ownerId: "habitat-zone:test:oversized",
      bounds: { x: 8, y: 18, width: 40, height: 18 },
      area: 2,
      occupancy: [{ x: 8, y: 18 }, { x: 47, y: 35 }],
      placements: [],
    };
    const frame = deriveCourseSceneCamera({
      course,
      composition: { ...composition, habitatZones: [oversized] },
      activeHoleIndex: 0,
      viewport: VIEWPORTS[0],
      rotation: 0,
      mode: "normal",
    });

    expect(frame.habitatZoneIds).toEqual([oversized.id]);
    expect(frame.visiblePoints).toContainEqual({ x: 8, y: 18 });
    expect(frame.visiblePoints).not.toContainEqual({ x: 47, y: 35 });
    expect(frame.bounds.maxX).toBeLessThan(47);
  });

  it("preserves complete estate overview framing for Architect and explicit Fit", () => {
    const course = createParklandVisualReferenceCourse();
    const composition = deriveCourseSceneComposition({ course, seed: 1202 });
    const overview = deriveCourseSceneCamera({
      course,
      composition,
      activeHoleIndex: 0,
      viewport: VIEWPORTS[0],
      rotation: 0,
      mode: "overview",
    });
    const normal = deriveCourseSceneCamera({
      course,
      composition,
      activeHoleIndex: 0,
      viewport: VIEWPORTS[0],
      rotation: 0,
      mode: "normal",
    });

    expect(overview).toMatchObject({
      mode: "overview",
      source: "overview",
      bounds: composition.sceneBounds,
      center: { x: 24, y: 18 },
      holeId: null,
      route: [],
      habitatZoneIds: [],
    });
    expect(overview.zoom).toBeCloseTo(1440 * COURSE_SCENE_CAMERA_OVERVIEW_MARGIN / ((48 + 36) * 32), 12);
    expect(normal.zoom).toBeGreaterThan(overview.zoom);
    expect(normal.bounds).not.toEqual(overview.bounds);
  });

  it("falls back safely for missing, incomplete, or unowned holes", () => {
    const course = createParklandVisualReferenceCourse();
    const composition = deriveCourseSceneComposition({ course, seed: 1202 });
    const input = {
      course,
      composition,
      activeHoleIndex: 9,
      viewport: VIEWPORTS[0],
      rotation: 270 as const,
      mode: "normal" as const,
    };
    expect(deriveCourseSceneCamera(input)).toMatchObject({
      mode: "normal",
      source: "fallback-overview",
      bounds: composition.sceneBounds,
      holeId: null,
    });

    const incomplete = { ...course, holes: [{ ...course.holes[0], tee: null, teeBoxes: undefined }] };
    expect(deriveCourseSceneCamera({ ...input, course: incomplete, activeHoleIndex: 0 }).source).toBe("fallback-overview");
    expect(deriveCourseSceneCamera({
      ...input,
      composition: { ...composition, holeEnvelopes: [] },
      activeHoleIndex: 0,
    }).source).toBe("fallback-overview");
  });
});
