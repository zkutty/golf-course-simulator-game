import { describe, expect, it } from "vitest";
import * as PIXI from "pixi.js";
import type { RenderSnapshot } from "../RenderSnapshot";
import { createTerrainWaterSceneSystem } from "./terrainWaterScene";

function layers() {
  return {
    surround: new PIXI.Container(),
    terrain: new PIXI.Container(),
    smoothSurfaces: new PIXI.Container(),
    estateSeam: new PIXI.Container(),
  };
}

function snapshot(revision: number): RenderSnapshot {
  return { revisions: { terrainWater: revision } } as unknown as RenderSnapshot;
}

describe("TerrainWaterSceneSystem", () => {
  it("does not destroy borrowed atlas textures and destroys generated textures exactly once", () => {
    const scene = createTerrainWaterSceneSystem(layers());
    const generated = { destroyed: false, calls: 0, destroy() { this.destroyed = true; this.calls++; } };
    const borrowed = { destroyed: false, calls: 0, destroy() { this.destroyed = true; this.calls++; } };
    scene.ownGeneratedTexture(generated as unknown as PIXI.Texture);
    scene.borrowTexture(borrowed as unknown as PIXI.Texture);
    scene.destroy();
    scene.destroy();
    expect(generated.calls).toBe(1);
    expect(borrowed.calls).toBe(0);
  });

  it("keeps context registrations flat through repeated owned/shared scene teardown", () => {
    const borrowedContext = new PIXI.GraphicsContext().rect(0, 0, 2, 2).fill(0xffffff);
    const registered = new Set<PIXI.GraphicsContext>([borrowedContext]);
    let released = 0;
    for (let cycle = 0; cycle < 12; cycle++) {
      const sceneLayers = layers();
      for (let index = 0; index < 5; index++) {
        const graphics = sceneLayers.terrain.addChild(new PIXI.Graphics().rect(0, 0, 4, 4).fill(0xffffff));
        const context = graphics.context; registered.add(context);
        context.on("destroy", () => { registered.delete(context); released++; });
      }
      sceneLayers.smoothSurfaces.addChild(new PIXI.Graphics({ context: borrowedContext }));
      const scene = createTerrainWaterSceneSystem(sceneLayers);
      expect(registered.size).toBe(6);
      expect(borrowedContext.listenerCount("update")).toBe(1);
      scene.destroy(); scene.destroy();
      expect(registered.size).toBe(1);
      expect(borrowedContext.listenerCount("update")).toBe(0);
      borrowedContext.rect(cycle, cycle, 1, 1).fill(0xffffff);
    }
    expect(released).toBe(60);
    borrowedContext.destroy();
  });

  it("runs all render phases only when the hosted revision changes", () => {
    const scene = createTerrainWaterSceneSystem(layers());
    const calls: string[] = [];
    scene.setRenderer("surround", () => { calls.push("surround"); });
    scene.setRenderer("terrain", () => { calls.push("terrain"); scene.markChunkRebuild(); });
    scene.setRenderer("connected", () => { calls.push("connected"); });
    scene.create(snapshot(3));
    scene.update(snapshot(3));
    expect(calls).toEqual(["surround", "terrain", "connected"]);
    expect(scene.diagnostics()).toMatchObject({
      revision: 3,
      surroundRebuilds: 1,
      chunkRebuilds: 1,
      connectedRebuilds: 1,
    });
    scene.update(snapshot(4));
    expect(calls).toHaveLength(6);
    scene.destroy();
  });

  it("culls chunks and ground cover without rebuilding scene resources", () => {
    const scene = createTerrainWaterSceneSystem(layers());
    const visible = new PIXI.Container();
    const hidden = new PIXI.Container();
    const visibleCover = new PIXI.Container();
    const hiddenCover = new PIXI.Container();
    scene.chunks = [
      { container: visible, minX: -10, minY: -10, maxX: 10, maxY: 10, waterSprites: [], foamSprites: [], groundCoverSprites: [{ display: visibleCover, tier: 1 }] },
      { container: hidden, minX: 500, minY: 500, maxX: 600, maxY: 600, waterSprites: [], foamSprites: [], groundCoverSprites: [{ display: hiddenCover, tier: 1 }] },
    ];
    expect(scene.cull({
      rotation: 0,
      pivotX: 0,
      pivotY: 0,
      scale: 1,
      screenWidth: 100,
      screenHeight: 100,
      graphicsQuality: "high",
      resolutionScale: 1,
    })).toBe(1);
    expect(visible.visible).toBe(true);
    expect(visibleCover.visible).toBe(true);
    expect(hidden.visible).toBe(false);
    expect(hiddenCover.visible).toBe(false);
    expect(scene.diagnostics().chunkRebuilds).toBe(0);
    scene.destroy();
  });
});
