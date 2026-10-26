import { createRequire } from "node:module";
import * as PIXI from "pixi.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const implementations = [
  ["esm", PIXI],
  ["cjs", createRequire(import.meta.url)("pixi.js") as typeof PIXI],
] as const;

beforeEach(() => {
  for (const [, pixi] of implementations) {
    pixi.GlobalResourceRegistry.release();
    vi.spyOn(pixi.DOMAdapter.get(), "createCanvas").mockReturnValue({
      getContext: () => null,
    } as unknown as ReturnType<ReturnType<typeof pixi.DOMAdapter.get>["createCanvas"]>);
  }
});

afterEach(() => {
  for (const [, pixi] of implementations) pixi.GlobalResourceRegistry.release();
  vi.restoreAllMocks();
});

function fixture(pixi: typeof PIXI) {
  const source = new pixi.TextureSource({ width: 2, height: 2 });
  const texture = new pixi.Texture({ source });
  const textureDestroy = vi.spyOn(texture, "destroy");
  const sourceDestroy = vi.spyOn(source, "destroy");
  const sprites: PIXI.Sprite[] = [];
  const owners: { batcher: PIXI.DefaultBatcher; instructions: PIXI.InstructionSet }[] = [];
  const owner = () => {
    const value = {
      batcher: new pixi.DefaultBatcher({ maxTextures: 4 }),
      instructions: new pixi.InstructionSet(),
    };
    owners.push(value);
    return value;
  };
  const build = (target: ReturnType<typeof owner>, positions: number[]) => {
    target.instructions.reset();
    target.batcher.begin();
    const elements = positions.map((x, index) => {
      const sprite = new pixi.Sprite(texture);
      sprite.groupBlendMode = index % 2 === 0 ? "normal" : "add";
      sprites.push(sprite);
      const element = new pixi.BatchableSprite();
      element.renderable = sprite;
      element.texture = texture;
      element.transform = new pixi.Matrix().translate(x, 2);
      element.bounds = { minX: 0, minY: 0, maxX: 2, maxY: 2 };
      target.batcher.add(element);
      if (index < positions.length - 1) target.batcher.break(target.instructions);
      return element;
    });
    target.batcher.finish(target.instructions);
    return {
      elements,
      batches: target.instructions.instructions.slice(0, target.instructions.instructionSize) as PIXI.Batch[],
    };
  };
  const borrowedAlive = () => {
    expect(textureDestroy).not.toHaveBeenCalled();
    expect(sourceDestroy).not.toHaveBeenCalled();
    expect(source.destroyed).toBe(false);
  };
  const dispose = () => {
    for (const value of owners) {
      value.batcher.destroy();
      value.instructions.destroy();
    }
    for (const sprite of sprites) sprite.destroy();
    texture.destroy();
    source.destroy();
  };
  return { source, texture, owner, build, borrowedAlive, dispose };
}

const selectedFirstX = (batch: PIXI.Batch) => batch.batcher?.attributeBuffer?.float32View[0];

function expectAvailable(batch: PIXI.Batch, previousIds: Record<number, number>) {
  expect(batch.textures.count).toBe(0);
  expect(Object.keys(batch.textures.ids)).toEqual([]);
  expect(Object.getPrototypeOf(batch.textures.ids)).toBeNull();
  expect(batch.textures.ids).not.toBe(previousIds);
  expect(batch.textures.textures.every((texture) => texture === null)).toBe(true);
  expect(batch.batcher === null).toBe(true);
  expect(batch.bindGroup === null).toBe(true);
  expect(batch.gpuBindGroup === null).toBe(true);
}

