import { describe, expect, it } from "vitest";
import * as PIXI from "pixi.js";
import { OrderedMeshBoundsCohort } from "./orderedMeshBounds";
import { knownRootStageViewport, scanFullGeometryExtent } from "./rootStageViewport";

function appWithCanvas(width = 800, height = 600) {
  const app = new PIXI.Application();
  const canvas = { width, height };
  const source = { resource: canvas, resolution: 1, _resolution: 1,
    pixelWidth: width, pixelHeight: height };
  const texture = { source, frame: { x: 0, y: 0, width, height } };
  const target = { isRoot: true, colorTexture: source, resolution: 1, pixelWidth: width, pixelHeight: height };
  const renderer = Object.create(PIXI.WebGLRenderer.prototype) as PIXI.WebGLRenderer;
  const pipe = Object.assign(Object.create(PIXI.MeshPipe.prototype), {
    renderer, _adaptor: Object.create(PIXI.GlMeshAdaptor.prototype),
  });
  Object.assign(renderer, {
    type: PIXI.RendererType.WEBGL,
    view: Object.assign(Object.create(PIXI.ViewSystem.prototype), {
      canvas, texture, renderTarget: target, screen: { x: 0, y: 0, width, height },
    }),
    renderGroup: Object.create(PIXI.RenderGroupSystem.prototype),
    renderTarget: Object.create(PIXI.RenderTargetSystem.prototype),
    globalUniforms: Object.create(PIXI.GlobalUniformSystem.prototype),
    renderPipes: { mesh: pipe },
    _roundPixels: 0,
    gl: { VERTEX_SHADER: 35633, HIGH_FLOAT: 36338,
      getShaderPrecisionFormat: () => ({ precision: 23, rangeMin: 127, rangeMax: 127 }) },
  });
  (app as unknown as { renderer: PIXI.WebGLRenderer }).renderer = renderer;
  const world = new PIXI.Container();
  const layer = new PIXI.Container();
  app.stage.addChild(world);
  world.addChild(layer);
  return { app, world, layer };
}

function turfMesh(xs: readonly number[]): PIXI.Mesh<PIXI.MeshGeometry> {
  const positions: number[] = [];
  const indices: number[] = [];
  for (const x of xs) {
    for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
      const left = x + dx * 0.25;
      const top = dy * 0.25;
      const vertex = positions.length / 2;
      positions.push(left, top, left + 0.25, top, left + 0.25, top + 0.25, left, top + 0.25);
      indices.push(vertex, vertex + 1, vertex + 2, vertex, vertex + 2, vertex + 3);
    }
  }
  const geometry = new PIXI.MeshGeometry({ positions: new Float32Array(positions), indices: new Uint32Array(indices) });
  geometry.batchMode = "no-batch";
  return new PIXI.Mesh({ geometry });
}

function gridMesh(columns: number, rows: number, spacing = 1_000): PIXI.Mesh<PIXI.MeshGeometry> {
  const positions: number[] = [];
  const indices: number[] = [];
  for (let y = 0; y <= rows; y++) for (let x = 0; x <= columns; x++) {
    positions.push(x * spacing, y * spacing);
  }
  for (let y = 0; y < rows; y++) for (let x = 0; x < columns; x++) {
    const tl = y * (columns + 1) + x;
    const bl = tl + columns + 1;
    indices.push(tl, tl + 1, bl + 1, tl, bl + 1, bl);
  }
  const geometry = new PIXI.MeshGeometry({ positions: new Float32Array(positions), indices: new Uint32Array(indices) });
  geometry.batchMode = "no-batch";
  return new PIXI.Mesh({ geometry });
}

