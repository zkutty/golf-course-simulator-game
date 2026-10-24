import { createRequire } from "node:module";
import * as PIXI from "pixi.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const implementations = [
  ["esm", PIXI],
  ["cjs", createRequire(import.meta.url)("pixi.js") as typeof PIXI],
] as const;

beforeEach(() => {
  for (const [, pixi] of implementations) {
    vi.spyOn(pixi.DOMAdapter.get(), "createCanvas").mockReturnValue({
      getContext: () => null,
    } as unknown as ReturnType<ReturnType<typeof pixi.DOMAdapter.get>["createCanvas"]>);
  }
});
afterEach(() => vi.restoreAllMocks());

for (const [format, pixi] of implementations) {
  describe(`installed Pixi ${format} renderer cache identities`, () => {
    it("keeps sequential real renderer identities unique and outside array-index storage", () => {
      const ids: number[] = [];
      for (let cycle = 0; cycle < 128; cycle++) {
        const renderer = new pixi.WebGLRenderer();
        try {
          const probe: unknown[] = [];
          Reflect.set(probe, renderer.uid, renderer);
          expect(probe.length).toBe(0);
          expect(Number.isSafeInteger(renderer.uid)).toBe(true);
          expect(renderer.uid).toBeGreaterThan(0);
          expect(probe[renderer.uid]).toBe(renderer);
          ids.push(renderer.uid);
        } finally {
          renderer.destroy({ releaseGlobalResources: false });
        }
      }
      expect(new Set(ids).size).toBe(ids.length);
      ids.slice(1).forEach((id, index) => expect(id).toBeGreaterThan(ids[index]));
    });

    for (const order of [[0, 1], [1, 0]] as const) {
      it(`isolates two real renderer owners in insertion/disposal order ${order.join(",")}`, () => {
        const source = new pixi.BufferImageSource({ resource: new Uint8Array(16), width: 2, height: 2 });
        const texture = new pixi.Texture({ source });
        const sprite = new pixi.Sprite(texture);
        const textureDestroy = vi.spyOn(texture, "destroy");
        const sourceDestroy = vi.spyOn(source, "destroy");
        // Construct actual owners and exercise CPU batching without a browser GL context.
        const owners = Array.from({ length: 2 }, () => {
          const renderer = new pixi.WebGLRenderer();
          renderer._roundPixels = 0;
          renderer.limits = new pixi.GlLimitsSystem(renderer);
          renderer.limits.maxBatchableTextures = 4;
          const batch = new pixi.BatcherPipe(renderer, { start: () => {}, execute: () => {} });
          const sprites = new pixi.SpritePipe(renderer);
          renderer.renderPipes.batch = batch;
          renderer.runners.destroy.add(sprites);
          renderer.runners.destroy.add(batch);
          return { renderer, batch, sprites, instructions: new pixi.InstructionSet(), destroyed: false };
        });
        const build = (owner: typeof owners[number]) => {
          const set = owner.instructions;
          set.reset();
          owner.batch.buildStart(set);
          owner.sprites.addRenderable(sprite, set);
          owner.batch.buildEnd(set);
          expect(set.instructionSize).toBeGreaterThan(0);
          return sprite._gpuData[owner.renderer.uid] as PIXI.BatchableSprite;
        };
        try {
          const aliases = new Map<number, PIXI.BatchableSprite>();
          for (const index of order) aliases.set(index, build(owners[index]));
          const [first, second] = order;
          expect(owners[first].renderer.uid).not.toBe(owners[second].renderer.uid);
          expect(aliases.get(first)).not.toBe(aliases.get(second));
          expect(Object.keys(sprite._gpuData).sort()).toEqual(owners.map(owner => String(owner.renderer.uid)).sort());
          const peer = aliases.get(second)!;
          const peerBatcher = peer._batcher;
          owners[first].renderer.destroy({ releaseGlobalResources: false });
          owners[first].destroyed = true;
          expect(sprite._gpuData[owners[second].renderer.uid]).toBe(peer);
          expect(peer.renderable).toBe(sprite);
          expect(peer.texture).toBe(texture);
          expect(peer._batcher).toBe(peerBatcher);
          expect(peerBatcher.attributeBuffer.float32View[peer._attributeStart]).toBe(0);
          sprite.x = 7;
          sprite.updateLocalTransform();
          sprite.groupTransform.copyFrom(sprite.localTransform);
          owners[second].sprites.updateRenderable(sprite);
          expect(peerBatcher.attributeBuffer.float32View[peer._attributeStart]).toBe(7);
          expect(build(owners[second])).toBe(peer);
          expect(textureDestroy).not.toHaveBeenCalled();
          expect(sourceDestroy).not.toHaveBeenCalled();
          expect(source.destroyed).toBe(false);
        } finally {
          for (const owner of owners) if (!owner.destroyed) owner.renderer.destroy({ releaseGlobalResources: false });
          sprite.destroy();
          for (const owner of owners) owner.instructions.destroy();
          texture.destroy(true);
          vi.restoreAllMocks();
        }
      });
    }
  });
}
