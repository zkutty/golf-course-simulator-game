import * as P from "pixi.js";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { OwnedComponentCulling, COMPONENT_ENTRY_BYTES, enclosingComponentRectangle } from "./ownedComponentCulling";
import { knownRootStageViewport, knownOwnedStencilRootViewport, captureOwnedStencilViewport, scanFullGeometryExtent } from "./rootStageViewport";

function fixture() {
  const app = new P.Application(), canvas = Object.assign(new EventTarget(), { width: 800, height: 600 });
  const source = { resource: canvas, resolution: 1, _resolution: 1, pixelWidth: 800, pixelHeight: 600,
    resize(_width: number, _height: number, resolution: number) { this.resolution = resolution; this._resolution = resolution; } };
  const target = { uid: 1, isRoot: true, colorTexture: source, resolution: 1, pixelWidth: 800, pixelHeight: 600 };
  const renderer = Object.create(P.WebGLRenderer.prototype) as P.WebGLRenderer;
  const meshPipe = Object.assign(Object.create(P.MeshPipe.prototype), { renderer, _adaptor: Object.create(P.GlMeshAdaptor.prototype) });
  const graphicsPipe = Object.assign(Object.create(P.GraphicsPipe.prototype), { renderer, _adaptor: Object.create(P.GlGraphicsAdaptor.prototype) });
  const gl = { VERTEX_SHADER: 35633, HIGH_FLOAT: 36338, isContextLost: vi.fn(() => false), getShaderPrecisionFormat: () => ({ precision: 23, rangeMin: 127, rangeMax: 127 }) };
  Object.assign(renderer, { type: P.RendererType.WEBGL, _roundPixels: 0, gl,
    background: { clearBeforeRender: true, alpha: 1 },
    view: Object.assign(Object.create(P.ViewSystem.prototype), { canvas, renderTarget: target,
      texture: { source, frame: { x: 0, y: 0, width: 800, height: 600 } }, screen: { x: 0, y: 0, width: 800, height: 600 } }),
    renderGroup: Object.create(P.RenderGroupSystem.prototype), globalUniforms: Object.create(P.GlobalUniformSystem.prototype),
    renderTarget: Object.assign(Object.create(P.RenderTargetSystem.prototype), { adaptor: Object.create(P.GlRenderTargetAdaptor.prototype) }),
    stencil: Object.create(P.GlStencilSystem.prototype), colorMask: Object.create(P.GlColorMaskSystem.prototype),
    renderPipes: { mesh: meshPipe, graphics: graphicsPipe, stencilMask: new P.StencilMaskPipe(renderer) },
  });
  (app as unknown as { renderer: P.WebGLRenderer }).renderer = renderer;
  const world = app.stage.addChild(new P.Container()), layer = world.addChild(new P.Container());
  function pair(offset = 0) {
    const geometry = new P.MeshGeometry({ positions: new Float32Array([offset, 0, offset + 10, 0, offset + 10, 10, offset, 10]), uvs: new Float32Array(8), indices: new Uint32Array([0, 1, 2, 0, 2, 3]) });
    geometry.batchMode = "no-batch";
    const mesh = new P.Mesh({ geometry, texture: P.Texture.EMPTY }), mask = new P.Graphics().rect(offset, 0, 10, 10).fill(0xffffff);
    mesh.mask = mask; layer.addChild(mesh, mask); return { mesh, mask, geometry };
  }
  const first = pair(), owner = new OwnedComponentCulling();
  const cleanup = () => { owner.dispose(); for (const child of [...layer.children]) { layer.removeChild(child); const g = child instanceof P.Mesh ? child.geometry : null; if (!child.destroyed) child.destroy(); if (g?.buffers) g.destroy(true); } app.stage.destroy({ children: true }); };
  return { app, canvas, renderer, gl, world, layer, pair, owner, cleanup, ...first };
}

