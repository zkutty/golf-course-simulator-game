import { describe, expect, it, vi } from "vitest";
import { buildContinuousPathPlan, classifyContinuousPathPoint } from "../../../game/paths/continuousPathPlan";
import { sampleVisualHeight } from "../../../game/render/landscapeGeometry";
import { authoredPathFixture, continuousPathFixture } from "../../../game/testing/continuousPathFixtures";
import { buildPathMaterialScenePlan, continuousPathGroundHeight, createContinuousPathContactSampler, pathMaterialLayerMesh, pathUnderlayForRenderer } from "./pathMaterialScene";

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

const corePlan = (positions: readonly number[], indices: readonly number[]) => ({
  suppressWholeCellPaths: true, layers: [{ role: "core" as const, positions, indices, rings: [] }],
});

describe("accepted core triangle contact lookup", () => {
  it.each([{ indices: [0, 1, 2] }, { indices: [2, 1, 0] }])("interpolates vertex heights instead of bilinear interior heights with winding $indices", ({ indices }) => {
    const height = createContinuousPathContactSampler(corePlan([0, 0, 1, 0, 1, 1], indices), 1, 1, (x, y) => 4 * x * y);
    expect(height(.75, .25)).toBe(1); // Bilinear sampling at this point is .75.
    expect(height(.25, .75)).toBeNull(); expect(height(0, 0)).toBe(0); expect(height(1, 1)).toBe(4);
    expect(height(.5, .5)).toBe(2);
  });

  it("retains affine planes at shared edges, subdivided seams and course borders", () => {
    const plan = corePlan([0, 0, 1, 0, 1, 1, 0, 1, 1, 0, 2, 0, 2, .5, 1, .5, 1, .5, 2, .5, 2, 1, 1, 1],
      [0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7, 8, 9, 10, 8, 10, 11]);
    const sample = (x: number, y: number) => 2 + x * .25 - y * .5;
    const lookup = createContinuousPathContactSampler(plan, 2, 1, sample);
    for (const [x, y] of [[0, 0], [2, 1], [1, 0], [1, .25], [1, .5], [1, .75], [1, 1], [1.5, .5], [.7, .4]]) expect(lookup(x, y)).toBeCloseTo(sample(x, y), 12);
  });

  it("keeps holes, outside points, disconnected corners and other material roles absent", () => {
    const plan = corePlan([0, 0, .4, 0, .4, .4, 1.6, 1.6, 2, 1.6, 2, 2], [0, 1, 2, 3, 4, 5]);
    const lookup = createContinuousPathContactSampler({ ...plan, layers: [...plan.layers, { ...plan.layers[0], role: "shoulder", positions: [0, 0, 2, 0, 2, 2] }] }, 2, 2, () => 3);
    expect(lookup(.3, .1)).toBe(3);
    for (const [x, y] of [[.8, .8], [1, 1], [1.5, 1.5], [-1e-6, 0], [2.000001, 2], [NaN, 0], [0, Infinity]]) expect(lookup(x, y)).toBeNull();
  });

  it("fails closed on disabled, absent, malformed, nonfinite and non-cell-clipped input", () => {
    const valid = corePlan([0, 0, 1, 0, 1, 1], [0, 1, 2]);
    const cases = [{ ...valid, suppressWholeCellPaths: false }, { ...valid, layers: [] }, corePlan([], []),
      corePlan([0, 0, 1], [0, 1, 2]), corePlan([0, 0, 1, 0, 1, 1], [0, 1]),
      corePlan([0, 0, 1, 0, 1, 1], [0, 1, 3]), corePlan([0, 0, 1, 0, 1, 1], [0, -1, 2]),
      corePlan([0, 0, 1, 0, 1, 1], [0, .5, 2]), corePlan([0, 0, Infinity, 0, 1, 1], [0, 1, 2]),
      corePlan([0, 0, 2, 0, 2, 1], [0, 1, 2])];
    for (const plan of cases) expect(createContinuousPathContactSampler(plan, 2, 2, () => 3)(.75, .25)).toBeNull();
    expect(createContinuousPathContactSampler(valid, 1, 1, () => NaN)(.75, .25)).toBeNull();
    expect(createContinuousPathContactSampler(valid, 1, 1, () => Infinity)(.75, .25)).toBeNull();
  });

  it("guards save dimensions before sampling/allocation and supports the inclusive 256 boundary", () => {
    const sample = vi.fn(() => 2), plan = corePlan([0, 0, 1, 0, 1, 1], [0, 1, 2]);
    for (const [width, height] of [[0, 1], [-1, 1], [1, 0], [1.5, 1], [NaN, 1], [Infinity, 1], [257, 1], [1, 257], [1e12, 1e12]]) {
      expect(createContinuousPathContactSampler(plan, width, height, sample)(.75, .25)).toBeNull();
    }
    expect(sample).not.toHaveBeenCalled();
    const boundary = createContinuousPathContactSampler(corePlan([255, 255, 256, 255, 256, 256], [0, 1, 2]), 256, 256, sample);
    expect(boundary(255.75, 255.25)).toBe(2); expect(boundary(256, 256)).toBe(2); expect(boundary(256, 255)).toBe(2);
    expect(boundary(256.000001, 255)).toBeNull();
  });

  it("skips degenerate triangles without losing real triangles and samples only on generation build", () => {
    const plan = corePlan([0, 0, 1, 0, 1, 1, 0, 0, .5, 0, 1, 0], [3, 4, 5, 0, 1, 2]);
    const a = vi.fn((x: number, y: number) => x + y), b = vi.fn((x: number, y: number) => 4 + x + y);
    const first = createContinuousPathContactSampler(plan, 1, 1, a), second = createContinuousPathContactSampler(plan, 1, 1, b);
    expect(a).toHaveBeenCalledTimes(6); expect(b).toHaveBeenCalledTimes(6);
    for (let i = 0; i < 5; i++) { expect(first(.75, .25)).toBe(1); expect(second(.75, .25)).toBe(5); }
    expect(a).toHaveBeenCalledTimes(6); expect(b).toHaveBeenCalledTimes(6);
    expect(createContinuousPathContactSampler(corePlan([0, 0, .5, 0, 1, 0], [0, 1, 2]), 1, 1, a)(.5, 0)).toBeNull();
  });

  it.each(["straight", "diagonal", "T", "cross", "loop", "broad", "S"] as const)("indexes actual %s G triangles without changing core coverage", (kind) => {
    const course = kind === "S" ? authoredPathFixture() : continuousPathFixture(kind);
    const plan = buildContinuousPathPlan(course), scene = buildPathMaterialScenePlan(plan, "low");
    const lookup = createContinuousPathContactSampler(scene, course.width, course.height, (x, y) => 3 + x * .125 + y * .25);
    const core = plan.layers.find(layer => layer.role === "core")!;
    for (let offset = 0; offset < core.indices.length; offset += 3) {
      let x = 0, y = 0;
      for (let i = 0; i < 3; i++) { const index = core.indices[offset + i] * 2; x += core.positions[index] / 3; y += core.positions[index + 1] / 3; }
      expect(lookup(x, y), `triangle ${offset / 3}`).toBeCloseTo(3 + x * .125 + y * .25, 9);
    }
    for (let y = .25; y < course.height; y += .5) for (let x = .25; x < course.width; x += .5) {
      const expectedCore = classifyContinuousPathPoint(plan, { x, y }) === "core";
      if (expectedCore) expect(lookup(x, y)).toBeCloseTo(3 + x * .125 + y * .25, 9);
      else expect(lookup(x, y)).toBeNull();
    }
  });
});


