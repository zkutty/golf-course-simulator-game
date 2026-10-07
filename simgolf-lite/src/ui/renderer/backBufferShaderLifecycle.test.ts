import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DOMAdapter, GlBackBufferSystem, GlProgram, Shader, Texture } from "pixi.js";

type OwnedFields = { _bigTriangleShader: Shader | null; _backBufferTexture: { destroy(): void } | null };
const fields = (system: GlBackBufferSystem) => system as unknown as OwnedFields;
const renderer = () => ({ context: { supports: { msaa: true } } }) as unknown as ConstructorParameters<typeof GlBackBufferSystem>[0];
const adapter = DOMAdapter.get();
const white = Texture.WHITE.source;
const heldShaders: Shader[] = [];
function initialized(useBackBuffer = false) {
  const system = new GlBackBufferSystem(renderer());
  system.init({ useBackBuffer, antialias: false });
  const shader = fields(system)._bigTriangleShader!;
  heldShaders.push(shader);
  return { system, shader, program: shader.glProgram! };
}

beforeEach(() => {
  // The actual CPU-side GlProgram initializer tolerates an unavailable WebGL test context.
  DOMAdapter.set({ ...adapter, createCanvas: (() => ({ getContext: () => null })) as unknown as typeof adapter.createCanvas });
});
afterEach(() => {
  vi.restoreAllMocks();
  // Ensure an intentionally red unpatched run cannot contaminate later test baselines.
  for (const shader of heldShaders.splice(0)) shader.destroy(true);
  DOMAdapter.set(adapter);
});