describe("private whole owned component Culler", () => {
  it("uses real local extents/local viewport, preserves all original source/material/mask state and restores through public disable", () => {
    const f = fixture(); const { mesh, geometry, mask, owner } = f;
    const originals = [geometry.positions, geometry.uvs, geometry.indices, geometry.indexBuffer, mesh.texture, mesh.state, mask.context];
    const flags = [mesh.visible, mesh.renderable, mesh.alpha, mask.includeInBuild];
    try {
      const extent = scanFullGeometryExtent(mesh)!;
      expect(knownRootStageViewport(f.app, f.world, mesh, extent)).toBeNull();
      expect(captureOwnedStencilViewport(mesh, mask)).not.toBeNull();
      expect(owner.register(mesh, mask)).toBe(true);
      f.world.position.set(2000, -500); owner.reconcile(f.app, f.world);
      expect(mesh.culled).toBe(true); expect(owner.diagnostics().culled).toBe(1);
      expect(mesh.cullArea?.x).toBe(0); // LOCAL, not translated to2000.
      f.world.position.set(100, 100); owner.reconcile(f.app, f.world); expect(mesh.culled).toBe(false);
      f.world.position.set(2000, 0); owner.reconcile(f.app, f.world); expect(mesh.culled).toBe(true);
      owner.dispose(); owner.dispose(); expect(mesh.culled).toBe(false); expect(mesh.cullable).toBe(false); expect(mesh.cullArea).toBeNull(); expect(mesh.cullableChildren).toBe(true);
      expect([geometry.positions, geometry.uvs, geometry.indices, geometry.indexBuffer, mesh.texture, mesh.state, mask.context]).toEqual(originals);
      originals.forEach((value, i) => expect([geometry.positions, geometry.uvs, geometry.indices, geometry.indexBuffer, mesh.texture, mesh.state, mask.context][i]).toBe(value));
      expect([mesh.visible, mesh.renderable, mesh.alpha, mask.includeInBuild]).toEqual(flags);
      expect(P.Texture.EMPTY.destroyed).toBe(false);
    } finally { f.cleanup(); }
  });
  it("uses verified outward rectangles and retains contact with the existing expanded viewport", () => {
    for (const bounds of [{ minX: -1e10, minY: -123.5, maxX: 1.25, maxY: 40 }, { minX: -1e-100, minY: 0, maxX: 1e-99, maxY: .1 }]) {
      const area = enclosingComponentRectangle(bounds)!, view = enclosingComponentRectangle(bounds, true)!;
      expect(area.x + area.width).toBeGreaterThanOrEqual(bounds.maxX); expect(area.y + area.height).toBeGreaterThanOrEqual(bounds.maxY);
      expect(view.x).toBeLessThan(bounds.minX); expect(view.x + view.width).toBeGreaterThan(bounds.maxX);
    }
    expect(enclosingComponentRectangle({ minX: -Infinity, minY: 0, maxX: 1, maxY: 1 })).toBeNull();
    const f = fixture(); try {
      const proof = captureOwnedStencilViewport(f.mesh, f.mask)!;
      const viewport = knownOwnedStencilRootViewport(f.app, f.world, scanFullGeometryExtent(f.mesh)!, proof)!;
      const view = enclosingComponentRectangle(viewport.local, true)!;
      const culler = new P.Culler(); f.mesh.cullable = true; f.mesh.cullableChildren = false;
      // A genuine source rectangle at the expanded boundary remains retained.
      f.mesh.cullArea = new P.Rectangle(viewport.local.maxX, 0, 1, 1); culler.cull(f.mesh, view, false); expect(f.mesh.culled).toBe(false);
      f.mesh.cullable = false; culler.cull(f.mesh, view, false);
    } finally { f.cleanup(); }
  });
  it("matches a conservative full-source oracle for four source rotations and camera/viewport edge cases", () => {
    for (let rotation = 0; rotation < 4; rotation++) for (const [x, y, zoom] of [[0, 0, 1], [-805, -15, 1], [2000, -900, .37], [799, 599, 1.75]]) {
      const f = fixture(); try {
        const positions = f.geometry.positions;
        for (let at = 0; at < positions.length; at += 2) { const px = positions[at], py = positions[at + 1]; positions[at] = [px, -py, -px, py][rotation]; positions[at + 1] = [py, px, -py, -px][rotation]; }
        f.geometry.getBuffer("aPosition").update();
        const proof = captureOwnedStencilViewport(f.mesh, f.mask)!, extent = scanFullGeometryExtent(f.mesh)!;
        f.world.position.set(x, y); f.world.scale.set(zoom);
        const viewport = knownOwnedStencilRootViewport(f.app, f.world, extent, proof)!;
        expect(viewport).not.toBeNull(); expect(f.owner.register(f.mesh, f.mask)).toBe(true); f.owner.reconcile(f.app, f.world);
        if (f.mesh.culled) expect(extent.maxX < viewport.local.minX || extent.minX > viewport.local.maxX || extent.maxY < viewport.local.minY || extent.minY > viewport.local.maxY).toBe(true);
      } finally { f.cleanup(); }
    }
  });
  for (const change of ["positions", "uvs", "indices", "position-version", "geometry", "mask", "parent", "child", "custom-shader", "inverse", "clear", "alpha", "context", "resolution"] as const) {
    it(`restores full rendering on unsupported ${change}`, () => {
      const f = fixture(); let extraGeometry: P.MeshGeometry | null = null, extraMask: P.Graphics | null = null;
      try {
        expect(f.owner.register(f.mesh, f.mask)).toBe(true); f.world.x = 2000; f.owner.reconcile(f.app, f.world); expect(f.mesh.culled).toBe(true);
        if (change === "positions") f.geometry.positions = f.geometry.positions.slice();
        if (change === "uvs") f.geometry.uvs = f.geometry.uvs.slice();
        if (change === "indices") f.geometry.indices = f.geometry.indices.slice();
        if (change === "position-version") f.geometry.getBuffer("aPosition").update();
        if (change === "geometry") { extraGeometry = new P.MeshGeometry({}); f.mesh.geometry = extraGeometry; }
        if (change === "mask") { extraMask = new P.Graphics().rect(0, 0, 1, 1).fill(1); f.layer.addChild(extraMask); f.mesh.mask = extraMask; }
        if (change === "parent") f.world.addChild(f.mesh);
        if (change === "child") { const child = new P.Container(); f.mesh.allowChildren = true; f.mesh.addChild(child); }
        if (change === "custom-shader") f.mesh.shader = {} as NonNullable<typeof f.mesh.shader>;
        if (change === "inverse") f.mesh.setMask({ inverse: true });
        if (change === "clear") f.renderer.background.clearBeforeRender = false;
        if (change === "alpha") f.renderer.background.alpha = .5;
        if (change === "context") f.gl.isContextLost.mockReturnValue(true);
        if (change === "resolution") f.renderer.view.resolution = 2;
        f.owner.reconcile(f.app, f.world); expect(f.mesh.culled).toBe(false); expect(f.mesh.visible).toBe(true); expect(f.mesh.renderable).toBe(true);
      } finally { f.mesh.shader = null; f.mesh.removeChildren().forEach(child => child.destroy()); extraGeometry?.destroy(true); extraMask?.destroy(); if (f.mesh.parent !== f.layer) f.layer.addChild(f.mesh); f.cleanup(); }
    });
  }
  it("retires context events, owned destroy callbacks and old lifetimes without destroying borrowed resources", () => {
    const f = fixture(); const before = f.mesh.listenerCount("destroyed");
    try {
      const removed = vi.spyOn(f.canvas, "removeEventListener");
      expect(f.owner.register(f.mesh, f.mask)).toBe(true); expect(f.mesh.listenerCount("destroyed")).toBe(before + 1);
      f.world.x = 2000; f.owner.reconcile(f.app, f.world); f.canvas.dispatchEvent(new Event("webglcontextlost"));
      expect(f.mesh.culled).toBe(false); expect(f.owner.size).toBe(0); expect(f.mesh.listenerCount("destroyed")).toBe(before);
      f.owner.dispose(); expect(removed).toHaveBeenCalledTimes(2);
      const newer = new OwnedComponentCulling(); expect(newer.register(f.mesh, f.mask)).toBe(true); f.owner.dispose();
      f.mesh.destroy(); expect(newer.size).toBe(0); newer.dispose(); expect(P.Texture.EMPTY.destroyed).toBe(false);
    } finally { f.cleanup(); }
  });
  it("preserves divergent foreign controls and visibility while retiring exclusive ownership", () => {
    const f = fixture(); try {
      expect(f.owner.register(f.mesh, f.mask)).toBe(true); f.world.x = 2000; f.owner.reconcile(f.app, f.world);
      const area = new P.Rectangle(4, 5, 6, 7); f.mesh.cullArea = area; f.mesh.visible = false; f.mesh.renderable = false;
      f.owner.reconcile(f.app, f.world); expect(f.owner.size).toBe(0); expect(f.mesh.cullArea).toBe(area); expect(f.mesh.culled).toBe(true);
      expect(f.mesh.visible).toBe(false); expect(f.mesh.renderable).toBe(false);
    } finally { f.cleanup(); }
  });
  it("preserves foreign child-culling configuration and a newly added child's true flag without recursing", () => {
    const f = fixture();
    const child = new P.Graphics().rect(-1900, 0, 10, 10).fill(0xffffff);
    try {
      expect(f.owner.register(f.mesh, f.mask)).toBe(true); f.world.x = 2000; f.owner.reconcile(f.app, f.world); expect(f.mesh.culled).toBe(true);
      f.mesh.allowChildren = true; f.mesh.addChild(child); f.mesh.cullableChildren = true;
      child.cullable = true; child.cullableChildren = false;
      const childArea = new P.Rectangle(-1900, 0, 10, 10); child.cullArea = childArea;
      // This foreign source is outside its owner's view, but inside the old
      // parent's inverse viewport. The rejected cleanup used to uncull it.
      new P.Culler().cull(child, { x: 0, y: 0, width: 100, height: 100 }, false); expect(child.culled).toBe(true);
      const parentArea = f.mesh.cullArea;
      f.owner.reconcile(f.app, f.world); expect(f.owner.size).toBe(0);
      expect(child.culled).toBe(true); expect(child.cullArea).toBe(childArea); expect(child.cullableChildren).toBe(false);
      expect(f.mesh.culled).toBe(true); expect(f.mesh.cullArea).toBe(parentArea); expect(f.mesh.cullableChildren).toBe(true);
      f.owner.dispose(); expect(child.culled).toBe(true); expect(f.mesh.culled).toBe(true);
    } finally { f.mesh.removeChildren(); child.destroy(); f.cleanup(); }
  });
  it("restores the exact null or undefined cullArea baseline through the documented public property", () => {
    for (const baseline of [null, undefined]) {
      const f = fixture();
      try {
        (f.mesh as unknown as { cullArea: P.Rectangle | null | undefined }).cullArea = baseline;
        expect(f.owner.register(f.mesh, f.mask)).toBe(true); f.world.x = 2000; f.owner.reconcile(f.app, f.world);
        expect(f.mesh.culled).toBe(true); f.owner.dispose(); expect(f.mesh.culled).toBe(false); expect(f.mesh.cullArea).toBe(baseline);
      } finally { f.cleanup(); }
    }
  });
  it("unculls through intact public controls after collection substitution and preserves observable foreign culling decisions", () => {
    const f = fixture(); const original = f.mesh.collectRenderables;
    try {
      expect(f.owner.register(f.mesh, f.mask)).toBe(true); f.world.x = 2000; f.owner.reconcile(f.app, f.world); expect(f.mesh.culled).toBe(true);
      f.mesh.collectRenderables = () => {}; f.owner.reconcile(f.app, f.world); expect(f.mesh.culled).toBe(false); expect(f.owner.size).toBe(0);
      f.mesh.collectRenderables = original;
      const foreign = new OwnedComponentCulling(); expect(foreign.register(f.mesh, f.mask)).toBe(true); f.world.x = 0; foreign.reconcile(f.app, f.world);
      // A second documented Culler makes a divergent decision: retire without
      // clearing that foreign true bit. Equal writes are not detectable.
      const culler = new P.Culler(); culler.cull(f.mesh, { x: 5000, y: 5000, width: 100, height: 100 }, false);
      foreign.reconcile(f.app, f.world); expect(foreign.size).toBe(0); expect(f.mesh.culled).toBe(true);
      foreign.dispose(); f.mesh.cullable = false; culler.cull(f.mesh, { x: 0, y: 0, width: 800, height: 600 }, false);
    } finally { f.mesh.collectRenderables = original; f.cleanup(); }
  });
  it("bounds owners and fixed reservations without index/fan storage, and admits no batched/shared mask controls", () => {
    const f = fixture(); try {
      expect(f.owner.register(f.mesh, f.mask)).toBe(true); expect(f.owner.register(f.mesh, f.mask)).toBe(false);
      for (let i = 1; i < 65; i++) { const pair = f.pair(i * 30); expect(f.owner.register(pair.mesh, pair.mask)).toBe(i < 64); }
      expect(f.owner.size).toBe(64); expect(f.owner.reservedBytes).toBe(64 * COMPONENT_ENTRY_BYTES); f.owner.dispose(); expect(f.owner.reservedBytes).toBe(0);
      const other = new OwnedComponentCulling(); f.geometry.batchMode = "auto"; expect(other.register(f.mesh, f.mask)).toBe(false); other.dispose();
      const source = readFileSync(new URL("./ownedComponentCulling.ts", import.meta.url), "utf8");
      expect(source).not.toMatch(/\.culled\s*=(?!=)|\.localDisplayStatus\s*=|\.globalDisplayStatus\s*=|\.structureDidChange\s*=|\.includeInBuild\s*=/);
      expect(source).not.toContain("new Uint32Array");
    } finally { f.cleanup(); }
  });
});

