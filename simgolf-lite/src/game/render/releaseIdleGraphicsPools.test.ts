import { createRequire } from "node:module";
import * as PIXI from "pixi.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { releaseIdleGraphicsPools } from "./releaseIdleGraphicsPools";

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
  const pools = () => [
    pixi.BigPool.getPool(pixi.GraphicsContextRenderData),
    pixi.BigPool.getPool(pixi.BatchableGraphics),
  ];
  const stats = () => pools().map(pool => ({ size: pool.totalSize, free: pool.totalFree, used: pool.totalUsed }));

  describe(`installed Pixi ${format} idle graphics pools`, () => {
    it("preserves populated live owners and reuse, then releases the final session's idle capacity and supports later returns", () => {
      const source = new pixi.TextureSource({ width: 16, height: 16 });
      const texture = new pixi.Texture({ source });
      const textureDestroy = vi.spyOn(texture, "destroy");
      const sourceDestroy = vi.spyOn(source, "destroy");
      const owner = () => {
        const renderer = new pixi.WebGLRenderer();
        renderer._roundPixels = 0;
        renderer.limits = new pixi.GlLimitsSystem(renderer);
        renderer.limits.maxBatchableTextures = 4;
        renderer.renderableGC = new pixi.RenderableGCSystem(renderer);
        const context = renderer.graphicsContext = new pixi.GraphicsContextSystem(renderer);
        const batch = renderer.renderPipes.batch = new pixi.BatcherPipe(renderer, { start() {}, execute() {} });
        const graphics = renderer.renderPipes.graphics = new pixi.GraphicsPipe(renderer, { destroy() {} } as ConstructorParameters<typeof pixi.GraphicsPipe>[1]);
        renderer.runners.destroy.add(context);
        renderer.runners.destroy.add(batch);
        renderer.runners.destroy.add(graphics);
        renderer.runners.destroy.add(renderer.renderableGC);
        const stage = new pixi.Container();
        const batched = stage.addChild(new pixi.Graphics().rect(0, 0, 8, 8).fill({ texture }));
        batched.context.batchMode = "batch";
        const large = stage.addChild(new pixi.Graphics());
        for (let index = 0; index < 100; index++) large.rect(index * 3, 0, 2, 2).fill({ texture });
        large.context.batchMode = "no-batch";
        const instructions = new pixi.InstructionSet();
        let destroyed = false;
        return {
          build() {
            instructions.reset();
            batch.buildStart(instructions);
            graphics.addRenderable(batched, instructions);
            graphics.addRenderable(large, instructions);
            batch.buildEnd(instructions);
            graphics.updateRenderable(batched);
            const gpu = context.updateGpuContext(large.context);
            const data = context.getContextRenderData(large.context);
            return { data, geometry: [...gpu.geometryData.vertices], packed: [...data.batcher.attributeBuffer.uint32View] };
          },
          destroy() {
            if (destroyed) return;
            destroyed = true;
            // Match the app's default per-node ownership cleanup before renderer teardown.
            for (const child of [...stage.children]) { stage.removeChild(child); child.destroy(); }
            stage.destroy();
            instructions.destroy();
            renderer.destroy({ releaseGlobalResources: false });
          },
        };
      };
      const owners: ReturnType<typeof owner>[] = [];
      const createOwner = () => { const next = owner(); owners.push(next); return next; };
      try {
        const first = createOwner(), peer = createOwner();
        const firstPayload = first.build(), peerPayload = peer.build();
        expect(firstPayload.data).not.toBe(peerPayload.data);
        expect(firstPayload.data.batcher).not.toBe(peerPayload.data.batcher);
        expect(firstPayload.geometry.length).toBeGreaterThan(0);
        expect(peerPayload.geometry.length).toBeGreaterThan(0);
        expect(stats().every(pool => pool.used > 0 && pool.free === 0)).toBe(true);
        first.destroy();
        const withPeer = stats();
        expect(withPeer.every(pool => pool.used > 0 && pool.free > 0)).toBe(true);
        releaseIdleGraphicsPools(pixi);
        expect(stats()).toEqual(withPeer);
        expect(peer.build().packed).toEqual(peerPayload.packed);
        expect(peer.build().geometry).toEqual(peerPayload.geometry);
        const replacement = createOwner();
        expect(replacement.build().data).toBe(firstPayload.data);
        replacement.destroy();
        expect(stats()).toEqual(withPeer);
        peer.destroy();
        expect(stats().every(pool => pool.used === 0 && pool.size === pool.free && pool.free > 0)).toBe(true);
        // Public checkout proves available entries are distinct before their destructors run.
        const dataPool = pixi.BigPool.getPool(pixi.GraphicsContextRenderData);
        const available = Array.from({ length: dataPool.totalFree }, () => dataPool.get({ maxTextures: 4 }));
        expect(new Set(available).size).toBe(available.length);
        available.forEach(data => dataPool.return(data));
        releaseIdleGraphicsPools(pixi);
        expect(stats()).toEqual([{ size: 0, free: 0, used: 0 }, { size: 0, free: 0, used: 0 }]);
        expect(textureDestroy).not.toHaveBeenCalled();
        expect(sourceDestroy).not.toHaveBeenCalled();
        const later = createOwner(), laterPayload = later.build();
        expect(laterPayload.data).not.toBe(firstPayload.data);
        expect(laterPayload.data).not.toBe(peerPayload.data);
        expect(laterPayload.geometry).toEqual(peerPayload.geometry);
        expect(stats().every(pool => pool.used > 0)).toBe(true);
        later.destroy();
        expect(stats().every(pool => pool.used === 0 && pool.size === pool.free)).toBe(true);
        releaseIdleGraphicsPools(pixi);
        expect(stats().every(pool => pool.size === 0)).toBe(true);
        expect(textureDestroy).not.toHaveBeenCalled();
        expect(sourceDestroy).not.toHaveBeenCalled();
      } finally {
        owners.forEach(owner => owner.destroy());
        // All fixture owners are gone, including when a negative control fails an assertion.
        pools().forEach(pool => pool.clear());
        texture.destroy(true);
      }
    });

    it("guards each class independently and leaves other pool classes and checked-out buffers intact", () => {
      class OtherItem { destroy = vi.fn(); }
      const otherPool = pixi.BigPool.getPool(OtherItem);
      const other = otherPool.get();
      otherPool.return(other);
      const dataPool = pixi.BigPool.getPool(pixi.GraphicsContextRenderData);
      const graphicsPool = pixi.BigPool.getPool(pixi.BatchableGraphics);
      const checkedOut = dataPool.get({ maxTextures: 4 });
      const graphics = graphicsPool.get();
      graphicsPool.return(graphics);
      const liveBuffer = checkedOut.batcher.attributeBuffer;
      const before = { size: dataPool.totalSize, free: dataPool.totalFree, used: dataPool.totalUsed };
      try {
        releaseIdleGraphicsPools(pixi);
        expect({ size: dataPool.totalSize, free: dataPool.totalFree, used: dataPool.totalUsed }).toEqual(before);
        expect(checkedOut.batcher.attributeBuffer).toBe(liveBuffer);
        expect(liveBuffer.rawBinaryData.byteLength).toBeGreaterThan(0);
        expect(graphicsPool.totalSize).toBe(0);
        expect(otherPool.totalSize).toBe(1);
        expect(otherPool.totalFree).toBe(1);
        expect(other.destroy).not.toHaveBeenCalled();
      } finally {
        dataPool.return(checkedOut);
        pools().forEach(pool => pool.clear());
        otherPool.clear();
      }
    });
  });
}