describe("CONTACT-QUERY original-offset seam precedence", () => {
  it.each([
    { name: "earlier right cell wins after the left cell is visited first", indices: [0, 1, 2, 3, 4, 5, 6, 7, 8], expected: .25 },
    { name: "earlier left cell wins when the right cell is visited later", indices: [3, 4, 5, 0, 1, 2, 6, 7, 8], expected: .125 },
  ])("$name", ({ indices, expected }) => {
    // Right edge endpoints have heights0/1, so y=.25 interpolates to.25.
    // The shorter left edge has heights0/.25, so its midpoint gives.125.
    // The disjoint last left-cell triangle also exercises cell-local stopping.
    const positions = [1, 0, 2, 0, 1, 1, 0, 0, 1, 0, 1, .5, 0, 0, .5, 0, 0, .5];
    const sample = vi.fn((x: number, y: number) => x * y * y);
    const lookup = createContinuousPathContactSampler(corePlan(positions, indices), 2, 1, sample);
    expect(sample).toHaveBeenCalledTimes(9);
    expect(lookup(1, .25)).toBe(expected);
    expect(lookup(.99, .25)).toBeCloseTo(.125, 12);
    expect(lookup(1.01, .25)).toBeCloseTo(.25, 12);
    expect(sample).toHaveBeenCalledTimes(9);
  });
});


describe("CONTACT-QUERY conservative triangle bounds", () => {
  it.each([
    { axis: "X", positions: [.25, .25, .75, .25, .75, .75], upper: [.75, .5], lower: [.25, .25], moveX: true },
    { axis: "Y", positions: [.25, .25, .25, .75, .75, .75], upper: [.5, .75], lower: [.25, .25], moveX: false },
  ])("preserves existing barycentric tolerance at both $axis bounds", ({ positions, upper, lower, moveX }) => {
    const height = createContinuousPathContactSampler(corePlan(positions, [0, 1, 2]), 2, 2, (x, y) => x + y);
    const offset = (point: number[], delta: number): [number, number] => [point[0] + (moveX ? delta : 0), point[1] + (moveX ? 0 : delta)];
    // A half-cell triangle gives a negative weight of only -4e-10 at this offset.
    // The farther offset gives -4e-8 and must remain outside.
    for (const [point, direction] of [[upper, 1], [lower, -1]] as const) {
      const near = offset(point, direction * 2e-10), outside = offset(point, direction * 2e-8);
      expect(height(...near)).toBeCloseTo(near[0] + near[1], 14);
      expect(height(...outside)).toBeNull();
    }
  });
});
