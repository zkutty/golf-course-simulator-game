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
  describe(`installed Pixi ${format} batch storage lifetime`, () => {
    it("releases consumed scratch storage across large/small and split passes while preserving packed output and a live peer", () => {
      const source = new pixi.TextureSource({ width: 2, height: 2 });
      const texture = new pixi.Texture({ source });
      const sprite = new pixi.Sprite(texture);
      const textureDestroy = vi.spyOn(texture, "destroy");
      const sourceDestroy = vi.spyOn(source, "destroy");
      const batcher = new pixi.DefaultBatcher({ maxTextures: 4 });
      const peer = new pixi.DefaultBatcher({ maxTextures: 4 });
      const instructions = new pixi.InstructionSet();
      const peerInstructions = new pixi.InstructionSet();
      const elements = Array.from({ length: 512 }, (_, index) => {
        const element = new pixi.BatchableSprite();
        element.renderable = sprite;
        element.texture = texture;
        element.transform = new pixi.Matrix().translate(index, 2);
        element.bounds = { minX: 0, minY: 0, maxX: 2, maxY: 2 };
        return element;
      });
      const scratch = () => (batcher as unknown as { _elements: unknown[] })._elements;
      const build = (count: number, split: boolean) => {
        instructions.reset();
        batcher.begin();
        for (let index = 0; index < count; index++) {
          batcher.add(elements[index]);
          if (split && index === Math.floor(count / 2) - 1) batcher.break(instructions);
        }
        batcher.finish(instructions);
        const batches = instructions.instructions.slice(0, instructions.instructionSize) as PIXI.Batch[];
        expect(batches.reduce((sum, batch) => sum + batch.size, 0)).toBe(count * 6);
        expect(instructions.instructionSize).toBe(split ? 2 : 1);
        expect(batcher.attributeBuffer.float32View[0]).toBe(0);
        expect(batcher.attributeBuffer.float32View[1]).toBe(2);
        expect(batcher.attributeBuffer.float32View[(count - 1) * 24]).toBe(count - 1);
        expect([...batcher.indexBuffer.slice((count - 1) * 6, count * 6)]).toEqual([
          (count - 1) * 4, (count - 1) * 4 + 1, (count - 1) * 4 + 2,
          (count - 1) * 4, (count - 1) * 4 + 2, (count - 1) * 4 + 3,
        ]);
        expect(scratch()).toHaveLength(0);
      };
      try {
        const peerElement = new pixi.BatchableSprite();
        peerElement.renderable = sprite;
        peerElement.texture = texture;
        peerElement.transform = new pixi.Matrix().translate(17, 3);
        peerElement.bounds = { minX: 0, minY: 0, maxX: 2, maxY: 2 };
        peer.begin();
        peer.add(peerElement);
        peer.finish(peerInstructions);
        const peerPacked = [...peer.attributeBuffer.uint32View.slice(0, 24)];
        for (let cycle = 0; cycle < 6; cycle++) {
          build(512, cycle % 2 === 0);
          build(4, cycle % 2 !== 0);
          expect([...peer.attributeBuffer.uint32View.slice(0, 24)]).toEqual(peerPacked);
          expect(peer.checkAndUpdateTexture(peerElement, texture)).toBe(true);
        }
        elements[0].transform.tx = 7;
        batcher.updateElement(elements[0]);
        expect(batcher.attributeBuffer.float32View[0]).toBe(7);
        const lastSize = instructions.instructionSize;
        batcher.finish(instructions);
        expect(instructions.instructionSize).toBe(lastSize);
        batcher.begin();
        instructions.reset();
        batcher.finish(instructions);
        expect(instructions.instructionSize).toBe(0);
        expect(scratch()).toHaveLength(0);
        expect(textureDestroy).not.toHaveBeenCalled();
        expect(sourceDestroy).not.toHaveBeenCalled();
      } finally {
        batcher.destroy(); peer.destroy();
        instructions.destroy(); peerInstructions.destroy(); sprite.destroy(); texture.destroy(true);
      }
    });

    it("forgets cleared historical texture IDs while preserving a live peer, zero-index lookup and texture ownership", () => {
      const table = new pixi.BatchTextureArray();
      const peer = new pixi.BatchTextureArray();
      const source = new pixi.TextureSource({ width: 2, height: 2 });
      const texture = new pixi.Texture({ source });
      const sources = Array.from({ length: 64 }, () => new pixi.TextureSource({ width: 2, height: 2 }));
      const textureDestroy = vi.spyOn(texture, "destroy");
      const sourceDestroy = vi.spyOn(source, "destroy");
      peer.textures[0] = source;
      peer.ids[source.uid] = 0;
      peer.count = 1;
      const peerIds = peer.ids;
      const batcher = new pixi.DefaultBatcher({ maxTextures: 4 });
      const sprite = new pixi.Sprite(texture);
      const element = new pixi.BatchableSprite();
      element.renderable = sprite;
      element.texture = texture;
      element._batch = new pixi.Batch();
      element._batch.textures = peer;
      try {
        for (const retired of sources) {
          table.textures[0] = retired;
          table.ids[retired.uid] = 0;
          table.count = 1;
          const previousIds = table.ids;
          table.clear();
          expect(table.count).toBe(0);
          expect(table.textures[0]).toBeNull();
          expect(Object.keys(table.ids)).toEqual([]);
          expect(Object.getPrototypeOf(table.ids)).toBeNull();
          expect(table.ids).not.toBe(previousIds);
          expect(peer.ids).toBe(peerIds);
          expect(peer.ids[source.uid]).toBe(0);
          expect(peer.textures[0]).toBe(source);
          expect(batcher.checkAndUpdateTexture(element, texture)).toBe(true);
          expect(element._textureId).toBe(0);
          const unrelated = new pixi.Texture({ source: retired });
          expect(batcher.checkAndUpdateTexture(element, unrelated)).toBe(false);
          unrelated.destroy();
          expect(retired.destroyed).toBe(false);
        }
        peer.clear();
        expect(batcher.checkAndUpdateTexture(element, texture)).toBe(false);
        peer.textures[0] = source;
        peer.ids[source.uid] = 0;
        peer.count = 1;
        expect(batcher.checkAndUpdateTexture(element, texture)).toBe(true);
        table.clear();
        expect(Object.keys(table.ids)).toEqual([]);
        expect(textureDestroy).not.toHaveBeenCalled();
        expect(sourceDestroy).not.toHaveBeenCalled();
      } finally {
        table.clear(); peer.clear(); element._batch.destroy(); batcher.destroy(); sprite.destroy();
        texture.destroy(true); sources.forEach(retired => retired.destroy());
      }
    });
  });
}
