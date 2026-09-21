import { performance } from "node:perf_hooks";
import { describe, expect, it } from "vitest";
import highAtlasJson from "../../assets/terrain/parkland-habitat-4x/high/habitat-atlas.json";
import { hashCanonicalValue } from "../../utils/canonical";
import { courseForCourseSetup } from "../models/courseSetup";
import type { Course, Hole, Point, Terrain } from "../models/types";
import { createM23CourseSetupReferenceCourse, createParklandVisualReferenceCourse } from "../testing/referenceCourse";
import {
  resolveHabitatFieldTopology,
  type HabitatFieldTopologyRequest,
  type ParklandHabitatAtlasCatalog,
} from "./habitatFieldTopology";
import {
  COURSE_SCENE_INTER_ZONE_GAP_CELLS,
  deriveCourseSceneComposition,
  type CourseSceneCompositionPlanV1,
  type CourseSceneHabitatZoneV1,
  type SceneExclusionGeometryV1,
} from "./courseSceneComposition";

const HIGH_ATLAS = highAtlasJson as unknown as ParklandHabitatAtlasCatalog;
const CARDINALS = [{ x: 0, y: -1 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 }] as const;

function baseCourse(width = 20, height = 16): Course {
  return {
    width,
    height,
    tiles: new Array<Terrain>(width * height).fill("rough"),
    elevations: new Array<number>(width * height).fill(0),
    holes: [],
    obstacles: [],
    buildings: [],
    yardsPerTile: 10,
    name: "composition test",
    baseGreenFee: 1,
    condition: 1,
    theme: "parkland",
  };
}

function pointKey(point: Point): string {
  return `${point.x},${point.y}`;
}

function cell(course: Course, point: Point): number {
  return point.y * course.width + point.x;
}

function assertCardinallyConnected(points: readonly Point[]): void {
  const remaining = new Set(points.map(pointKey));
  const first = points[0];
  expect(first).toBeDefined();
  remaining.delete(pointKey(first));
  const queue = [first];
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    for (const offset of CARDINALS) {
      const next = { x: queue[cursor].x + offset.x, y: queue[cursor].y + offset.y };
      if (!remaining.delete(pointKey(next))) continue;
      queue.push(next);
    }
  }
  expect(remaining.size).toBe(0);
}

function assertEvidence(course: Course, zone: CourseSceneHabitatZoneV1): void {
  const source = new Set(zone.evidence.sourcePoints.map(pointKey));
  if (zone.evidence.kind === "tree_grove") {
    expect(["woodland_floor", "understory_edge"]).toContain(zone.family);
    expect(zone.evidence.sourcePoints.length).toBeGreaterThanOrEqual(2);
    expect(zone.evidence.sourcePoints.every((point) => course.obstacles.some((obstacle) => obstacle.type === "tree"
      && obstacle.x === point.x && obstacle.y === point.y))).toBe(true);
    assertCardinallyConnected(zone.evidence.sourcePoints);
  } else if (zone.evidence.kind === "rock") {
    expect(zone.family).toBe("rock_leaf_transition");
    expect(zone.evidence.sourcePoints).toHaveLength(1);
    const rock = zone.evidence.sourcePoints[0];
    expect(course.obstacles.some((obstacle) => obstacle.type === "rock" && obstacle.x === rock.x && obstacle.y === rock.y)).toBe(true);
    expect(zone.occupancy.every((point) => Math.max(Math.abs(point.x - rock.x), Math.abs(point.y - rock.y)) <= 3)).toBe(true);
  } else if (zone.evidence.kind === "deep_rough_margin") {
    expect(zone.family).toBe("meadow_deep_rough_margin");
    expect(zone.evidence.sourcePoints.every((point) => course.tiles[cell(course, point)] === "deep_rough")).toBe(true);
    for (const point of zone.occupancy) {
      expect(source.has(pointKey(point)) || CARDINALS.some((offset) => source.has(`${point.x + offset.x},${point.y + offset.y}`))).toBe(true);
    }
  } else {
    expect(zone.family).toBe("wet_shore");
    expect(zone.evidence.sourcePoints.every((point) => ["water", "wetland"].includes(course.tiles[cell(course, point)]))).toBe(true);
    for (const point of zone.occupancy) {
      expect(CARDINALS.some((offset) => source.has(`${point.x + offset.x},${point.y + offset.y}`))).toBe(true);
    }
  }
}