describe("ordered original-index bounds", () => {
  it("keeps remote-gap turf units in original triangle order, then restores all visible", () => {
    const { app, world, layer } = appWithCanvas();
    const mesh = turfMesh([0, 1_000, 10]);
    layer.addChild(mesh);
    const original = mesh.geometry.indices;
    const originalPositions = mesh.geometry.positions;
    const originalUvs = mesh.geometry.uvs;
    const positionBits = new Uint32Array(originalPositions.buffer.slice(0));
    const uvBits = new Uint32Array(originalUvs.buffer.slice(0));
    const cohort = new OrderedMeshBoundsCohort();
    expect(cohort.registerTurf(mesh, 2, 3)).toBe(true);
    cohort.reconcile(app, world);
    expect([...mesh.geometry.indices]).toEqual([...original.slice(0, 24), ...original.slice(48, 72)]);
    expect(mesh.geometry.positions).toBe(mesh.geometry.attributes.aPosition.buffer.data);
    world.scale.set(0.5);
    cohort.reconcile(app, world);
    expect(mesh.geometry.indices).toBe(original);
    expect(mesh.geometry.positions).toBe(originalPositions);
    expect(mesh.geometry.uvs).toBe(originalUvs);
    expect(new Uint32Array(mesh.geometry.positions.buffer)).toEqual(positionBits);
    expect(new Uint32Array(mesh.geometry.uvs.buffer)).toEqual(uvBits);
    cohort.dispose();
  });

  it("uses exact row-major macro grid connections and unchanged original-ID order", () => {
    const { app, world, layer } = appWithCanvas();
    const mesh = gridMesh(4, 3);
    layer.addChild(mesh);
    const original = mesh.geometry.indices;
    const cohort = new OrderedMeshBoundsCohort();
    expect(cohort.registerMacro(mesh, 4, 3)).toBe(true);
    cohort.reconcile(app, world);
    expect([...mesh.geometry.indices]).toEqual([...original.slice(0, 6)]);
    cohort.dispose();
    expect(mesh.geometry.indices).toBe(original);
  });

  it("retains every triangle with a possible viewport touch across four source rotations, pan, zoom and resize", () => {
    for (const quarterTurns of [0, 1, 2, 3]) {
      for (const [width, height, panX, panY, zoom] of [
        [800, 600, 0, 0, 1],
        [1024, 768, 137.125, -41.75, 0.37],
        [640, 480, -400.5, 199.25, 1.75],
      ]) {
        const { app, world, layer } = appWithCanvas(width, height);
        const mesh = turfMesh([-950, -0.125, 200, 1_000]);
        const originalPositions = mesh.geometry.positions;
        const rotated = new Float32Array(originalPositions.length);
        for (let i = 0; i < rotated.length; i += 2) {
          const x = originalPositions[i], y = originalPositions[i + 1];
          rotated[i] = [x, -y, -x, y][quarterTurns];
          rotated[i + 1] = [y, x, -y, -x][quarterTurns];
        }
        mesh.geometry.positions = rotated;
        layer.addChild(mesh);
        world.position.set(panX, panY);
        world.scale.set(zoom);
        const original = mesh.geometry.indices;
        const cohort = new OrderedMeshBoundsCohort();
        expect(cohort.registerTurf(mesh, 2, 4)).toBe(true);
        const viewport = knownRootStageViewport(app, world, mesh, scanFullGeometryExtent(mesh)!)!;
        expect(viewport).not.toBeNull();
        cohort.reconcile(app, world);
        const selected = mesh.geometry.indices;
        let selectedAt = 0;
        for (let i = 0; i < original.length; i += 3) {
          const present = selectedAt + 2 < selected.length
            && selected[selectedAt] === original[i]
            && selected[selectedAt + 1] === original[i + 1]
            && selected[selectedAt + 2] === original[i + 2];
          if (present) selectedAt += 3;
          let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
          for (let j = i; j < i + 3; j++) {
            const x = rotated[original[j] * 2], y = rotated[original[j] * 2 + 1];
            minX = Math.min(minX, x); minY = Math.min(minY, y);
            maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
          }
          if (!(maxX < viewport.local.minX || maxY < viewport.local.minY
            || minX > viewport.local.maxX || minY > viewport.local.maxY)) {
            expect(present, `turn ${quarterTurns}, ${width}x${height}, triangle ${i / 3}`).toBe(true);
          }
        }
        expect(selectedAt).toBe(selected.length);
        cohort.dispose();
        expect(mesh.geometry.indices).toBe(original);
      }
    }
  });

  it("uses original indices on rotation and recovers when the camera is supported", () => {
    const { app, world, layer } = appWithCanvas();
    const mesh = turfMesh([0, 1_000, 10]);
    layer.addChild(mesh);
    const original = mesh.geometry.indices;
    const cohort = new OrderedMeshBoundsCohort();
    expect(cohort.registerTurf(mesh, 2, 3)).toBe(true);
    cohort.reconcile(app, world);
    const selected = mesh.geometry.indices;
    expect(selected).not.toBe(original);
    world.rotation = 0.1;
    cohort.reconcile(app, world);
    expect(mesh.geometry.indices).toBe(original);
    world.rotation = 0;
    cohort.reconcile(app, world);
    expect([...mesh.geometry.indices]).toEqual([...selected]);
    cohort.dispose();
  });

  it("does not upload or allocate another index view for the same selected bits", () => {
    const { app, world, layer } = appWithCanvas();
    const mesh = turfMesh([0, 1_000, 10]);
    layer.addChild(mesh);
    const cohort = new OrderedMeshBoundsCohort();
    expect(cohort.registerTurf(mesh, 2, 3)).toBe(true);
    cohort.reconcile(app, world);
    const selected = mesh.geometry.indices;
    const version = (mesh.geometry.indexBuffer as PIXI.Buffer & { _updateID: number })._updateID;
    cohort.reconcile(app, world);
    expect(mesh.geometry.indices).toBe(selected);
    expect((mesh.geometry.indexBuffer as PIXI.Buffer & { _updateID: number })._updateID).toBe(version);
    world.position.set(-5_000, 0);
    cohort.reconcile(app, world);
    expect(mesh.geometry.indices).toHaveLength(0);
    const empty = mesh.geometry.indices;
    const emptyVersion = (mesh.geometry.indexBuffer as PIXI.Buffer & { _updateID: number })._updateID;
    cohort.reconcile(app, world);
    expect(mesh.geometry.indices).toBe(empty);
    expect((mesh.geometry.indexBuffer as PIXI.Buffer & { _updateID: number })._updateID).toBe(emptyVersion);
    for (let i = 0; i < 40; i++) {
      world.position.set(i % 2 === 0 ? 0 : -5_000, 0);
      cohort.reconcile(app, world);
      expect(mesh.geometry.indices.length).toBeLessThanOrEqual(selected.length);
      if (i % 2 === 0) expect(mesh.geometry.indices.buffer).toBe(selected.buffer);
      else expect(mesh.geometry.indices).toBe(empty);
    }
    cohort.dispose();
  });

  it("disposes selected storage and never overwrites a foreign index replacement", () => {
    const { app, world, layer } = appWithCanvas();
    const mesh = turfMesh([0, 1_000, 10]);
    layer.addChild(mesh);
    const original = mesh.geometry.indices;
    const cohort = new OrderedMeshBoundsCohort();
    expect(cohort.registerTurf(mesh, 2, 3)).toBe(true);
    cohort.reconcile(app, world);
    expect(mesh.geometry.indices).not.toBe(original);
    cohort.dispose();
    expect(mesh.geometry.indices).toBe(original);
    expect(cohort.diagnostics().meshes).toBe(0);
    cohort.dispose();
    expect(cohort.registerTurf(mesh, 2, 3)).toBe(false);

    const another = new OrderedMeshBoundsCohort();
    expect(another.registerTurf(mesh, 2, 3)).toBe(true);
    another.reconcile(app, world);
    const foreign = new Uint32Array([0, 1, 2]);
    mesh.geometry.indices = foreign;
    another.reconcile(app, world);
    expect(mesh.geometry.indices).toBe(foreign);
    expect(another.diagnostics().meshes).toBe(0);
    another.dispose();
    expect(mesh.geometry.indices).toBe(foreign);
  });

  it("discards a changed position buffer and restores the complete original binding", () => {
    const { app, world, layer } = appWithCanvas();
    const mesh = turfMesh([0, 1_000, 10]);
    layer.addChild(mesh);
    const original = mesh.geometry.indices;
    const cohort = new OrderedMeshBoundsCohort();
    expect(cohort.registerTurf(mesh, 2, 3)).toBe(true);
    cohort.reconcile(app, world);
    mesh.geometry.positions = new Float32Array(mesh.geometry.positions);
    cohort.reconcile(app, world);
    expect(mesh.geometry.indices).toBe(original);
    expect(cohort.diagnostics().meshes).toBe(0);
    cohort.dispose();
  });

  it("detaches its selected storage from an old geometry after mesh geometry replacement", () => {
    const { app, world, layer } = appWithCanvas();
    const mesh = turfMesh([0, 1_000, 10]);
    layer.addChild(mesh);
    const oldGeometry = mesh.geometry;
    const original = oldGeometry.indices;
    const cohort = new OrderedMeshBoundsCohort();
    expect(cohort.registerTurf(mesh, 2, 3)).toBe(true);
    cohort.reconcile(app, world);
    expect(oldGeometry.indices).not.toBe(original);
    const replacement = turfMesh([0]).geometry;
    const replacementIndices = replacement.indices;
    mesh.geometry = replacement;
    cohort.dispose();
    expect(oldGeometry.indices).toBe(original);
    expect(mesh.geometry).toBe(replacement);
    expect(mesh.geometry.indices).toBe(replacementIndices);
    expect(cohort.diagnostics().meshes).toBe(0);
  });

  for (const retirement of ["reconcile", "dispose"] as const) {
    it(`detaches its captured selected view after an index-buffer update on ${retirement}`, () => {
      const { app, world, layer } = appWithCanvas();
      const mesh = turfMesh([0, 1_000, 10]);
      layer.addChild(mesh);
      const oldGeometry = mesh.geometry;
      const original = oldGeometry.indices;
      const cohort = new OrderedMeshBoundsCohort();
      expect(cohort.registerTurf(mesh, 2, 3)).toBe(true);
      cohort.reconcile(app, world);
      const selected = oldGeometry.indices;
      expect(selected).not.toBe(original);
      oldGeometry.indexBuffer.update();
      if (retirement === "reconcile") cohort.reconcile(app, world);
      cohort.dispose();
      expect(oldGeometry.indices).toBe(original);
      expect(oldGeometry.indices.buffer).not.toBe(selected.buffer);
      expect(cohort.diagnostics().meshes).toBe(0);
    });
  }

  it("detaches its captured old buffer when the geometry receives a foreign index buffer", () => {
    const { app, world, layer } = appWithCanvas();
    const mesh = turfMesh([0, 1_000, 10]);
    layer.addChild(mesh);
    const oldGeometry = mesh.geometry;
    const original = oldGeometry.indices;
    const oldBuffer = oldGeometry.indexBuffer;
    const cohort = new OrderedMeshBoundsCohort();
    expect(cohort.registerTurf(mesh, 2, 3)).toBe(true);
    cohort.reconcile(app, world);
    expect(oldBuffer.data).not.toBe(original);
    const other = turfMesh([0]);
    const foreignBuffer = other.geometry.indexBuffer;
    const foreignData = foreignBuffer.data;
    oldGeometry.indexBuffer = foreignBuffer;
    cohort.dispose();
    expect(oldBuffer.data).toBe(original);
    expect(oldGeometry.indexBuffer).toBe(foreignBuffer);
    expect(foreignBuffer.data).toBe(foreignData);
    expect(cohort.diagnostics().meshes).toBe(0);
  });

  it("drops metadata after a fixed query budget miss instead of retrying each camera frame", () => {
    const { app, world, layer } = appWithCanvas();
    const xs = Array.from({ length: 9_000 }, (_, i) => i % 2 === 0 ? 0 : 1_000);
    const mesh = turfMesh(xs);
    layer.addChild(mesh);
    const original = mesh.geometry.indices;
    const cohort = new OrderedMeshBoundsCohort();
    expect(cohort.registerTurf(mesh, 2, xs.length)).toBe(true);
    cohort.reconcile(app, world);
    expect(mesh.geometry.indices).toBe(original);
    expect(cohort.diagnostics().meshes).toBe(0);
    world.position.set(7, 13);
    cohort.reconcile(app, world);
    expect(mesh.geometry.indices).toBe(original);
    cohort.dispose();
  });

  it("fails closed when Pixi destroys an indexed geometry before the next query", () => {
    const { app, world, layer } = appWithCanvas();
    const mesh = turfMesh([0, 1_000, 10]);
    layer.addChild(mesh);
    const cohort = new OrderedMeshBoundsCohort();
    expect(cohort.registerTurf(mesh, 2, 3)).toBe(true);
    cohort.reconcile(app, world);
    mesh.geometry.destroy();
    expect(() => cohort.reconcile(app, world)).not.toThrow();
    expect(cohort.diagnostics().meshes).toBe(0);
    cohort.dispose();
  });

  it("rejects unknown grid connectivity, Low/unsupported units and fixed mesh cap", () => {
    const cohort = new OrderedMeshBoundsCohort();
    const grid = gridMesh(4, 3);
    grid.geometry.indices = new Uint32Array(grid.geometry.indices);
    grid.geometry.indices[1] = 7;
    expect(cohort.registerMacro(grid, 4, 3)).toBe(false);
    const turf = turfMesh([0, 1_000, 10]);
    expect(cohort.registerTurf(turf, 1, 3)).toBe(false);
    const oversized = turfMesh([0]);
    oversized.geometry.indices = new Uint32Array(6_000_024);
    expect(cohort.registerTurf(oversized, 2, 250_001)).toBe(false);
    expect(cohort.diagnostics()).toEqual({ meshes: 0, originalIndices: 0, reservedBytes: 0 });
    cohort.dispose();
  });
});
