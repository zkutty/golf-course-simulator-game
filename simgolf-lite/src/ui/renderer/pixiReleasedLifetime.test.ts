import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as PIXI from "pixi.js";
import { destroySceneSubtree } from "./destroySceneSubtree";

function contextSystem() {
  // Both public registration ports let the same lifecycle predicate run against
  // the frozen old library without failing at fixture setup.
  return new PIXI.GraphicsContextSystem({
    uid: 703,
    gc: { now: 0, addResourceHash: vi.fn() },
    renderableGC: { addManagedHash: vi.fn() },
  } as unknown as ConstructorParameters<typeof PIXI.GraphicsContextSystem>[0]);
}

beforeEach(() => {
  // Shader source construction needs a precision probe, not an actual GL context.
  vi.spyOn(PIXI.DOMAdapter.get(), "createCanvas").mockReturnValue({
    getContext: () => null,
  } as unknown as ReturnType<ReturnType<typeof PIXI.DOMAdapter.get>["createCanvas"]>);
});
afterEach(() => vi.restoreAllMocks());

describe("released Pixi public lifecycle", () => {
  it("clears populated owned graphics payloads held by returned batch aliases over twelve scenes", () => {
    const system = contextSystem();
    for (let cycle = 0; cycle < 12; cycle++) {
      const root = new PIXI.Container();
      const graphic = root.addChild(new PIXI.Graphics().rect(0, 0, 8 + cycle, 8).fill(0x123456));
      const gpu = system.updateGpuContext(graphic.context);
      const data = gpu.geometryData;
      const arrays = [data.vertices, data.uvs, data.indices];
      const aliases = [...gpu.batches];
      expect(aliases.length).toBeGreaterThan(0);
      for (const array of arrays) expect(array.length).toBeGreaterThan(0);
      expect(aliases.every((batch) => batch.geometryData === data)).toBe(true);
      const destroy = vi.spyOn(graphic.context, "destroy");
      destroySceneSubtree(root); destroySceneSubtree(root);
      expect(destroy).toHaveBeenCalledExactlyOnceWith(undefined);
      for (const array of arrays) expect(array).toHaveLength(0);
      // Returned wrappers release all obsolete references; captured arrays are empty above.
      expect(aliases.every((batch) => [batch.geometryData, batch.texture, batch._batcher, batch._batch].every((reference) => reference === null))).toBe(true);
    }
    system.destroy();
  });

  it("preserves borrowed current graphics data until its actual context owner disposes it", () => {
    const system = contextSystem();
    const context = new PIXI.GraphicsContext().rect(0, 0, 8, 8).fill(0xffffff);
    const current = new PIXI.Graphics({ context });
    const retired = new PIXI.Graphics({ context });
    const root = new PIXI.Container(); root.addChild(retired);
    const gpu = system.updateGpuContext(context), data = gpu.geometryData;
    const destroy = vi.spyOn(context, "destroy");
    destroySceneSubtree(root);
    expect(destroy).not.toHaveBeenCalled();
    expect(data.vertices.length).toBeGreaterThan(0);
    context.rect(10, 0, 4, 4).fill(0xff0000);
    const updated = system.updateGpuContext(context);
    expect(updated.geometryData).toBe(data);
    expect(updated.geometryData.vertices.length).toBeGreaterThan(8);
    expect(current.context).toBe(context); expect(current.destroyed).toBe(false);
    destroySceneSubtree(current);
    expect(destroy).not.toHaveBeenCalled();
    context.destroy();
    expect(destroy).toHaveBeenCalledTimes(1);
    expect(data.vertices).toHaveLength(0); expect(data.uvs).toHaveLength(0); expect(data.indices).toHaveLength(0);
    system.destroy();
  });

  it("tears down each group's cached batcher once while another live group remains usable", () => {
    const adaptor = { start: vi.fn(), execute: vi.fn() };
    const renderer = {
      uid: 704, limits: { maxBatchableTextures: 4 }, _roundPixels: 0,
      renderableGC: { addManagedHash: vi.fn() },
      renderPipes: {} as Record<string, unknown>,
    };
    const pipe = new PIXI.BatcherPipe(renderer as unknown as ConstructorParameters<typeof PIXI.BatcherPipe>[0], adaptor);
    const spritePipe = new PIXI.SpritePipe(renderer as unknown as ConstructorParameters<typeof PIXI.SpritePipe>[0]);
    renderer.renderPipes.batch = pipe; renderer.renderPipes.sprite = spritePipe;
    const texture = new PIXI.Texture({ source: new PIXI.TextureSource({ width: 1, height: 1 }) });
    function build(root: PIXI.Container) {
      root.enableRenderGroup();
      const instructions = root.renderGroup!.instructionSet;
      instructions.renderPipes = renderer.renderPipes as unknown as typeof instructions.renderPipes;
      PIXI.updateRenderGroupTransforms(root.renderGroup!, true);
      const sprite = root.children[0] as PIXI.Sprite;
      instructions.reset(); pipe.buildStart(instructions);
      spritePipe.addRenderable(sprite, instructions); pipe.buildEnd(instructions);
      const batch = instructions.instructions[0] as PIXI.Batch;
      expect(batch.size).toBeGreaterThan(0);
      pipe.execute(batch);
      return { instructions, batcher: batch.batcher };
    }
    const live = new PIXI.Container(); live.addChild(new PIXI.Sprite(texture));
    const current = build(live), sharedShader = current.batcher.shader;
    const currentDestroy = vi.spyOn(current.batcher, "destroy");
    const shaderDestroy = vi.spyOn(sharedShader, "destroy");
    const hook = typeof pipe.destroyInstructionSet === "function"
      ? vi.spyOn(pipe, "destroyInstructionSet") : undefined;
    for (let cycle = 0; cycle < 12; cycle++) {
      const retiring = new PIXI.Container(); retiring.addChild(new PIXI.Sprite(texture));
      const old = build(retiring), destroy = vi.spyOn(old.batcher, "destroy");
      const geometry = old.batcher.geometry, geometryDestroy = vi.spyOn(geometry, "destroy");
      destroySceneSubtree(retiring); destroySceneSubtree(retiring);
      expect(destroy).toHaveBeenCalledExactlyOnceWith();
      expect(hook?.mock.calls.filter(([set]) => set === old.instructions) ?? []).toHaveLength(1);
      expect(geometryDestroy).toHaveBeenCalledExactlyOnceWith(true);
      expect(old.batcher.geometry).toBeNull();
      expect(currentDestroy).not.toHaveBeenCalled(); expect(shaderDestroy).not.toHaveBeenCalled();
      expect(build(live).batcher).toBe(current.batcher);
      expect(current.batcher.geometry).not.toBeNull(); expect(current.batcher.shader).toBe(sharedShader);
      expect(texture.destroyed).toBe(false);
    }
    expect(adaptor.execute).toHaveBeenCalledTimes(25);
    destroySceneSubtree(live);
    expect(currentDestroy).toHaveBeenCalledExactlyOnceWith();
    expect(shaderDestroy).not.toHaveBeenCalled();
    spritePipe.destroy(); pipe.destroy(); texture.destroy(true);
  });
});
