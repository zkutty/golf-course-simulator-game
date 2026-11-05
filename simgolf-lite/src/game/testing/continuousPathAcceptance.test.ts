import { describe, expect, it, vi } from "vitest";
import type * as PIXI from "pixi.js";
import { DEFAULT_COURSE, DEFAULT_WORLD } from "../models/defaults";
import type { Course, Point } from "../models/types";
import { authoredPathFixture, continuousPathFixture } from "./continuousPathFixtures";
import { buildContinuousPathPlan, classifyContinuousPathPoint, PATH_WIDTH_PRESETS } from "../paths/continuousPathPlan";
import { createSurfacePathPreviewResolver, type RenderSnapshot, type SurfaceEditorRenderSnapshot } from "../render/renderSnapshot";
import { createPathPreviewMeasurement, pathPreviewTelemetrySnapshot, resetPathPreviewTelemetry } from "../render/pathPreviewTelemetry";
import { m35TelemetrySnapshot, resetM35Telemetry } from "../render/m35Telemetry";
import { planTimedMobilityLeg } from "../m51/travelRouter";
import { buildArchitectureMobilityOverlay } from "../m51/architectureOverlay";
import { activeWeather } from "../seasons/seasons";
import { buildPathMaterialScenePlan, pathMaterialLayerMesh, pathUnderlayForRenderer } from "../../ui/renderer/scenes/pathMaterialScene";
import { createSurfaceEditorSceneSystem, surfacePathPreviewPolygons } from "../../ui/renderer/scenes/surfaceEditorScene";

const producer = vi.hoisted(() => ({ builds: 0, ringReads: 0 }));

// Deliberately fails on a spread, eager serialization, or real ring consumer.
// Mock the canonical producer, including the producer imported by M3 itself.
vi.mock("../paths/continuousPathPlan", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../paths/continuousPathPlan")>();
  return {
    ...actual,
    buildContinuousPathPlan(input: Parameters<typeof actual.buildContinuousPathPlan>[0]) {
      const plan = actual.buildContinuousPathPlan(input);
      producer.builds++;
      for (const layer of plan.layers) Object.defineProperty(layer, "rings", {
        enumerable: true,
        get() { producer.ringReads++; throw new Error(`Q-U: unexpected ${layer.role}.rings consumption`); },
      });
      return plan;
    },
  };
});

function fullCourse(input = authoredPathFixture()): Course {
  return { ...DEFAULT_COURSE, ...input, estate: undefined, property: undefined,
    elevations: Array<number>(input.width * input.height).fill(0),
    holes: [], buildings: [], obstacles: [], decorations: [] };
}

function fakeScene() {
  const owned = { parent: null, destroyed: false } as unknown as PIXI.Graphics;
  const operations = new Map<string, ReturnType<typeof vi.fn>>();
  for (const method of ["clear", "poly", "cut", "fill", "stroke", "circle", "moveTo", "lineTo", "destroy"] as const) {
    const action = vi.fn(() => owned); operations.set(method, action);
    Object.assign(owned, { [method]: action });
  }
  const layer = { addChild: vi.fn(() => owned), removeChild: vi.fn() } as unknown as PIXI.Container;
  return { owned, layer, operations };
}

function sceneState(course: Course, plan: ReturnType<typeof buildContinuousPathPlan>): SurfaceEditorRenderSnapshot {
  return { width: course.width, height: course.height, tiles: course.tiles,
    elevations: course.elevations, editorMode: "PAINT", showGridOverlays: false,
    graphicsQuality: "high", colorVision: "standard", terrainTool: "curve",
    splineDraft: [], splineHover: null, selectedFeature: null, selectedNode: null,
    pathPreview: plan, pathPreviewCoverage: plan.coverage, pathPreviewAffordable: true,
    rotation: 0, surfaceHeightAt: () => 0 };
}

