import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as PIXI from "pixi.js";

beforeEach(() => {
  vi.spyOn(PIXI.DOMAdapter.get(), "createCanvas").mockReturnValue({
    getContext: () => null,
  } as unknown as ReturnType<ReturnType<typeof PIXI.DOMAdapter.get>["createCanvas"]>);
});
afterEach(() => vi.restoreAllMocks());

function host() {
  const renderPipes: Record<string, unknown> = {};
  const renderer = {
    uid: 817143, limits: { maxBatchableTextures: 4 }, _roundPixels: 0,
    renderableGC: { addManagedHash: vi.fn() },
    runners: { contextChange: { add: vi.fn() } }, renderPipes,
    graphicsContext: undefined as PIXI.GraphicsContextSystem | undefined,
  };
  const context = new PIXI.GraphicsContextSystem(renderer as unknown as ConstructorParameters<typeof PIXI.GraphicsContextSystem>[0]);
  renderer.graphicsContext = context;
  const batch = new PIXI.BatcherPipe(renderer as unknown as ConstructorParameters<typeof PIXI.BatcherPipe>[0], { start: vi.fn(), execute: vi.fn() });
  const graphics = new PIXI.GraphicsPipe(renderer as unknown as ConstructorParameters<typeof PIXI.GraphicsPipe>[0], { destroy: vi.fn() } as unknown as ConstructorParameters<typeof PIXI.GraphicsPipe>[1]);
  renderPipes.batch = batch;
  renderPipes.graphics = graphics;
  return { renderer, context, batch, graphics };
}

const references = (batch: PIXI.BatchableGraphics) => [batch.texture, batch.geometryData, batch._batcher, batch._batch];
const payload = (context: ReturnType<PIXI.GraphicsContextSystem["getGpuContext"]>) => ({
  vertices: [...context.geometryData.vertices], uvs: [...context.geometryData.uvs], indices: [...context.geometryData.indices],
});

it("releases retired context payload references without destroying shared textures or live geometry", () => {
  const h = host();
  const texture = new PIXI.Texture({ source: new PIXI.TextureSource({ width: 16, height: 16 }) });
  const survivor = new PIXI.GraphicsContext().rect(0, 0, 8, 8).fill({ texture });
  const live = h.context.updateGpuContext(survivor);
  const livePayload = payload(live);
  const liveRefs = live.batches.map(references);
  const textureDestroy = vi.spyOn(texture, "destroy");
  try {
    for (let cycle = 0; cycle < 12; cycle++) {
      const retiring = new PIXI.GraphicsContext().rect(10, 10, 7, 6).fill({ texture });
      const gpu = h.context.updateGpuContext(retiring);
      const aliases = [...gpu.batches];
      const before = payload(gpu);
      expect(aliases.length).toBeGreaterThan(0);
      expect(before.vertices.length).toBeGreaterThan(0);
      expect(aliases.every(batch => batch.geometryData === gpu.geometryData)).toBe(true);
      retiring.destroy();
      expect(aliases.map(batch => references(batch).every(ref => ref === null))).toEqual(aliases.map(() => true));
      expect(payload(live)).toEqual(livePayload);
      live.batches.forEach((batch, i) => references(batch).forEach((ref, j) => expect(ref).toBe(liveRefs[i][j])));
      const replacement = new PIXI.GraphicsContext().rect(10, 10, 7, 6).fill({ texture });
      const next = h.context.updateGpuContext(replacement);
      expect(next.batches.some(batch => aliases.includes(batch))).toBe(true);
      expect(payload(next)).toEqual(before);
      replacement.rect(30, 30, 5, 5).fill({ texture });
      expect(h.context.updateGpuContext(replacement).geometryData.vertices.length).toBeGreaterThan(before.vertices.length);
      replacement.destroy();
    }
    expect(textureDestroy).not.toHaveBeenCalled();
    expect(texture.source.destroyed).toBe(false);
  } finally {
    survivor.destroy(); h.context.destroy(); h.graphics.destroy(); h.batch.destroy(); texture.destroy(true);
  }
});

it("returns populated display batch clones while a sibling sharing the context stays usable", () => {
  const h = host();
  const context = new PIXI.GraphicsContext().rect(0, 0, 8, 8).fill(0xff0000);
  context.batchMode = "batch";
  const contextDestroy = vi.spyOn(context, "destroy");
  const live = new PIXI.Graphics({ context });
  const retired = new PIXI.Graphics({ context });
  const sets: PIXI.InstructionSet[] = [];
  const build = (graphic: PIXI.Graphics) => {
    const set = new PIXI.InstructionSet(); sets.push(set);
    h.batch.buildStart(set); h.graphics.addRenderable(graphic, set); h.batch.buildEnd(set);
    h.graphics.updateRenderable(graphic);
    expect(set.instructionSize).toBeGreaterThan(0);
    return [...(graphic as unknown as { _gpuData: Record<number, { batches: PIXI.BatchableGraphics[] }> })._gpuData[h.renderer.uid].batches];
  };
  let replacement: PIXI.Graphics | undefined;
  try {
    const aliases = build(retired);
    const sibling = build(live), before = sibling.map(references);
    expect(aliases.every(batch => references(batch).every(ref => ref != null))).toBe(true);
    retired.destroy();
    expect(contextDestroy).not.toHaveBeenCalled();
    expect(aliases.map(batch => references(batch).every(ref => ref === null))).toEqual(aliases.map(() => true));
    sibling.forEach((batch, i) => references(batch).forEach((ref, j) => expect(ref).toBe(before[i][j])));
    h.graphics.updateRenderable(live);
    replacement = new PIXI.Graphics({ context });
    const checkedOut = build(replacement);
    expect(checkedOut.some(batch => aliases.includes(batch))).toBe(true);
    expect(checkedOut.every(batch => references(batch).every(ref => ref != null))).toBe(true);
    context.rect(20, 0, 4, 4).fill(0x00ff00);
    expect(build(live).length).toBeGreaterThan(0);
    expect(h.context.getGpuContext(context).geometryData.vertices.length).toBeGreaterThan(8);
  } finally {
    retired.destroy(); live.destroy(); replacement?.destroy(); context.destroy();
    for (const set of sets) set.destroy();
    h.context.destroy(); h.graphics.destroy(); h.batch.destroy();
  }
});