it("uses actual SDK render-group rebuild/collection and stencil push/pop for first, cached, restored and all-culled frames", () => {
  const f = fixture(), second = f.pair(100), third = f.pair(200);
  f.mesh.label = "first"; second.mesh.label = "second"; third.mesh.label = "third";
  // Mask remains at its original visible location; its offscreen floor has no
  // color coverage. Omitting the complete balanced mask pair must be harmless.
  for (let i = 0; i < f.geometry.positions.length; i += 2) f.geometry.positions[i] += 2000;
  f.geometry.getBuffer("aPosition").update(); f.app.stage.enableRenderGroup();
  const noop = () => {};
  const buildStart = vi.fn();
  type Instructions = { add(row: object): void };
  const renderPipes = {
    mesh: { validateRenderable: () => false, updateRenderable: noop, addRenderable: (mesh: P.Mesh, set: Instructions) => set.add({ renderPipeId: "mesh", mesh }) },
    graphics: { validateRenderable: () => false, updateRenderable: noop, addRenderable: (mask: P.Graphics, set: Instructions) => set.add({ renderPipeId: "graphics", mask }) },
    batch: { buildStart, buildEnd: noop, upload: noop, break: noop },
    blendMode: { buildStart: noop, buildEnd: noop, pushBlendMode: noop, popBlendMode: noop, setBlendMode: noop },
    colorMask: { buildStart: noop },
  };
  const cpu = { renderPipes, renderTarget: { renderTarget: { uid: 1 }, ensureDepthStencil: vi.fn() },
    stencil: { setStencilMode: vi.fn((_mode: number, _reference: number) => {}) }, colorMask: { setMask: vi.fn((_mask: number) => {}) } };
  const stencil = new P.StencilMaskPipe(cpu as unknown as P.WebGLRenderer); Object.assign(renderPipes, { stencilMask: stencil });
  const system = new P.RenderGroupSystem(cpu as unknown as P.WebGLRenderer);
  const render = () => {
    Reflect.get(system, "_updateRenderGroups").call(system, f.app.stage.renderGroup);
    const set = f.app.stage.renderGroup!.instructionSet;
    const rows = set.instructions.slice(0, set.instructionSize) as unknown as Array<{ renderPipeId: string; action?: string; mesh?: P.Mesh }>;
    for (const row of rows) if (row.renderPipeId === "stencilMask") stencil.execute(row as never);
    const pushes = rows.filter(row => row.action === "pushMaskBegin").length, pops = rows.filter(row => row.action === "popMaskEnd").length;
    expect(pushes).toBe(pops);
    return { rows, floors: rows.filter(row => row.mesh).map(row => row.mesh!.label), pushes };
  };
  try {
    for (const pair of [f, second, third]) expect(f.owner.register(pair.mesh, pair.mask)).toBe(true);
    f.owner.reconcile(f.app, f.world); const first = render(); expect(first.floors).toEqual(["second", "third"]); expect(first.pushes).toBe(2); expect(buildStart).toHaveBeenCalledOnce();
    const cached = render(); expect(cached.rows).toEqual(first.rows); cached.rows.forEach((row, i) => expect(row).toBe(first.rows[i])); expect(buildStart).toHaveBeenCalledOnce();
    f.world.position.set(-1995, 100); f.owner.reconcile(f.app, f.world); const restored = render(); expect(restored.floors).toEqual(["first"]); expect(restored.pushes).toBe(1); expect(buildStart).toHaveBeenCalledTimes(2);
    f.world.x = 4000; f.owner.reconcile(f.app, f.world); const all = render(); expect(all.floors).toEqual([]); expect(all.pushes).toBe(0); expect(buildStart).toHaveBeenCalledTimes(3);
    f.owner.dispose(); const released = render(); expect(released.floors).toEqual(["first", "second", "third"]); expect(released.pushes).toBe(3);
    expect(cpu.stencil.setStencilMode.mock.calls.at(-1)?.[1]).toBe(0);
    expect(f.mesh.visible).toBe(true); expect(f.mesh.renderable).toBe(true); expect(f.mask.includeInBuild).toBe(false);
  } finally { f.cleanup(); }
});

