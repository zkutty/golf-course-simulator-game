import * as PIXI from "pixi.js";
import { describe, expect, it, vi } from "vitest";
import { createOwnedAttributeMeshPair, createOwnedMacroMeshes } from "./ownedMacroGeometry";
import { destroySceneSubtree } from "./destroySceneSubtree";
import { OrderedMeshBoundsCohort } from "./orderedMeshBounds";

function grid(columns = 4, rows = 3) {
  const positions: number[] = [], uvs: number[] = [], indices: number[] = [];
  for (let y = 0; y <= rows; y++) for (let x = 0; x <= columns; x++) {
    positions.push(x * 1_000 + 0.125, y * 1_000 + 0.25);
    uvs.push(x / columns, y / rows);
  }
  for (let y = 0; y < rows; y++) for (let x = 0; x < columns; x++) {
    const tl = y * (columns + 1) + x, bl = tl + columns + 1;
    indices.push(tl, tl + 1, bl + 1, tl, bl + 1, bl);
  }
  return { positions, uvs, indices };
}

function texture() {
  return new PIXI.Texture({ source: new PIXI.BufferImageSource({
    resource: new Uint8Array(16), width: 2, height: 2,
  }) });
}

function originalGeometry(input: ReturnType<typeof grid>) {
  return new PIXI.MeshGeometry({
    positions: new Float32Array(input.positions), uvs: new Float32Array(input.uvs),
    indices: new Uint32Array(input.indices),
  });
}

function pair(textures: readonly [PIXI.Texture | null, PIXI.Texture | null]) {
  const input = grid();
  return createOwnedMacroMeshes(input.positions, input.uvs, input.indices, textures);
}

function bits(data: Float32Array | Uint32Array) {
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}

function appWithCanvas() {
  const app = new PIXI.Application();
  const canvas = { width: 800, height: 600 };
  const source = { resource: canvas, resolution: 1, _resolution: 1, pixelWidth: 800, pixelHeight: 600 };
  const target = { isRoot: true, colorTexture: source, resolution: 1, pixelWidth: 800, pixelHeight: 600 };
  const renderer = Object.create(PIXI.WebGLRenderer.prototype) as PIXI.WebGLRenderer;
  const pipe = Object.assign(Object.create(PIXI.MeshPipe.prototype), {
    renderer, _adaptor: Object.create(PIXI.GlMeshAdaptor.prototype),
  });
  Object.assign(renderer, {
    type: PIXI.RendererType.WEBGL,
    view: Object.assign(Object.create(PIXI.ViewSystem.prototype), {
      canvas, texture: { source, frame: { x: 0, y: 0, width: 800, height: 600 } },
      renderTarget: target, screen: { x: 0, y: 0, width: 800, height: 600 },
    }),
    renderGroup: Object.create(PIXI.RenderGroupSystem.prototype),
    renderTarget: Object.create(PIXI.RenderTargetSystem.prototype),
    globalUniforms: Object.create(PIXI.GlobalUniformSystem.prototype),
    renderPipes: { mesh: pipe }, _roundPixels: 0,
    gl: { VERTEX_SHADER: 35633, HIGH_FLOAT: 36338,
      getShaderPrecisionFormat: () => ({ precision: 23, rangeMin: 127, rangeMax: 127 }) },
  });
  (app as unknown as { renderer: PIXI.WebGLRenderer }).renderer = renderer;
  const world = app.stage.addChild(new PIXI.Container());
  const layer = world.addChild(new PIXI.Container());
  return { app, world, layer };
}