for (const [format, pixi] of implementations) {
  describe(`installed Pixi ${format} Batch pool ownership`, () => {
    it("keeps only the current two, one, then zero batches while preserving packed output and updates", () => {
      const f = fixture(pixi);
      const target = f.owner();
      try {
        const split = f.build(target, [3, 11]);
        expect(new Set(split.batches).size).toBe(2);
        expect(target.batcher.batches.length).toBe(split.batches.length);
        expect(target.batcher.batches.every((batch, index) => batch === split.batches[index])).toBe(true);
        expect(split.batches.map(({ blendMode, topology, start, size }) => ({ blendMode, topology, start, size }))).toEqual([
          { blendMode: "normal", topology: "triangle-list", start: 0, size: 6 },
          { blendMode: "add", topology: "triangle-list", start: 6, size: 6 },
        ]);
        expect([...target.batcher.indexBuffer.slice(0, 12)]).toEqual([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]);
        expect(target.batcher.attributeBuffer.float32View[0]).toBe(3);
        expect(target.batcher.attributeBuffer.float32View[24]).toBe(11);
        const one = f.build(target, [7]);
        expect(target.batcher.batchIndex).toBe(1);
        expect(target.batcher.batches.length).toBe(one.batches.length);
        expect(target.batcher.batches[0] === one.batches[0]).toBe(true);
        one.elements[0].transform.tx = 17;
        target.batcher.updateElement(one.elements[0]);
        expect(selectedFirstX(one.batches[0])).toBe(17);
        expect(target.batcher.checkAndUpdateTexture(one.elements[0], f.texture)).toBe(true);
        expect(one.elements[0]._textureId).toBe(0);
        expect(f.build(target, []).batches).toEqual([]);
        expect(target.batcher.batchIndex).toBe(0);
        expect(target.batcher.batches.length).toBe(0);
        f.borrowedAlive();
      } finally { f.dispose(); }
    });

    for (const firstRetired of ["peer", "later"] as const) {
      it(`preserves distinct selected geometry after shrink/destroy/reacquire and ${firstRetired}-first retirement`, () => {
        const f = fixture(pixi);
        const retiring = f.owner();
        const peer = f.owner();
        const later = f.owner();
        try {
          f.build(retiring, [1, 2]);
          f.build(retiring, [3]);
          retiring.batcher.destroy();
          retiring.batcher.destroy();
          const peerBatch = f.build(peer, [7]).batches[0];
          const laterBatch = f.build(later, [23]).batches[0];
          expect.soft(peerBatch === laterBatch).toBe(false);
          expect.soft(peerBatch.batcher === peer.batcher).toBe(true);
          expect.soft(laterBatch.batcher === later.batcher).toBe(true);
          expect.soft(selectedFirstX(peerBatch)).toBe(7);
          expect.soft(selectedFirstX(laterBatch)).toBe(23);
          const survivor = firstRetired === "peer" ? later : peer;
          const survivorBatch = firstRetired === "peer" ? laterBatch : peerBatch;
          const survivorX = firstRetired === "peer" ? 23 : 7;
          (firstRetired === "peer" ? peer : later).batcher.destroy();
          const next = f.owner();
          const nextBatch = f.build(next, [47]).batches[0];
          expect.soft(nextBatch === survivorBatch).toBe(false);
          expect.soft(survivorBatch.batcher === survivor.batcher).toBe(true);
          expect.soft(selectedFirstX(survivorBatch)).toBe(survivorX);
          expect(selectedFirstX(nextBatch)).toBe(47);
          f.borrowedAlive();
        } finally { f.dispose(); }
      });
    }

    for (const release of ["begin", "destroy"] as const) {
      it(`clears available payload on ${release}, without destroying borrowed resources, then reuses the Batch`, () => {
        const f = fixture(pixi);
        const target = f.owner();
        try {
          const batch = f.build(target, [7]).batches[0];
          const previousIds = batch.textures.ids;
          batch.bindGroup = new pixi.BindGroup({});
          batch.gpuBindGroup = { label: "borrowed GPU handle" } as PIXI.Batch["gpuBindGroup"];
          target.batcher[release]();
          expectAvailable(batch, previousIds);
          f.borrowedAlive();
          const next = f.owner();
          const reused = f.build(next, [31]);
          expect(reused.batches[0] === batch).toBe(true);
          expect(selectedFirstX(batch)).toBe(31);
          expect(next.batcher.checkAndUpdateTexture(reused.elements[0], f.texture)).toBe(true);
          expect(batch.textures.textures[0] === f.source).toBe(true);
          expect(batch.textures.ids[f.source.uid]).toBe(0);
          f.borrowedAlive();
        } finally { f.dispose(); }
      });
    }

    it("preserves explicit global-release invalidation of a checked-out slot and the legacy break failure", () => {
      const f = fixture(pixi);
      const retiring = f.owner();
      const peer = f.owner();
      try {
        f.build(retiring, [1]);
        retiring.batcher.destroy();
        const peerBatch = f.build(peer, [7]).batches[0];
        expect(peerBatch.textures.count).toBe(1);
        pixi.GlobalResourceRegistry.release();
        expect(peerBatch.textures).toBeNull();
        let caught: unknown;
        try { f.build(peer, [9]); } catch (error) { caught = error; }
        expect(caught).toBeInstanceOf(TypeError);
        expect((caught as Error).message).toContain("Cannot read properties of null (reading 'clear')");
        expect((caught as Error).stack).toMatch(/Batcher.*break|\.break/);
        f.borrowedAlive();
      } finally { f.dispose(); }
    });
  });
}