it("retains all29 actual-M27 component Float32/UV/index sources from the frozen census", async () => {
  const reference = await import("../testing/referenceCourse");
  const layouts = await import("../models/courseLayouts");
  const surfaces = await import("../conditions/surfaceCare");
  const landscape = await import("./landscapeGeometry");
  const terrain = await import("./terrainPresentationPolicy");
  const iso = await import("./iso");
  const composable = await import("./parklandComposable");
  const course = layouts.normalizeCourseLayouts(reference.createM27ReleaseReferenceCourse("parkland"));
  const heightfield = landscape.buildVisualHeightfield(course), effective = surfaces.courseWithEffectiveSurfaces(course).tiles;
  const presentation = terrain.buildTerrainPresentationMap(effective, course.width, course.height, course.theme).presentationTiles;
  const cache = landscape.createLandscapeComponentCache();
  const expected = [["wetland","wetland-nli8o2",8,"1bb5a09a80094aa792fbe3481bb408d3101c5be59bed9ed5e735869a963e0d36","4fed6473994d77b046862bd111204ee43bc27e080dcf0f38339486c36a3b0233","e42ed7b50d0a7f5a07129daea56b3713c06598ae2614a64298ecc16466685a6d"],["wetland","wetland-zpknoi",8,"a0c8b49de55dc80b7385452641f2fae13009295712d746aea19f7bf9d5cea595","b9e1cc23818075e049a1fbe6583f158f6f0b0020e9004acd70075e3fa187b8bb","e42ed7b50d0a7f5a07129daea56b3713c06598ae2614a64298ecc16466685a6d"],["wetland","wetland-5f1mlp",5,"a132e005d8e78104048344db689220f3f6041eb6f3e3c2c2311e98fc82eb9189","4169270914d4d7c1cd4f3175b9c84ff720a03d2f74e1a2cb86fdf892c711902f","a654a0b4d9c383d78f00fecbdff47aeab6786e8c95dd18012f2a8983437595f5"],["wetland","wetland-wfcbx2",5,"cf6be1a8afc08d5c09a2a2ce8cd8c7f24e5d8bfcfd94061f6278fc82da7846f8","508604a589b07f5369ed0c6f68dcaed47a8e2bf3dc844e16c16456bb798f80f5","a654a0b4d9c383d78f00fecbdff47aeab6786e8c95dd18012f2a8983437595f5"],["wetland","wetland-16t2vat",5,"95cf856a2bad360518ce4ae9f01b953a90a019c3eddad300f782d66034a24020","ddbd591922726a16e000309744de28fe2493e4545fe731f75df75c1e76d842d7","a654a0b4d9c383d78f00fecbdff47aeab6786e8c95dd18012f2a8983437595f5"],["sand","sand-1fs9nz8",11,"e9d54e9a070ece58a866243d60ebdad825f8a3d40e380bedcb0e844fa6d23974","0e8367fb0fcc16afb30c03b8be766bf1e4d711c88116b3a78c1202e5eda668cc","94a251bcaaffd5f003c2b8d928d06dc3f2fe403016909309abed78fa8a1d4689"],["water","water-1mlh1k7",825,"b938512fd39b11c76f2c171d713777c917260ceefecef7df9e7882916edd4e23","6534f97bf42ff06b3e9cb8af92aa0480bc3827cad939b2276f76c2524677e45e","432dd64ed715e43faf1ff2cc9904d144a7d14bdcf45b024dbc500ea92a73d0f9"],["wetland","wetland-1es17qs",5,"6e802620ab98fda7c6373cebca73da741a73e6ba5f260edbddd317626b945a2f","bb0e0938819ef16aea2bd5ca8c1ee36a6c961c6dcd9f345dc6a95b8351dc00c8","a654a0b4d9c383d78f00fecbdff47aeab6786e8c95dd18012f2a8983437595f5"],["wetland","wetland-14rhlls",5,"05f83908a5a0664b7469f65dadf8e84bfac8a317e124c53ad2a3766cc17853d1","09524d7ea04f929075c49fe8cb01dc295e0bbb9655a9a1ec98e4f9bd3e2b313e","a654a0b4d9c383d78f00fecbdff47aeab6786e8c95dd18012f2a8983437595f5"],["sand","sand-1izjsoe",24,"28861cad5113d1d58d424a840dd41d395d15ff469739ebda7941c6fcd84e4048","689bcc5a62a88fca5c2c44dc58fa81c39c8521d08b2f2ab3395ae0bde2cce8f4","095dd29fc18d59347f5ab273cf880524ebcaaab5227a0837f4e60b7a5bcd0816"],["waste_area","waste_area-1ujs0zw",5,"66019d9210a5550f5244f7da4e4cb7a98f1640cdefca2d376ba12d8c5ca150e0","d96918a0b179bf34f64f54739a7cd6cacff1da8b7ec6fe9870d133cda88a5491","a654a0b4d9c383d78f00fecbdff47aeab6786e8c95dd18012f2a8983437595f5"],["wetland","wetland-vfq64x",5,"358b1eb6617b0b983c7dc5922fcac301f98f0f095cfd58cd526f687b7ebdf5c4","4a3236e327bf580ef0c21c6b0b833f41fefd7edbda9fce4e625bed89f948529c","a654a0b4d9c383d78f00fecbdff47aeab6786e8c95dd18012f2a8983437595f5"],["water","water-l65uqi",25,"e7659b6b69aad6f8f0c76f027f53ce50dd931cdf1243bbf9ffaab3a27e09fa55","510de3cea2b66e7d762f4ff33b2513fbc68c808fe44da47a174d0786de82a94e","26a7f1b8faaae1e9d732e9aacc889331f92b097d96bc590205db09703d52c54f"],["wetland","wetland-15dk0qf",5,"55f0abfdb41404f84ffa067d7da9fa44eee9e8b2f56757b499ab971a860df4ce","47ba086e00064e50081641fa39a62503918599e0991386d7af84933b1e372af8","a654a0b4d9c383d78f00fecbdff47aeab6786e8c95dd18012f2a8983437595f5"],["water","water-117fggi",144,"3102219885df1944dc834524f1b5157f9f5f59ece38d1ce0e6819be08a1be5bb","c0acb4e27c76e682beb5a1767805e57ee1c96c4da83428f5a58c122f1b852347","ddd3b7d55cb130f5e10bd8e74fc2ad83495b08ec15bc90ef115e25f5b0db2896"],["wetland","wetland-10lcy7c",5,"a5e70b34437d4bdaee1ae227cdb194c63e68bd95237e2a0ebedfe2bf659d00c8","0f6506d701ace0d0f51fc7c12325d3be5e4fdebb4889fdde665962095d882c7b","a654a0b4d9c383d78f00fecbdff47aeab6786e8c95dd18012f2a8983437595f5"],["water","water-13yirfb",216,"cbd3c72857742f509e7d2fbab7e89a6b7e3a55a8060b4ea124d2530c152486ad","ec66b245adcfff7c77a0f7875a5412631de64cdf790ccd125b7dbadf5efa362d","bb1ca0b5350a60ba59590af048f0af8ac8111327c673b6fa57c49589fc93f714"],["wetland","wetland-r6cwws",5,"a15cd2d0d32471faf8cb9e8e8a5e68152eab03a407cd9d3845410e9961470a28","810f31824ab1480b654fdaacbf0c28206189076612dd70def1971bca46428e6d","a654a0b4d9c383d78f00fecbdff47aeab6786e8c95dd18012f2a8983437595f5"],["water","water-1njpnq8",213,"f6ae241574bc284cfd860590f6b16c7ddbdb1dc1228f9bcdae820e8e665b3bcb","eab93a87c6d214e0a662b474daf9784161cbe6435eb2d0ffa6d8f2a4270c6c17","614e5227255ebc2d4ffcd6b8eefd3f6d733a55318ef8b90466f81a5b1b10136e"],["sand","sand-rqc4aq",5,"2c4f9ed5d8a01f15eee3e30a94b903373783aad0f38a425650c5007eb0f6cc3f","8cbd396802c7e6f8eab4a5ea13a8026d358d5bb8afcaea0fd738a06a3c8f2b3e","a654a0b4d9c383d78f00fecbdff47aeab6786e8c95dd18012f2a8983437595f5"],["sand","sand-hkfso0",11,"4ab9dc7e074e0b347e334f668bf728bde26ec3f3f6580fe5838050f667874a67","6a5b49d200ca5d0265e2eb377ee61817991d08c2b0bb8ca38aaf07c3c33690a3","94a251bcaaffd5f003c2b8d928d06dc3f2fe403016909309abed78fa8a1d4689"],["water","water-vu5uqd",161,"c294045529f348ed54a70c3a07146754eabb35a8057af02c0e5083b26e81401c","440c2474724dceff5407b61cb3983b182135e5dee7a985c4170eff6b788c84b4","ed7d8f4f855ec4f079ef0a735a7d79f0fc5253b0b2354a9439af5f40823a00ff"],["wetland","wetland-1lgyk07",5,"acd85cc74228fa6d189a08bb8677690667bacf71cd746324a25b09faec001f4c","50b427b210035cc41d8b0503d03ed29f32c2aacc451b069be32f0759f290cd6a","a654a0b4d9c383d78f00fecbdff47aeab6786e8c95dd18012f2a8983437595f5"],["wetland","wetland-8t49p3",5,"1e99171fbcbb89e240eea1803f41f259a20c5d9ab6ab8533defffb3b21e90d6a","fdfe2e0101e6aaadd597d26d3b3fc489b3d3cca7e25548bffb71754d451ff928","a654a0b4d9c383d78f00fecbdff47aeab6786e8c95dd18012f2a8983437595f5"],["water","water-w5zbh6",77,"3f76c576a37cff2c7a157a1538c3594c4ed09d85252ddd9841e61e773e2dd670","3461a243596f7fcdcf4ec5666b8dc1510cfa90c94e87abc4e0b044c9b69ce985","ea1e1d19569fe01c52dd52aa3db28584c54b8a3ef3964549dafd637ba40e977a"],["wetland","wetland-1jnn7yy",5,"5c6aee9898d035c1e197638d77fb993bc7a4c483befc9aec9264429296425310","587ae2b6623d2945c9461be0d3c39e17d18d14b2644789eabbc71ae8615a10fd","a654a0b4d9c383d78f00fecbdff47aeab6786e8c95dd18012f2a8983437595f5"],["wetland","wetland-1w5zyys",5,"ed3838f613b8c7459f5d9c668abd2424413e33f46bfd6c9180f6d73a3785d28e","c3bf354d6a0d9e460d35a1716c9771342b1149f8d7d4cba4b39539de85659ba1","a654a0b4d9c383d78f00fecbdff47aeab6786e8c95dd18012f2a8983437595f5"],["wetland","wetland-1l81pgn",5,"e7a6e563211c822af955ef4ac6dd7b63c6aaaa937fb6ccfbfcd40c92beaeb326","0288838555642413ebb8b4b272f220f8359849142980b667c9e551208db52933","a654a0b4d9c383d78f00fecbdff47aeab6786e8c95dd18012f2a8983437595f5"],["sand","sand-12x1da9",18,"ae939fa75711bcbdee83a7d1fec58fe2d5a7db60f8db50ec5208e1d187da752c","9bf6b95382aeb437baadb8be7c9a1b924db9d3eb499577ae2f2c6772690423b0","47ecba7accfdc6aaa4f820431ceaed9e1d57c9dcce3d4a59d9e859a0b7b6b3b1"]];
  try {
    const options = { cornerRadius: .4, cornerSegments: 4 }; cache.update(effective, course.width, course.height, options);
    const components = cache.update(presentation, course.width, course.height, options).components;
    const rows = [], hash = (data: Float32Array | Uint32Array) => createHash("sha256").update(Buffer.from(data.buffer, data.byteOffset, data.byteLength)).digest("hex");
    let totalIndices = 0;
    for (const component of components) {
      if (composable.isParklandComposableSemantic(component.terrain)) continue;
      const data = composable.buildParklandComposableMeshGeometry(component.presentationCells, course.width, 4, cell => cell,
        (_cell, x, y) => iso.worldToIso(x, y, landscape.sampleLandscapeSurfaceHeight(heightfield, component, x, y, true), 0), true);
      rows.push([component.terrain, component.topologyKey, component.presentationCells.length, hash(data.positions), hash(data.uvs), hash(data.indices)]);
      totalIndices += data.indices.length;
    }
    const order = (a: unknown[], b: unknown[]) => String(a[1]).localeCompare(String(b[1]));
    expect(rows.sort(order)).toEqual(expected.sort(order)); expect(rows).toHaveLength(29); expect(totalIndices).toBe(174816);
  } finally { cache.clear(); }
});