describe("P714 actual triangle consumers with a throwing rings getter", () => {
  it.each(["straight", "diagonal", "bend", "T", "cross", "loop", "corner"] as const)("R1 and classifier consume %s triangles without demanding rings", (kind) => {
    const course = fullCourse(continuousPathFixture(kind));
    const plan = buildContinuousPathPlan(course);
    expect(() => plan.layers[0].rings).toThrow("unexpected shoulder.rings");
    const expectedReads = producer.ringReads;
    expect(plan.layers.every(layer => layer.indices.length > 0)).toBe(true);
    for (const quality of ["low", "medium", "high"] as const) {
      const scene = buildPathMaterialScenePlan(plan, quality);
      expect(scene.mode).toBe("continuous");
      expect(scene.roles).toEqual(["shoulder", "edge", "core"]);
      expect(pathUnderlayForRenderer(course.tiles, scene).includes("path")).toBe(false);
      for (const layer of scene.layers) {
        const mesh = pathMaterialLayerMesh(layer, ({ x, y }) => ({ x: 32 * (x - y), y: 16 * (x + y) }));
        expect(mesh.indices.length).toBe(layer.indices.length);
        expect([...mesh.positions].every(Number.isFinite)).toBe(true);
        for (let i = 0; i < layer.indices.length; i += 3) {
          const vertices = layer.indices.slice(i, i + 3);
          const center = { x: vertices.reduce((sum, n) => sum + layer.positions[n * 2], 0) / 3,
            y: vertices.reduce((sum, n) => sum + layer.positions[n * 2 + 1], 0) / 3 };
          expect(classifyContinuousPathPoint(plan, center)).not.toBeNull();
          expect(course.tiles[Math.floor(center.y) * course.width + Math.floor(center.x)]).toBe("path");
        }
      }
    }
    if (kind === "loop") expect(classifyContinuousPathPoint(plan, { x: 7.5, y: 7.5 })).toBeNull();
    // A corner touch remains two components; this test cannot certify a join.
    if (kind === "corner") expect(buildPathMaterialScenePlan(plan, "high").componentCount).toBe(2);
    expect(producer.ringReads).toBe(expectedReads);
  });

  it("R2 resolver and actual R3 completed scene draw stay lazy across camera and quality updates", () => {
    resetM35Telemetry(); resetPathPreviewTelemetry();
    const reads = producer.ringReads;
    const course = fullCourse(); const measure = createPathPreviewMeasurement();
    let clock = 0; const now = () => ++clock;
    const build = vi.fn(buildContinuousPathPlan);
    const resolve = createSurfacePathPreviewResolver(build, measure.observe, now);
    const plan = resolve(course)!;
    const receipt = measure.receipt(3)!;
    const fake = fakeScene();
    const scene = createSurfaceEditorSceneSystem(fake.layer, () => fake.owned, now);
    const state = { ...sceneState(course, plan), pathPreviewReceipt: receipt };
    const snap = (surfaceEditor: SurfaceEditorRenderSnapshot) => ({ surfaceEditor } as RenderSnapshot);
    const affected = course.surfaceIntent!.features[0].coverage.slice(0, 2);
    const polygons = surfacePathPreviewPolygons(plan, affected, course.width, course.height);
    expect(polygons.length).toBeGreaterThan(0);
    for (const polygon of polygons) {
      expect(polygon.every(point => affected.some(cell => point.x >= cell % course.width - 1e-9
        && point.x <= cell % course.width + 1 + 1e-9
        && point.y >= Math.floor(cell / course.width) - 1e-9
        && point.y <= Math.floor(cell / course.width) + 1 + 1e-9))).toBe(true);
    }
    scene.create?.(snap(state));
    expect(fake.operations.get("poly")!.mock.calls.length).toBeGreaterThan(0);
    expect(pathPreviewTelemetrySnapshot()).toMatchObject({ buildCount: 1, completedCount: 1, failedBuildCount: 0 });
    expect(pathPreviewTelemetrySnapshot().samples[0]).toMatchObject({ key: plan.key, quoteMs: 3 });
    expect(m35TelemetrySnapshot().surfacePreview.count).toBe(1);
    for (let i = 0; i < 20; i++) {
      expect(resolve({ ...course, tiles: [...course.tiles] })).toBe(plan);
      scene.update?.(snap({ ...state, rotation: i % 2 ? 90 : 0, graphicsQuality: i % 2 ? "low" : "high" }));
    }
    expect(build).toHaveBeenCalledTimes(1);
    expect(pathPreviewTelemetrySnapshot().completedCount).toBe(1);
    scene.destroy?.();
    expect(producer.ringReads).toBe(reads);
  });

  it.each(["walk", "pushcart", "riding_cart"] as const)("actual M3 %s search and presentation never demand rings", (mode) => {
    const builds = producer.builds, reads = producer.ringReads;
    const course = fullCourse();
    course.tiles = course.tiles.map(tile => tile === "path" ? tile : "water");
    const input = { course, courseId: "course-primary", layoutId: "course-primary", mode,
      from: { x: 2, y: 3 }, to: { x: 13, y: 5 }, allowWalkFallback: false } as const;
    const original = JSON.stringify(course);
    const leg = planTimedMobilityLeg(input)!;
    expect(leg).not.toBeNull();
    expect(leg.pathAlignment).toMatchObject({ alignedRuns: 1, fallbackRuns: 0 });
    const baseline = planTimedMobilityLeg({ ...input, course: { ...course, surfaceIntent: undefined } })!;
    for (const field of ["cells", "cost", "minutes", "expansions", "requestedMode", "resolvedMode", "fallback"] as const) {
      expect(leg[field]).toEqual(baseline[field]);
    }
    expect(leg.waypoints.at(-1)).toEqual(input.to);
    expect(JSON.stringify(course)).toBe(original);
    expect(producer.builds).toBeGreaterThan(builds);
    expect(producer.ringReads).toBe(reads);
  });

  it.each(PATH_WIDTH_PRESETS)("actual $id preset keeps its core/edge/shoulder cross-section without rings", ({ envelopeWidth }) => {
    const reads = producer.ringReads;
    const course = fullCourse(authoredPathFixture([{ x: 2.5, y: 4.5 }, { x: 12.5, y: 4.5 }], envelopeWidth));
    const plan = buildContinuousPathPlan(course), visibleWidth = envelopeWidth * .6;
    expect(plan.edges).toHaveLength(1);
    expect(plan.edges[0].width).toBeCloseTo(visibleWidth, 12);
    expect(classifyContinuousPathPoint(plan, { x: 7.5, y: 4.5 + .32 * visibleWidth })).toBe("core");
    expect(classifyContinuousPathPoint(plan, { x: 7.5, y: 4.5 + .40 * visibleWidth })).toBe("edge");
    expect(classifyContinuousPathPoint(plan, { x: 7.5, y: 4.5 + .47 * visibleWidth })).toBe("shoulder");
    expect(classifyContinuousPathPoint(plan, { x: 7.5, y: 4.5 + .55 * visibleWidth })).toBeNull();
    const scene = buildPathMaterialScenePlan(plan, "high");
    expect(scene.widths.minimum).toBeCloseTo(visibleWidth, 12);
    expect(scene.widths.maximum).toBeCloseTo(visibleWidth, 12);
    expect(producer.ringReads).toBe(reads);
  });

  it("actual saved geometry and clipped preview cannot bridge an uncharged coverage gap", () => {
    const reads = producer.ringReads;
    const course = fullCourse(authoredPathFixture([{ x: 2.5, y: 4.5 }, { x: 12.5, y: 4.5 }], 1.5));
    for (let y = 0; y < course.height; y++) course.tiles[y * course.width + 7] = "rough";
    const plan = buildContinuousPathPlan(course);
    expect(plan.diagnostics.clippedBreakCount).toBeGreaterThan(0);
    expect(buildPathMaterialScenePlan(plan, "high").componentCount).toBe(2);
    expect(classifyContinuousPathPoint(plan, { x: 7.5, y: 4.5 })).toBeNull();
    for (const layer of plan.layers) for (let i = 0; i < layer.indices.length; i += 3) {
      const xs = layer.indices.slice(i, i + 3).map(vertex => layer.positions[vertex * 2]);
      expect(Math.max(...xs) <= 7 + 1e-8 || Math.min(...xs) >= 8 - 1e-8).toBe(true);
    }
    const affected = plan.coverage.filter(cell => cell % course.width <= 6);
    const polygons = surfacePathPreviewPolygons(plan, affected, course.width, course.height);
    expect(polygons.length).toBeGreaterThan(0);
    expect(polygons.every(polygon => polygon.every(point => point.x <= 7 + 1e-8))).toBe(true);
    expect(producer.ringReads).toBe(reads);
  });

  it("actual architecture mobility traces use G coordinates while utilization retains original route cells", () => {
    const course = fullCourse();
    course.tiles = course.tiles.map(tile => tile === "path" ? tile : "water");
    const from = { x: 2, y: 3 }, to = { x: 13, y: 5 };
    course.holes = [{ id: "saved-S", tee: from, green: to, parMode: "AUTO" }];
    const world = { ...DEFAULT_WORLD, runSeed: 714 };
    const original = JSON.stringify({ course, world });
    const plan = buildContinuousPathPlan(course);
    const beforeBuilds = producer.builds, reads = producer.ringReads;
    const modes = ["pushcart", "riding_cart", "walk"] as const;
    const overlay = buildArchitectureMobilityOverlay({ course, world, courseId: "course-primary", modes: [...modes] });
    expect(producer.builds).toBeGreaterThan(beforeBuilds);
    expect(overlay.mobility).toMatchObject({ evidence: "predicted", modes: [...modes], transfers: 0,
      inaccessibleDestinations: [], missingLinkWarnings: [] });
    const daily = activeWeather(world, course, 0);
    const conditions = { weather: overlay.mobility.weather, cartPathOnly: overlay.mobility.weather !== "dry",
      restrictionId: `${overlay.mobility.weather === "dry" ? "dry" : daily.kind}:${daily.absoluteDay}` };
    const expectedTraces: typeof overlay.render.traces = [];
    const counts = new Map<string, { id: string; x: number; y: number; value: number; current: boolean }>();
    for (const mode of modes) {
      const leg = planTimedMobilityLeg({ course, courseId: "course-primary", layoutId: "course-primary", mode,
        from, to, conditions, allowWalkFallback: false })!;
      expect(leg).not.toBeNull();
      expect(leg.pathAlignment).toMatchObject({ alignedRuns: 1, fallbackRuns: 0 });
      for (let index = 0; index < leg.waypoints.length; index++) {
        const start = index === 0 ? from : leg.waypoints[index - 1], end = leg.waypoints[index];
        if (start.x === end.x && start.y === end.y) continue;
        expectedTraces.push({ id: `saved-S:hole:${mode}:${index}`,
          from: start, to: end, current: true, emphasized: false });
      }
      for (const point of leg.cells) {
        const key = `${point.x}:${point.y}`, previous = counts.get(key);
        if (previous) previous.value++;
        else counts.set(key, { id: `mobility-${key}`, x: point.x, y: point.y, value: 1, current: true });
      }
    }
    expect(expectedTraces.length).toBeGreaterThan(0);
    expect(expectedTraces.length, "all three complete S chains must fit without trace striding").toBeLessThanOrEqual(320);
    expect(overlay.render.traces).toEqual(expectedTraces);
    for (const mode of modes) {
      const chain = overlay.render.traces.filter(trace => trace.id.startsWith(`saved-S:hole:${mode}:`));
      expect(chain.length).toBeGreaterThan(0);
      expect(chain[0].from).toEqual(from);
      expect(chain.at(-1)!.to).toEqual(to);
      for (let index = 0; index < chain.length; index++) {
        expect(chain[index].from).not.toEqual(chain[index].to);
        if (index > 0) expect(chain[index].from).toEqual(chain[index - 1].to);
      }
    }
    const authoritative = [...counts.values()].sort((a, b) => b.value - a.value || a.id.localeCompare(b.id));
    expect(authoritative.length).toBeLessThan(180); // No cell striding in this bounded fixture.
    expect(overlay.render.cells).toEqual(authoritative);
    expect(overlay.mobility.pathUtilization).toBe(authoritative.reduce((sum, cell) => sum + cell.value, 0));
    const distanceToG = (point: Point) => Math.min(...plan.edges.flatMap(edge => edge.points.slice(1).map((b, index) => {
      const a = edge.points[index], dx = b.x - a.x, dy = b.y - a.y;
      const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
      return Math.hypot(point.x - a.x - dx * t, point.y - a.y - dy * t);
    })));
    for (const trace of overlay.render.traces) for (const fraction of [0, .5, 1]) {
      expect(distanceToG({ x: trace.from.x + (trace.to.x - trace.from.x) * fraction + .5,
        y: trace.from.y + (trace.to.y - trace.from.y) * fraction + .5 })).toBeLessThan(1e-7);
    }
    expect(overlay.render.cells.every(cell => Number.isInteger(cell.x) && Number.isInteger(cell.y))).toBe(true);
    expect(overlay.render.traces.some(trace => !Number.isInteger(trace.to.x) || !Number.isInteger(trace.to.y))).toBe(true);
    expect(JSON.stringify({ course, world })).toBe(original);
    expect(producer.ringReads).toBe(reads);
    // Complete endpoint chains are certified only for this under-budget fixture.
    // Forecasts exceeding320 traces or180 cells still expose strided fragments.
  });

  it("actual architecture overlay distinguishes cart prohibition from an unreachable walking network", () => {
    const reads = producer.ringReads;
    const course = fullCourse();
    course.tiles = course.tiles.map(tile => tile === "path" ? tile : "water");
    course.holes = [{ id: "saved-S", tee: { x: 2, y: 3 }, green: { x: 13, y: 5 }, parMode: "AUTO" }];
    course.tiles[5 * course.width + 13] = "green";
    const prohibited = buildArchitectureMobilityOverlay({ course, world: DEFAULT_WORLD, courseId: "course-primary", modes: ["riding_cart"] });
    expect(prohibited.mobility.inaccessibleDestinations).toEqual([{ id: "saved-S:hole", mode: "riding_cart", reason: "prohibited" }]);
    expect(prohibited.mobility.missingLinkWarnings).toHaveLength(1);
    expect(prohibited.mobility.missingLinkWarnings[0]).toMatch(/riding_cart is prohibited.*terrain, slope, or/);
    expect(prohibited.render.traces).toEqual([]);
    for (let y = 0; y < course.height; y++) course.tiles[y * course.width + 7] = "water";
    const unreachable = buildArchitectureMobilityOverlay({ course, world: DEFAULT_WORLD, courseId: "course-primary", modes: ["riding_cart"] });
    expect(unreachable.mobility.inaccessibleDestinations).toEqual([{ id: "saved-S:hole", mode: "riding_cart", reason: "unreachable" }]);
    expect(unreachable.mobility.missingLinkWarnings).toEqual(["saved-S:hole is unreachable even on the authoritative walking network."]);
    expect(producer.ringReads).toBe(reads);
  });

});