function assertExactT1(zone: CourseSceneHabitatZoneV1): void {
  const resolved = resolveHabitatFieldTopology({
    occupancy: { bounds: zone.bounds, occupied: zone.occupancy },
    family: zone.family,
    seed: 1202,
    atlas: HIGH_ATLAS,
  });
  expect(resolved.ok).toBe(true);
  if (!resolved.ok) return;
  expect(zone.placements).toEqual(resolved.placements);
  expect(zone.placements).toHaveLength(zone.area);
  expect(new Set(zone.placements.map((placement) => pointKey(placement.tile))))
    .toEqual(new Set(zone.occupancy.map(pointKey)));
  for (const placement of zone.placements) {
    const frame = HIGH_ATLAS.frames[placement.frameId];
    expect(frame).toBeDefined();
    expect(placement).toMatchObject({
      family: frame.family,
      topologyRole: frame.topologyRole,
      direction: frame.direction,
      corner: frame.corner,
      variant: frame.variant,
      atlasAnchor: frame.anchor,
      edgeAnchors: frame.edgeAnchors,
    });
    expect(placement.worldAnchor).toEqual({
      x: placement.tile.x + frame.anchor.x / frame.frame.width,
      y: placement.tile.y + frame.anchor.y / frame.frame.height,
    });
  }
}

function assertChebyshevGap(plan: CourseSceneCompositionPlanV1): void {
  for (let left = 0; left < plan.habitatZones.length; left += 1) {
    for (let right = left + 1; right < plan.habitatZones.length; right += 1) {
      for (const a of plan.habitatZones[left].occupancy) for (const b of plan.habitatZones[right].occupancy) {
        expect(Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y))).toBeGreaterThan(COURSE_SCENE_INTER_ZONE_GAP_CELLS);
      }
    }
  }
}

function expectGeometryExpanded(course: Course, geometry: SceneExclusionGeometryV1): void {
  const cells = new Set(geometry.cells);
  for (const owner of geometry.owners) for (const source of owner.sourcePoints) {
    for (let dy = -owner.radius; dy <= owner.radius; dy += 1) for (let dx = -owner.radius; dx <= owner.radius; dx += 1) {
      const point = { x: source.x + dx, y: source.y + dy };
      if (point.x < 0 || point.y < 0 || point.x >= course.width || point.y >= course.height) continue;
      expect(cells.has(cell(course, point))).toBe(true);
      expect(owner.cells).toContain(cell(course, point));
    }
  }
}

function evidenceCourse(): Course {
  const course = baseCourse(24, 20);
  for (let y = 5; y <= 8; y += 1) for (let x = 5; x <= 8; x += 1) course.tiles[y * course.width + x] = "deep_rough";
  for (let y = 12; y <= 15; y += 1) for (let x = 5; x <= 9; x += 1) course.tiles[y * course.width + x] = "water";
  course.obstacles = [
    { x: 16, y: 5, type: "rock" },
    { x: 17, y: 13, type: "tree" }, { x: 18, y: 13, type: "tree" },
    { x: 17, y: 14, type: "tree" }, { x: 18, y: 14, type: "tree" },
  ];
  return course;
}

function stressCourse(): Course {
  const course = baseCourse(30, 30);
  const holes: Hole[] = [];
  for (let index = 0; index < 36; index += 1) {
    const x = 1 + (index % 6) * 5;
    const y = 1 + Math.floor(index / 6) * 5;
    holes.push({
      id: `stress-${index}`,
      tee: { x, y },
      green: { x: Math.min(29, x + 3), y: Math.min(29, y + 2) },
      parMode: "AUTO",
    });
  }
  course.holes = holes;
  course.obstacles = Array.from({ length: 100 }, (_, index) => ({
    x: index * 7 % course.width,
    y: index * 11 % course.height,
    type: index % 9 === 0 ? "rock" as const : "tree" as const,
  }));
  return course;
}

