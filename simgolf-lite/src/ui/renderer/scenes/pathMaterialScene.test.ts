import { describe, expect, it } from "vitest";
import { buildContinuousPathPlan } from "../../../game/paths/continuousPathPlan";
import { sampleVisualHeight } from "../../../game/render/landscapeGeometry";
import { authoredPathFixture, continuousPathFixture } from "../../../game/testing/continuousPathFixtures";
import { buildPathMaterialScenePlan, continuousPathGroundHeight, pathMaterialLayerMesh, pathUnderlayForRenderer } from "./pathMaterialScene";

describe("continuous path material scene", () => {
  it.each(["low", "medium", "high"] as const)("uses the same accepted silhouette and underlay at %s", (quality) => {
    const course = continuousPathFixture("T"); const source = buildContinuousPathPlan(course); const plan = buildPathMaterialScenePlan(source, quality);
    expect(plan.mode).toBe("continuous"); expect(plan.roles).toEqual(["shoulder", "edge", "core"]); expect(plan.layers).toBe(source.layers);
    expect(plan.suppressWholeCellPaths).toBe(true); expect(plan.componentCount).toBe(1); expect(plan.triangleCount).toBeGreaterThan(0);
    const before = [...course.tiles]; const underlay = pathUnderlayForRenderer(course.tiles, plan);
    expect(underlay.every((terrain) => terrain !== "path")).toBe(true); expect(course.tiles).toEqual(before);
    for (let cell = 0; cell < before.length; cell++) if (before[cell] !== "path") expect(underlay[cell]).toBe(before[cell]);
    expect(plan.textureRoles).toEqual(quality === "low" ? [] : ["shoulder", "edge"]);
  });

  it.each(["straight", "diagonal", "bend", "T", "cross", "loop", "isolated", "broad"] as const)("projects final %s meshes through every rotation without retracing", (kind) => {
    const source = buildContinuousPathPlan(continuousPathFixture(kind)); const scene = buildPathMaterialScenePlan(source, "high");
    for (const layer of scene.layers) {
      const identity = pathMaterialLayerMesh(layer, (point) => point);
      for (const angle of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
        const rotated = pathMaterialLayerMesh(layer, (point) => ({ x: Math.cos(angle) * point.x - Math.sin(angle) * point.y, y: Math.sin(angle) * point.x + Math.cos(angle) * point.y }));
        expect([...rotated.uvs]).toEqual([...identity.uvs]); expect([...rotated.indices]).toEqual(layer.indices);
        expect(rotated.positions.length).toBe(layer.positions.length); expect(rotated.positions.every(Number.isFinite)).toBe(true);
      }
    }
  });

  it("preserves saved S-curve geometry, widths and non-path hazard underlay", () => {
    const course = authoredPathFixture(); course.tiles[0] = "water"; const source = buildContinuousPathPlan(course);
    const scene = buildPathMaterialScenePlan(source, "low"); const underlay = pathUnderlayForRenderer(course.tiles, scene);
    expect(scene.layers).toBe(source.layers); expect(scene.widths.minimum).toBeCloseTo(.9); expect(scene.widths.maximum).toBeCloseTo(.9); expect(underlay[0]).toBe("water");
    expect(scene.underlay.flatMap((group) => group.cells).sort((a, b) => a - b)).toEqual(source.coverage);
  });

  it("retains legacy whole-cell input until all replacement role meshes are valid", () => {
    const course = continuousPathFixture("straight"); const source = buildContinuousPathPlan(course);
    const broken = { ...source, layers: source.layers.filter((layer) => layer.role !== "core") }; const plan = buildPathMaterialScenePlan(broken, "high");
    expect(plan.mode).toBe("legacy"); expect(plan.suppressWholeCellPaths).toBe(false); expect(plan.layers).toEqual([]); expect(pathUnderlayForRenderer(course.tiles, plan)).toBe(course.tiles);
  });

  it("keeps macro relief UVs in course space on the exact path core", () => {
    const plan = buildContinuousPathPlan(continuousPathFixture("straight")); const layer = plan.layers.find((entry) => entry.role === "core")!;
    const mesh = pathMaterialLayerMesh(layer, (point) => ({ x: point.x * 2, y: point.y * 3 }), { x: 16, y: 32 });
    expect([...mesh.indices]).toEqual(layer.indices);
    for (let i = 0; i < layer.positions.length; i += 2) { expect(mesh.uvs[i]).toBeCloseTo(layer.positions[i] / 16); expect(mesh.uvs[i + 1]).toBeCloseTo(layer.positions[i + 1] / 32); }
  });

  it("accepts a clipped-away edge role without restoring whole-cell diamonds", () => {
    const course = continuousPathFixture("straight"); const source = buildContinuousPathPlan(course);
    const clipped = { ...source, layers: source.layers.map((layer) => layer.role === "edge" ? { ...layer, positions: [], indices: [], rings: [] } : layer) };
    const plan = buildPathMaterialScenePlan(clipped, "low"); expect(plan.mode).toBe("continuous"); expect(pathUnderlayForRenderer(course.tiles, plan).includes("path")).toBe(false);
  });

  it("grounds fractional Low actors on the exact sloped ribbon sampler while preserving other Low terrain", () => {
    const course = continuousPathFixture("straight"); const source = buildContinuousPathPlan(course); const scene = buildPathMaterialScenePlan(source, "low");
    const field = { width: 16, height: 16, vertices: Float32Array.from({ length: 17 * 17 }, (_, cell) => (cell % 17) * .2 + Math.floor(cell / 17) * .1) };
    const sample = (x: number, y: number) => sampleVisualHeight(field, x, y); const core = source.layers.find((layer) => layer.role === "core")!;
    const mesh = pathMaterialLayerMesh(core, (point) => ({ x: point.x, y: sample(point.x, point.y) }));
    for (let i = 0; i < core.positions.length; i += 2) expect(continuousPathGroundHeight(scene, course.tiles, 16, 16, core.positions[i], core.positions[i + 1], sample)).toBeCloseTo(mesh.positions[i + 1], 6);
    expect(continuousPathGroundHeight(scene, course.tiles, 16, 16, 2, 4.5, sample)).toBeCloseTo(sample(2, 4.5));
    expect(continuousPathGroundHeight(scene, course.tiles, 16, 16, 4.25, 4.5, sample)).toBeGreaterThan(.5);
    expect(continuousPathGroundHeight(scene, course.tiles, 16, 16, 1.5, 1.5, sample)).toBeNull();
    expect(continuousPathGroundHeight({ suppressWholeCellPaths: false }, course.tiles, 16, 16, 4.25, 4.5, sample)).toBeNull();
  });

  it("keeps no-path terrain input stable", () => {
    const course = continuousPathFixture("empty"); const scene = buildPathMaterialScenePlan(buildContinuousPathPlan(course), "low");
    expect(scene.componentCount).toBe(0); expect(scene.triangleCount).toBe(0); expect(pathUnderlayForRenderer(course.tiles, scene)).toBe(course.tiles);
  });
});
