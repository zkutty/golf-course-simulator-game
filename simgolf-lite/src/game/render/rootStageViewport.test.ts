import { describe, expect, it } from "vitest";
import {
  AbstractRenderer, Application, Container, GlobalUniformSystem, GlMeshAdaptor,
  Mesh, MeshGeometry, MeshPipe, RenderGroupSystem, RenderTargetSystem,
  RendererType, ViewSystem, WebGLRenderer,
} from "pixi.js";
import { knownRootStageViewport, scanFullGeometryExtent } from "./rootStageViewport";

function scene(positions?: Float32Array) {
  const app = new Application();
  const canvas = { width: 800, height: 600 };
  const source = { resource: canvas, resolution: 1, _resolution: 1,
    pixelWidth: 800, pixelHeight: 600,
    resize(_width: number, _height: number, resolution: number) {
      this.resolution = resolution;
      this._resolution = resolution;
    } };
  const texture = { source, frame: { x: 0, y: 0, width: 800, height: 600 } };
  const target = { isRoot: true, colorTexture: source, resolution: 1, pixelWidth: 800, pixelHeight: 600 };
  const renderer = Object.create(WebGLRenderer.prototype) as WebGLRenderer;
  const pipe = Object.create(MeshPipe.prototype) as MeshPipe;
  const view = Object.assign(Object.create(ViewSystem.prototype), { canvas, texture, renderTarget: target,
    screen: { x: 0, y: 0, width: 800, height: 600 } });
  Object.assign(pipe, { renderer, _adaptor: Object.create(GlMeshAdaptor.prototype) });
  Object.assign(renderer, {
    type: RendererType.WEBGL,
    view,
    renderGroup: Object.create(RenderGroupSystem.prototype),
    renderTarget: Object.create(RenderTargetSystem.prototype),
    globalUniforms: Object.create(GlobalUniformSystem.prototype),
    renderPipes: { mesh: pipe },
    _roundPixels: 0,
    gl: {
      VERTEX_SHADER: 35633, HIGH_FLOAT: 36338,
      getShaderPrecisionFormat: () => ({ precision: 23, rangeMin: 127, rangeMax: 127 }),
    },
  });
  expect(renderer.render).toBe(AbstractRenderer.prototype.render);
  (app as unknown as { renderer: WebGLRenderer }).renderer = renderer;
  const world = new Container();
  const layer = new Container();
  const coords = positions ?? new Float32Array(Array.from({ length: 102 }, (_, i) =>
    [i, i % 3]).flat());
  const geometry = new MeshGeometry({ positions: coords, indices: new Uint32Array([0, 1, 2]) });
  const mesh = new Mesh({ geometry });
  app.stage.addChild(world);
  world.addChild(layer);
  layer.addChild(mesh);
  world.position.set(400, 300);
  const extent = scanFullGeometryExtent(mesh);
  return { app, renderer, world, layer, mesh, extent: extent! };
}