describe("CourseSceneCompositionPlanV1", () => {
  it("turns actual M19 evidence into exact full-occupancy T1 zones without mutating authority", () => {
    const course = createParklandVisualReferenceCourse();
    const before = structuredClone(course);
    const plan = deriveCourseSceneComposition({ course, seed: 1202 });

    expect(plan.version).toBe(1);
    expect(plan.semantics).toBe("course-scene-composition-v1");
    expect(plan.sceneBounds).toEqual({ minX: 0, minY: 0, maxX: 47, maxY: 35 });
    expect(plan.habitatZones.length).toBeGreaterThanOrEqual(4);
    expect(plan.habitatZones.reduce((total, zone) => total + zone.area, 0)).toBeGreaterThanOrEqual(8);
    for (const zone of plan.habitatZones) {
      assertEvidence(course, zone);
      assertExactT1(zone);
      assertCardinallyConnected(zone.occupancy);
      expect(zone.ownerId).toBe(zone.id);
      expect(zone.area).toBe(zone.bounds.width * zone.bounds.height);
    }
    expect(course).toEqual(before);
    expect(plan.obstacleHash).toBe(hashCanonicalValue(course.obstacles));
  });

  it("emits no habitat when a course has no real ecological evidence", () => {
    const course = baseCourse();
    const plan = deriveCourseSceneComposition({ course, seed: 1 });
    expect(plan.habitatZones).toEqual([]);
    expect(plan.rejectedCandidates).toEqual([]);
    expect(plan.holeEnvelopes).toEqual([]);
    expect(plan.landmarks).toEqual([]);
  });

  it("keeps every zone evidence-homogeneous and enforces diagonal one-cell gaps", () => {
    const course = evidenceCourse();
    const plan = deriveCourseSceneComposition({ course, seed: 1202 });
    expect(new Set(plan.habitatZones.map((zone) => zone.family))).toEqual(new Set([
      "woodland_floor", "rock_leaf_transition", "meadow_deep_rough_margin", "wet_shore",
    ]));
    for (const zone of plan.habitatZones) assertEvidence(course, zone);
    assertChebyshevGap(plan);
    expect(plan.exclusions.interZoneGapCells).toBe(1);
    expect(plan.exclusions.interZoneGapMetric).toBe("chebyshev");
  });

  it("chooses a tree family's documented grove-level rule independently of seed or obstacle order", () => {
    const course = baseCourse();
    course.obstacles = [{ x: 9, y: 8, type: "tree" }, { x: 10, y: 8, type: "tree" }];
    for (const seed of [-7, 0, 91]) {
      const plan = deriveCourseSceneComposition({ course: {
        ...course,
        obstacles: seed === 0 ? course.obstacles.slice().reverse() : course.obstacles,
      }, seed });
      expect(plan.habitatZones.length).toBeGreaterThan(0);
      expect(plan.habitatZones.every((zone) => zone.family === "understory_edge"
        && zone.evidence.kind === "tree_grove"
        && zone.evidence.rule.includes("without a complete 2x2 tree core"))).toBe(true);
    }
  });

  it("publishes complete static exclusion ownership and dynamic render suppression", () => {
    const course = createM23CourseSetupReferenceCourse();
    const plan = deriveCourseSceneComposition({ course, seed: 1202 });
    for (const geometry of [
      plan.exclusions.maintainedTerrain,
      plan.exclusions.routedCorridor,
      plan.exclusions.authoredMarkers,
      plan.exclusions.obstacles,
      plan.exclusions.buildings,
    ]) expectGeometryExpanded(course, geometry);
    expect(plan.exclusions.authoredMarkers.owners[0].sourcePoints).toHaveLength(6);
    expect(plan.exclusions.obstacles.owners).toHaveLength(course.obstacles.length);
    expect(plan.exclusions.buildings.owners).toHaveLength(course.buildings.length);
    const excluded = new Set([
      ...plan.exclusions.maintainedTerrain.cells,
      ...plan.exclusions.routedCorridor.cells,
      ...plan.exclusions.authoredMarkers.cells,
      ...plan.exclusions.obstacles.cells,
      ...plan.exclusions.buildings.cells,
    ]);
    expect(plan.habitatZones.flatMap((zone) => zone.occupancy).every((point) => !excluded.has(cell(course, point)))).toBe(true);
    expect(plan.exclusions.dynamicSuppression).toEqual({
      golfers: { radius: 2, metric: "chebyshev", policy: "suppress-at-render" },
      activeEditorPreview: { radius: 2, metric: "chebyshev", policy: "suppress-at-render" },
    });
    expect(plan.exclusions.treeAuthority).toBe("existing-obstacles-only");
  });

  it("keeps A/B/C ownership stable while active setup landmarks follow the selected setup", () => {
    const source = createM23CourseSetupReferenceCourse();
    const plans = (["A", "B", "C"] as const).map((rotation) => {
      const course = courseForCourseSetup(source, "member", rotation);
      return { rotation, course, plan: deriveCourseSceneComposition({ course, seed: 1202 }) };
    });
    const first = plans[0].plan;
    for (const { course, plan } of plans) {
      expect(plan.courseHash).toBe(first.courseHash);
      expect(plan.habitatZones.map((zone) => ({ id: zone.id, occupancy: zone.occupancy })))
        .toEqual(first.habitatZones.map((zone) => ({ id: zone.id, occupancy: zone.occupancy })));
      expect(plan.exclusions.authoredMarkers).toEqual(first.exclusions.authoredMarkers);
      expect(plan.exclusions.routedCorridor).toEqual(first.exclusions.routedCorridor);
      expect(plan.landmarks.find((landmark) => landmark.kind === "active_tee")?.point).toEqual(course.holes[0].tee);
      expect(plan.landmarks.find((landmark) => landmark.kind === "active_green")?.point).toEqual(course.holes[0].green);
      expect(plan.holeEnvelopes[0].markers).toHaveLength(6);
    }
    expect(new Set(plans.map(({ plan }) => pointKey(plan.landmarks.find((landmark) => landmark.kind === "active_green")!.point))).size).toBe(3);
  });

  it("is view-independent and retains semantic geometry in the canonical course hash", () => {
    const course = createParklandVisualReferenceCourse();
    const normal = deriveCourseSceneComposition({ course, seed: 1202 });
    const selectorOnly = deriveCourseSceneComposition({ course: { ...course, activePinRotation: "C" }, seed: 1202 });
    expect(selectorOnly).toEqual(normal);
    expect(JSON.stringify(normal)).not.toContain("depthBand");
    expect(JSON.stringify(normal)).not.toContain("rotation");

    const changed = structuredClone(course);
    changed.holes[0].green = { x: changed.holes[0].green!.x - 1, y: changed.holes[0].green!.y };
    expect(deriveCourseSceneComposition({ course: changed, seed: 1202 }).courseHash).not.toBe(normal.courseHash);
  });

  it("selects hazards by route-segment distance inside each envelope and disambiguates duplicate IDs", () => {
    const course = baseCourse(20, 14);
    course.holes = [
      { id: "duplicate", tee: { x: 1, y: 5 }, green: { x: 18, y: 5 }, parMode: "AUTO" },
      { id: "duplicate", tee: { x: 1, y: 11 }, green: { x: 18, y: 11 }, parMode: "AUTO" },
    ];
    course.tiles[6 * course.width + 10] = "water";
    course.tiles[7 * course.width + 1] = "water";
    const plan = deriveCourseSceneComposition({ course, seed: 0 });
    expect(plan.holeEnvelopes.map((envelope) => envelope.holeId)).toEqual(["duplicate", "duplicate@2"]);
    expect(plan.landmarks.find((landmark) => landmark.id === "landmark:duplicate:strategic-hazard")?.point)
      .toEqual({ x: 10, y: 6 });
  });

  it("preserves every duplicate authored marker record while de-duplicating exclusion geometry", () => {
    const course = baseCourse();
    const tee = { x: 2, y: 5 };
    const pin = { x: 17, y: 5 };
    course.holes = [{
      tee,
      green: pin,
      teeBoxes: { forward: tee, member: tee, championship: tee },
      pinPositions: { A: pin, B: pin, C: pin },
      parMode: "AUTO",
    }];
    const plan = deriveCourseSceneComposition({ course, seed: 2 });
    expect(plan.holeEnvelopes[0].markers).toHaveLength(6);
    expect(new Set(plan.holeEnvelopes[0].markers.map((marker) => marker.id)).size).toBe(6);
    expect(plan.exclusions.authoredMarkers.owners[0].sourcePoints).toEqual([tee, pin]);
  });

  it("preserves coordinate-colliding marker records from distinct semantic kinds", () => {
    const course = baseCourse();
    course.holes = [{
      tee: { x: 2, y: 2 },
      green: { x: 10, y: 10 },
      pinPositions: {
        A: { x: 2, y: 2 },
        B: { x: 10, y: 9 },
        C: { x: 10, y: 10 },
      },
      parMode: "AUTO",
    }];
    const plan = deriveCourseSceneComposition({ course, seed: 1 });
    const markers = plan.holeEnvelopes[0].markers;
    expect(markers.map((marker) => marker.id)).toContain("hole-1:tee:legacy");
    expect(markers.map((marker) => marker.id)).toContain("hole-1:pin:A");
    expect(markers.find((marker) => marker.id === "hole-1:tee:legacy")?.point)
      .toEqual(markers.find((marker) => marker.id === "hole-1:pin:A")?.point);
    expect(new Set(markers.map((marker) => marker.id)).size).toBe(markers.length);
    expect(plan.exclusions.authoredMarkers.owners[0].sourcePoints).toHaveLength(3);
  });

  it("skips unsupported candidates transactionally and propagates real atlas corruption", () => {
    const course = evidenceCourse();
    let calls = 0;
    const unsupported = deriveCourseSceneComposition({
      course,
      seed: 1202,
      topologyResolver: (_request: HabitatFieldTopologyRequest) => {
        calls += 1;
        return { ok: false, diagnostics: [{ code: "unsupported_topology", message: "injected unsupported candidate" }] };
      },
    });
    expect(calls).toBeGreaterThan(0);
    expect(unsupported.habitatZones).toEqual([]);
    expect(unsupported.rejectedCandidates.length).toBeGreaterThan(0);
    expect(unsupported.rejectedCandidates.every((candidate) => candidate.diagnostics[0]?.code === "unsupported_topology")).toBe(true);

    let malformedCalls = 0;
    const malformedCoverage = deriveCourseSceneComposition({
      course,
      seed: 1202,
      topologyResolver: (request) => {
        malformedCalls += 1;
        const result = resolveHabitatFieldTopology(request);
        if (!result.ok || result.placements.length < 2) return result;
        return { ok: true, placements: [result.placements[0], ...result.placements.slice(0, -1)] };
      },
    });
    expect(malformedCalls).toBeGreaterThan(0);
    expect(malformedCoverage.habitatZones).toEqual([]);
    expect(malformedCoverage.rejectedCandidates.length).toBeGreaterThan(0);
    expect(malformedCoverage.rejectedCandidates.every((candidate) => candidate.diagnostics[0]?.message.includes("bijection"))).toBe(true);

    const corrupted = { ...HIGH_ATLAS, frameCount: HIGH_ATLAS.frameCount - 1 };
    const invalid = deriveCourseSceneComposition({ course, seed: 1202, atlas: corrupted });
    expect(invalid.habitatZones).toEqual([]);
    expect(invalid.rejectedCandidates).toHaveLength(1);
    expect(invalid.rejectedCandidates[0].diagnostics.some((diagnostic) => diagnostic.code === "invalid_atlas")).toBe(true);
  });

  it("is deterministic across 80 semantic seeds and retains exact placement/gap truth", () => {
    const course = createParklandVisualReferenceCourse();
    for (let seed = -40; seed < 40; seed += 1) {
      const first = deriveCourseSceneComposition({ course, seed });
      const second = deriveCourseSceneComposition({ course: structuredClone(course), seed });
      expect(second).toEqual(first);
      expect(new Set(first.habitatZones.map((zone) => zone.id)).size).toBe(first.habitatZones.length);
      for (const zone of first.habitatZones) {
        expect(zone.placements).toHaveLength(zone.occupancy.length);
        assertEvidence(course, zone);
      }
      assertChebyshevGap(first);
    }
  });

  it("handles 30x30 / 36-hole / 100-obstacle stress below 250 ms", () => {
    const course = stressCourse();
    const before = hashCanonicalValue(course);
    const start = performance.now();
    const plan = deriveCourseSceneComposition({ course, seed: 1202 });
    const elapsed = performance.now() - start;
    expect(plan.holeEnvelopes).toHaveLength(36);
    expect(plan.exclusions.obstacles.owners).toHaveLength(100);
    expect(elapsed).toBeLessThan(250);
    expect(hashCanonicalValue(course)).toBe(before);
  });

  it("canonicalizes obstacle ordering but changes hashes for semantic obstacle changes", () => {
    const course = evidenceCourse();
    const reordered = { ...course, obstacles: course.obstacles.slice().reverse() };
    const first = deriveCourseSceneComposition({ course, seed: 4 });
    const second = deriveCourseSceneComposition({ course: reordered, seed: 4 });
    expect(second.obstacleHash).toBe(first.obstacleHash);
    expect(second.courseHash).toBe(first.courseHash);
    expect(second.habitatZones).toEqual(first.habitatZones);
    const changed = { ...course, obstacles: course.obstacles.map((obstacle, index) => index === 0 ? { ...obstacle, x: obstacle.x + 1 } : obstacle) };
    expect(deriveCourseSceneComposition({ course: changed, seed: 4 }).obstacleHash).not.toBe(first.obstacleHash);
  });
});