describe("per-renderer back-buffer shader lifetime", () => {
  it("releases four WHITE subscriptions even when the back buffer was never used", () => {
    const baseline = white.listenerCount("change");
    for (let cycle = 0; cycle < 4; cycle++) {
      const { system, shader, program } = initialized(false);
      expect(white.listenerCount("change")).toBe(baseline + 1);
      system.destroy();
      system.destroy();
      expect(white.listenerCount("change")).toBe(baseline);
      expect(fields(system)._bigTriangleShader).toBeNull();
      expect(program.vertex).toBeNull();
      expect(program.fragment).toBeNull();
      expect(shader.resources).toBeNull();
    }
    expect(white.destroyed).not.toBe(true);
  });

  it("preserves a simultaneous owner, a cached program, and an unrelated WHITE listener", () => {
    const baseline = white.listenerCount("change");
    const options = {
      vertex: "attribute vec2 aPosition; void main(){gl_Position=vec4(aPosition,0.0,1.0);}",
      fragment: "// back-buffer shared-survivor test\nvoid main(){gl_FragColor=vec4(1.0);}",
      name: "back-buffer-shared-survivor-test",
    };
    const sharedProgram = GlProgram.from(options);
    const cachedVertex = sharedProgram.vertex;
    const cachedFragment = sharedProgram.fragment;
    const survivor = new Shader({ glProgram: sharedProgram, resources: { uTexture: white } });
    let changes = 0;
    const listener = () => { changes++; };
    white.on("change", listener);
    try {
      const first = initialized();
      const second = initialized();
      expect(first.program).not.toBe(second.program);
      expect(first.program).not.toBe(sharedProgram);
      first.system.destroy();
      expect(white.listenerCount("change")).toBe(baseline + 3);
      expect(second.program.vertex).not.toBeNull();
      expect(sharedProgram.vertex).toBe(cachedVertex);
      expect(sharedProgram.fragment).toBe(cachedFragment);
      expect(GlProgram.from(options)).toBe(sharedProgram);
      white.emit("change", white);
      expect(changes).toBe(1);
      expect(survivor.resources.uTexture).toBe(white);
      expect(white.destroyed).not.toBe(true);
      second.system.destroy();
      expect(white.listenerCount("change")).toBe(baseline + 2);
    } finally {
      survivor.destroy(false);
      white.off("change", listener);
      sharedProgram.destroy();
    }
    expect(white.listenerCount("change")).toBe(baseline);
  });

  it("keeps texture-before-shader cleanup and releases ownership once", () => {
    const baseline = white.listenerCount("change");
    const { system, shader } = initialized(true);
    const order: string[] = [];
    const textureDestroy = vi.fn(() => { order.push("texture"); });
    fields(system)._backBufferTexture = { destroy: textureDestroy };
    shader.on("destroy", () => { order.push("shader"); });
    system.destroy();
    system.destroy();
    expect(order).toEqual(["texture", "shader"]);
    expect(textureDestroy).toHaveBeenCalledTimes(1);
    expect(fields(system)._backBufferTexture).toBeNull();
    expect(white.listenerCount("change")).toBe(baseline);
  });

  it.each([null, undefined, false, 0, "", new Error("texture failure")])("attempts shader cleanup after a texture failure and preserves its exact value (%s)", (failure) => {
    const baseline = white.listenerCount("change");
    const { system, shader } = initialized(true);
    const order: string[] = [];
    fields(system)._backBufferTexture = { destroy() { order.push("texture"); throw failure; } };
    shader.on("destroy", () => { order.push("shader"); });
    let threw = false;
    let primary: unknown;
    try { system.destroy(); } catch (error) { threw = true; primary = error; }
    expect(threw).toBe(true);
    expect(primary).toBe(failure);
    expect(order).toEqual(["texture", "shader"]);
    expect(white.listenerCount("change")).toBe(baseline);
    expect(fields(system)._backBufferTexture).toBeNull();
    expect(fields(system)._bigTriangleShader).toBeNull();
    expect(() => system.destroy()).not.toThrow();
  });

  it("preserves the texture failure if the independent shader disposal also fails", () => {
    const { system, shader } = initialized(true);
    fields(system)._backBufferTexture = { destroy() { throw undefined; } };
    const actualDestroy = shader.destroy.bind(shader);
    vi.spyOn(shader, "destroy").mockImplementation((destroyPrograms) => {
      actualDestroy(destroyPrograms);
      throw new Error("secondary shader failure");
    });
    let threw = false;
    let primary: unknown;
    try { system.destroy(); } catch (error) { threw = true; primary = error; }
    expect(threw).toBe(true);
    expect(primary).toBeUndefined();
    expect(() => system.destroy()).not.toThrow();
  });

  it("reports a shader-only failure after still disposing the optional texture", () => {
    const { system, shader } = initialized(true);
    const textureDestroy = vi.fn();
    fields(system)._backBufferTexture = { destroy: textureDestroy };
    const actualDestroy = shader.destroy.bind(shader);
    vi.spyOn(shader, "destroy").mockImplementation((destroyPrograms) => {
      actualDestroy(destroyPrograms);
      throw null;
    });
    let threw = false;
    let primary: unknown;
    try { system.destroy(); } catch (error) { threw = true; primary = error; }
    expect(threw).toBe(true);
    expect(primary).toBeNull();
    expect(textureDestroy).toHaveBeenCalledTimes(1);
    expect(() => system.destroy()).not.toThrow();
  });

  it("can destroy an uninitialized or partly initialized owner twice", () => {
    const system = new GlBackBufferSystem(renderer());
    expect(() => system.destroy()).not.toThrow();
    expect(() => system.destroy()).not.toThrow();
    const failedRenderer = { context: { supports: { get msaa(): boolean { throw null; } } } } as unknown as ConstructorParameters<typeof GlBackBufferSystem>[0];
    const failedSystem = new GlBackBufferSystem(failedRenderer);
    let failed = false;
    try { failedSystem.init({ useBackBuffer: false, antialias: false }); } catch (error) { failed = true; expect(error).toBeNull(); }
    expect(failed).toBe(true);
    expect(() => failedSystem.destroy()).not.toThrow();
    expect(() => failedSystem.destroy()).not.toThrow();
  });
});