describe("owned macro attribute buffers in installed Pixi", () => {
  it("transfers private typed attributes and the first index array without copies", () => {
    const input = grid(), tex = texture();
    const data = { positions: new Float32Array(input.positions), uvs: new Float32Array(input.uvs),
      indices: new Uint32Array(input.indices) };
    const peers = createOwnedAttributeMeshPair(data, [tex, tex]);
    try {
      for (const mesh of peers) {
        expect(mesh!.geometry.positions).toBe(data.positions);
        expect(mesh!.geometry.uvs).toBe(data.uvs);
      }
      expect(peers[0]!.geometry.indices).toBe(data.indices);
      expect(peers[1]!.geometry.indices).not.toBe(data.indices);
      expect(bits(peers[1]!.geometry.indices)).toEqual(bits(data.indices));
    } finally { peers.forEach(mesh => mesh!.destroy()); tex.destroy(true); }
  });

  it("shares actual Buffer identities and exact original bytes, with independent indices", () => {
    const tex = texture(), input = grid(), original = originalGeometry(input);
    const [shadow, highlight] = createOwnedMacroMeshes(
      input.positions, input.uvs, input.indices, [tex, tex],
    );
    const left = shadow!.geometry, right = highlight!.geometry;
    try {
      expect(left).toBeInstanceOf(PIXI.MeshGeometry);
      expect(right).toBeInstanceOf(PIXI.MeshGeometry);
      expect(left).not.toBe(right);
      expect(left.indexBuffer).not.toBe(right.indexBuffer);
      expect(left.indices).not.toBe(right.indices);
      for (const name of ["aPosition", "aUV"]) {
        const a = left.getBuffer(name), b = right.getBuffer(name);
        expect(a).toBe(b);
        expect(a.uid).toBe(b.uid);
        expect(a).not.toBe(original.getBuffer(name));
        expect(left.getAttribute(name)).toEqual({ ...original.getAttribute(name), buffer: a });
      }
      for (const geometry of [left, right]) {
        expect(bits(geometry.positions)).toEqual(bits(original.positions));
        expect(bits(geometry.uvs)).toEqual(bits(original.uvs));
        expect(bits(geometry.indices)).toEqual(bits(original.indices));
        expect(geometry.buffers).toEqual([
          geometry.getBuffer("aPosition"), geometry.getBuffer("aUV"), geometry.indexBuffer,
        ]);
        expect(geometry.batchMode).toBe(original.batchMode);
        expect(geometry.topology).toBe(original.topology);
      }
      input.positions.fill(-999); input.uvs.fill(-999); input.indices.fill(0);
      expect(bits(left.positions)).toEqual(bits(original.positions));
      const rightVersion = right.indexBuffer._updateID;
      left.indices = new Uint32Array([0, 1, 6]);
      expect(right.indexBuffer._updateID).toBe(rightVersion);
      expect(bits(right.indices)).toEqual(bits(original.indices));
      right.indices = new Uint32Array([1, 2, 7]);
      expect([...left.indices]).toEqual([0, 1, 6]);
    } finally {
      shadow!.destroy(); highlight!.destroy(); original.destroy(true); tex.destroy(true);
    }
  });

  it("detaches and destroys only empty replacement buffers before publishing peers", () => {
    const empty: PIXI.Buffer[] = [];
    const add = PIXI.Geometry.prototype.addAttribute;
    const spy = vi.spyOn(PIXI.Geometry.prototype, "addAttribute").mockImplementation(function (this: PIXI.Geometry, name, option) {
      add.call(this, name, option);
      const buffer = this.getBuffer(name);
      if (buffer.data.length === 0) empty.push(buffer);
    });
    const tex = texture();
    let peers: ReturnType<typeof pair> = [null, null];
    try {
      peers = pair([tex, tex]);
      expect(empty).toHaveLength(2);
      for (const buffer of empty) {
        expect(buffer.destroyed).toBe(true);
        expect(buffer.listenerCount("update")).toBe(0);
        expect(buffer.listenerCount("change")).toBe(0);
        for (const peer of peers) expect(peer!.geometry.buffers).not.toContain(buffer);
      }
      for (const name of ["aPosition", "aUV"]) {
        const buffer = peers[0]!.geometry.getBuffer(name);
        expect(buffer.listenerCount("update")).toBe(2);
        expect(buffer.listenerCount("change")).toBe(2);
      }
    } finally {
      spy.mockRestore(); peers.forEach(peer => peer?.destroy()); tex.destroy(true);
    }
  });

  for (const first of [0, 1] as const) for (const direct of [false, true]) {
    it(`keeps peer ${1 - first} alive after ${direct ? "geometry.destroy(true)" : "Mesh.destroy()"}, then releases once`, () => {
      const tex = texture(), root = new PIXI.Container();
      const peers = pair([tex, tex]);
      peers.forEach(peer => root.addChild(peer!));
      const geometries = peers.map(peer => peer!.geometry);
      const shared = [geometries[0].getBuffer("aPosition"), geometries[0].getBuffer("aUV")];
      const indices = geometries.map(geometry => geometry.indexBuffer);
      const sharedDestroy = shared.map(buffer => vi.spyOn(buffer, "destroy"));
      const indexDestroy = indices.map(buffer => vi.spyOn(buffer, "destroy"));
      const textureDestroy = vi.spyOn(tex, "destroy"), sourceDestroy = vi.spyOn(tex.source, "destroy");
      try {
        if (direct) { geometries[first].destroy(true); geometries[first].destroy(true); }
        else peers[first]!.destroy();
        expect(indices[first].destroyed).toBe(true);
        expect(indices[1 - first].destroyed).toBe(false);
        const survivor = peers[1 - first]!;
        for (const buffer of shared) {
          expect(buffer.destroyed).toBe(false);
          expect(buffer.listenerCount("update")).toBe(1);
          expect(buffer.listenerCount("change")).toBe(1);
        }
        const update = vi.fn(); survivor.geometry.on("update", update);
        shared[0].update(); expect(update).toHaveBeenCalledOnce();
        expect(survivor.getBounds().width).toBe(4_000);
        expect(survivor.geometry.positions.length).toBe(40);
        destroySceneSubtree(root); destroySceneSubtree(root);
        for (const geometry of geometries) geometry.destroy(true);
        for (const spy of [...sharedDestroy, ...indexDestroy]) expect(spy).toHaveBeenCalledOnce();
        for (const buffer of shared) {
          expect(buffer.destroyed).toBe(true);
          expect(buffer.listenerCount("update")).toBe(0);
          expect(buffer.listenerCount("change")).toBe(0);
        }
        expect(textureDestroy).not.toHaveBeenCalled(); expect(sourceDestroy).not.toHaveBeenCalled();
      } finally { destroySceneSubtree(root); tex.destroy(true); }
    });
  }

  for (const slot of [0, 1] as const) {
    it(`allocates one attribute pair when only texture ${slot} exists`, () => {
      const tex = texture();
      const peers = pair(slot === 0 ? [tex, null] : [null, tex]);
      const live = peers[slot]!, geometry = live.geometry;
      const attributes = [geometry.getBuffer("aPosition"), geometry.getBuffer("aUV")];
      expect(peers[1 - slot]).toBeNull();
      for (const buffer of attributes) expect(buffer.listenerCount("update")).toBe(1);
      live.destroy(); geometry.destroy(true);
      for (const buffer of attributes) expect(buffer.destroyed).toBe(true);
      expect(tex.destroyed).toBe(false); tex.destroy(true);
    });
  }

  it("allocates no geometry for no textures and retires completed/pending peers on partial failure", () => {
    const attributeCreation = vi.spyOn(PIXI.Geometry.prototype, "addAttribute");
    expect(pair([null, null])).toEqual([null, null]);
    expect(attributeCreation).not.toHaveBeenCalled(); attributeCreation.mockRestore();
    const tex = texture(), bad = texture();
    const buffers: PIXI.Buffer[] = [];
    const addIndex = PIXI.Geometry.prototype.addIndex;
    const add = PIXI.Geometry.prototype.addAttribute;
    const attributes = vi.spyOn(PIXI.Geometry.prototype, "addAttribute").mockImplementation(function (this: PIXI.Geometry, name, option) {
      add.call(this, name, option); buffers.push(this.getBuffer(name));
    });
    const index = vi.spyOn(PIXI.Geometry.prototype, "addIndex").mockImplementation(function (this: PIXI.Geometry, buffer) {
      addIndex.call(this, buffer); buffers.push(this.indexBuffer);
    });
    const setTexture = Object.getOwnPropertyDescriptor(PIXI.Mesh.prototype, "texture")!.set!;
    const setter = vi.spyOn(PIXI.Mesh.prototype, "texture", "set").mockImplementation(function (this: PIXI.Mesh, value) {
      if (value === bad) throw new Error("injected second mesh initialization failure");
      setTexture.call(this, value);
    });
    try {
      expect(() => pair([tex, bad])).toThrow("injected second mesh initialization failure");
      expect(new Set(buffers).size).toBe(6); // shared pair, two indices, two empty attributes
      for (const buffer of new Set(buffers)) {
        expect(buffer.destroyed).toBe(true);
        expect(buffer.listenerCount("update")).toBe(0);
        expect(buffer.listenerCount("change")).toBe(0);
      }
      expect(tex.destroyed).toBe(false); expect(bad.destroyed).toBe(false);
    } finally {
      setter.mockRestore(); attributes.mockRestore(); index.mockRestore(); tex.destroy(true); bad.destroy(true);
    }
  });

  it("releases shared and private placeholders when the second peer attribute attachment fails", () => {
    const tex = texture(), allocated = new Set<PIXI.Buffer>();
    const add = PIXI.Geometry.prototype.addAttribute;
    const addIndex = PIXI.Geometry.prototype.addIndex;
    const index = vi.spyOn(PIXI.Geometry.prototype, "addIndex").mockImplementation(function (this: PIXI.Geometry, buffer) {
      addIndex.call(this, buffer); allocated.add(this.indexBuffer);
    });
    const attributes = vi.spyOn(PIXI.Geometry.prototype, "addAttribute").mockImplementation(function (this: PIXI.Geometry, name, option) {
      // Constructor adds the two empty attributes first. Fail when the first
      // real shared attribute is attached, leaving the other private empty UV.
      const buffer = (option as { buffer: PIXI.Buffer }).buffer;
      if (name === "aPosition" && allocated.has(buffer)) throw new Error("injected attribute attachment failure");
      add.call(this, name, option); allocated.add(this.getBuffer(name));
    });
    try {
      expect(() => pair([tex, tex])).toThrow("injected attribute attachment failure");
      expect(allocated.size).toBe(6);
      for (const buffer of allocated) {
        expect(buffer.destroyed).toBe(true);
        expect(buffer.listenerCount("update")).toBe(0);
        expect(buffer.listenerCount("change")).toBe(0);
      }
      expect(tex.destroyed).toBe(false);
    } finally { attributes.mockRestore(); index.mockRestore(); tex.destroy(true); }
  });

  it("registers/reconciles both peers with the unchanged real cohort and root guard", () => {
    const tex = texture(), { app, world, layer } = appWithCanvas();
    const [shadow, highlight] = pair([tex, tex]);
    const peers = [shadow!, highlight!];
    const cohort = new OrderedMeshBoundsCohort();
    try {
      for (const mesh of peers) {
        mesh.geometry.batchMode = "no-batch"; layer.addChild(mesh);
        expect(cohort.registerMacro(mesh, 4, 3)).toBe(true);
      }
      const originals = peers.map(mesh => mesh.geometry.indices);
      cohort.reconcile(app, world);
      for (const mesh of peers) expect([...mesh.geometry.indices]).toEqual([...originals[0].slice(0, 6)]);
      expect(shadow!.geometry.indices).not.toBe(highlight!.geometry.indices);
      const versions = peers.map(mesh => mesh.geometry.indexBuffer._updateID);
      cohort.reconcile(app, world);
      expect(peers.map(mesh => mesh.geometry.indexBuffer._updateID)).toEqual(versions);
      world.rotation = 0.01; cohort.reconcile(app, world);
      peers.forEach((mesh, slot) => expect(mesh.geometry.indices).toBe(originals[slot]));
      world.rotation = 0; cohort.reconcile(app, world);
      shadow!.destroy();
      expect(() => cohort.reconcile(app, world)).not.toThrow();
      expect(highlight!.geometry.getBuffer("aPosition").destroyed).toBe(false);
      cohort.dispose(); expect(highlight!.geometry.indices).toBe(originals[1]);
    } finally { cohort.dispose(); destroySceneSubtree(app.stage); tex.destroy(true); }
  });

  it("uses the installed GlBufferSystem to count one attribute upload pair versus two originally", () => {
    // Fake GL records API calls only; this is not a GPU performance measurement.
    class BufferSystem extends PIXI.GlBufferSystem { connect() { this.contextChange(); } }
    const uploads: number[] = [];
    const gl = { createBuffer: () => ({}), bindBuffer: vi.fn(), deleteBuffer: vi.fn(),
      bufferSubData: vi.fn(), bufferData: (_target: number, data: ArrayBufferView) => uploads.push(data.byteLength),
      STATIC_DRAW: 35044, DYNAMIC_DRAW: 35048 };
    const renderer = { gl, limits: { maxUniformBindings: 16 },
      renderableGC: { addManagedHash: vi.fn() } } as unknown as PIXI.WebGLRenderer;
    const system = new BufferSystem(renderer); system.connect();
    const input = grid(), baseline = [originalGeometry(input), originalGeometry(input)];
    const tex = texture(), peers = pair([tex, tex]);
    const upload = (geometries: PIXI.MeshGeometry[]) => {
      for (const geometry of geometries) for (const name of ["aPosition", "aUV"]) {
        system.updateBuffer(geometry.getBuffer(name));
      }
    };
    try {
      upload(baseline); expect(uploads).toHaveLength(4);
      const baselineBytes = uploads.reduce((sum, bytes) => sum + bytes, 0);
      uploads.length = 0;
      upload(peers.map(peer => peer!.geometry)); expect(uploads).toHaveLength(2);
      expect(uploads.reduce((sum, bytes) => sum + bytes, 0) * 2).toBe(baselineBytes);
      upload(peers.map(peer => peer!.geometry)); expect(uploads).toHaveLength(2);
      peers[0]!.destroy();
      upload([peers[1]!.geometry]); expect(uploads).toHaveLength(2);
      expect(gl.bufferSubData).not.toHaveBeenCalled();
    } finally {
      peers.forEach(peer => { if (!peer!.destroyed) peer!.destroy(); });
      baseline.forEach(geometry => geometry.destroy(true)); system.destroy(); tex.destroy(true);
    }
  });
});