describe("known root-stage viewport guard", () => {
  it("qualifies the first normal root draw without cached render groups or uniforms", () => {
    const s = scene();
    Object.defineProperty(s.renderer.globalUniforms, "uniforms", {
      get: () => { throw new Error("stale prior-frame uniforms must not be read"); },
    });
    const result = knownRootStageViewport(s.app, s.world, s.mesh, s.extent);
    expect(result).not.toBeNull();
    expect(result!.screenErrorPx).toBeLessThan(0.5);
    expect(result!.local.minX).toBeLessThan(-402.5);
    expect(result!.local.maxX).toBeGreaterThan(402.5);
    expect(result!.local.minY).toBeLessThan(-302.5);
    expect(result!.local.maxY).toBeGreaterThan(302.5);
  });

  it("uses current camera, including positive zoom and pan, then fails closed during rotation", () => {
    const s = scene();
    s.world.scale.set(2);
    s.world.position.set(420, 310);
    const result = knownRootStageViewport(s.app, s.world, s.mesh, s.extent);
    expect(result).not.toBeNull();
    expect(result!.local.minX).toBeLessThan((-2.5 - 420) / 2);
    expect(result!.local.maxX).toBeGreaterThan((802.5 - 420) / 2);
    s.world.rotation = 0.01;
    expect(knownRootStageViewport(s.app, s.world, s.mesh, s.extent)).toBeNull();
  });

  it("rejects current root viewport, resolution and precision mismatches", () => {
    const s = scene();
    const view = s.renderer.view;
    view.resolution = 2;
    expect(knownRootStageViewport(s.app, s.world, s.mesh, s.extent)).toBeNull();
    view.resolution = 1;
    s.app.canvas.width = 801;
    expect(knownRootStageViewport(s.app, s.world, s.mesh, s.extent)).toBeNull();
    s.app.canvas.width = 800;
    const gl = s.renderer.gl;
    gl.getShaderPrecisionFormat = () => ({ precision: 22, rangeMin: 127, rangeMax: 127 });
    expect(knownRootStageViewport(s.app, s.world, s.mesh, s.extent)).toBeNull();
  });

  it("rejects nested render groups, ancillary transforms, effects and masks", () => {
    const s = scene();
    s.layer.enableRenderGroup();
    expect(knownRootStageViewport(s.app, s.world, s.mesh, s.extent)).toBeNull();
    s.layer.disableRenderGroup();
    s.layer.position.x = 1;
    expect(knownRootStageViewport(s.app, s.world, s.mesh, s.extent)).toBeNull();
    s.layer.position.x = 0;
    s.layer.effects?.push({} as never);
    expect(knownRootStageViewport(s.app, s.world, s.mesh, s.extent)).toBeNull();
  });

  it("rejects changed root stage identity and non-stage ancestry", () => {
    const s = scene();
    s.app.stage.position.x = 1;
    expect(knownRootStageViewport(s.app, s.world, s.mesh, s.extent)).toBeNull();
    s.app.stage.position.x = 0;
    s.app.stage.removeChild(s.world);
    expect(knownRootStageViewport(s.app, s.world, s.mesh, s.extent)).toBeNull();
  });

  it("rejects renderer or pipeline substitution, rounding and custom shader", () => {
    const s = scene();
    s.renderer._roundPixels = 1;
    expect(knownRootStageViewport(s.app, s.world, s.mesh, s.extent)).toBeNull();
    s.renderer._roundPixels = 0;
    s.mesh.roundPixels = true;
    expect(knownRootStageViewport(s.app, s.world, s.mesh, s.extent)).toBeNull();
    s.mesh.roundPixels = false;
    s.mesh.shader = {} as never;
    expect(knownRootStageViewport(s.app, s.world, s.mesh, s.extent)).toBeNull();
    s.mesh.shader = null;
    s.renderer.render = (() => {}) as typeof s.renderer.render;
    expect(knownRootStageViewport(s.app, s.world, s.mesh, s.extent)).toBeNull();
  });

  it("rejects batching and non-triangle topology", () => {
    const s = scene();
    s.mesh.geometry.batchMode = "batch";
    expect(knownRootStageViewport(s.app, s.world, s.mesh, s.extent)).toBeNull();
    s.mesh.geometry.batchMode = "no-batch";
    s.mesh.geometry.topology = "triangle-strip";
    expect(knownRootStageViewport(s.app, s.world, s.mesh, s.extent)).toBeNull();
  });

  it("binds the full-extent proof to the mesh, positions and update identity", () => {
    const s = scene();
    expect(knownRootStageViewport(s.app, s.world, s.mesh, s.extent)).not.toBeNull();
    s.mesh.geometry.positions = new Float32Array(s.mesh.geometry.positions);
    expect(knownRootStageViewport(s.app, s.world, s.mesh, s.extent)).toBeNull();
    expect(scanFullGeometryExtent(s.mesh)).not.toBeNull();
  });

  it("rejects nonfinite or oversized coordinates and tiny inverse scales", () => {
    const bad = scene(new Float32Array([0, 0, NaN, 1]));
    expect(scanFullGeometryExtent(bad.mesh)).toBeNull();
    const huge = scene(new Float32Array(Array.from({ length: 102 }, (_, i) => [1e30 + i, 0]).flat()));
    expect(knownRootStageViewport(huge.app, huge.world, huge.mesh, huge.extent)).toBeNull();
    const tiny = scene();
    tiny.world.scale.set(1e-300);
    expect(knownRootStageViewport(tiny.app, tiny.world, tiny.mesh, tiny.extent)).toBeNull();
  });
});
