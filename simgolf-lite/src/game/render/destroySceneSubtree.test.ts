import * as PIXI from "pixi.js";
import { describe, expect, it, vi } from "vitest";
import { destroySceneSubtree } from "./destroySceneSubtree";

describe("scene subtree ownership in installed Pixi", () => {
  it("releases populated nested owned contexts exactly once, including detached masks", () => {
    const peer = new PIXI.Container();
    const parent = new PIXI.Container();
    const root = parent.addChild(new PIXI.Container());
    parent.addChild(peer);
    const nested = root.addChild(new PIXI.Container());
    const shapes = [
      root.addChild(new PIXI.Graphics().rect(0, 0, 30, 20).fill(0x123456)),
      nested.addChild(new PIXI.Graphics().circle(5, 5, 4).fill(0xff0000)),
    ];
    shapes[0].mask = shapes[1];
    const contexts = shapes.map(shape => shape.context);
    const contextDestruction = contexts.map(context => vi.spyOn(context, "destroy"));
    const destruction = [root, nested, ...shapes].map(node => vi.spyOn(node, "destroy"));
    expect(contexts.every(context => context.instructions.length > 0)).toBe(true);
    destroySceneSubtree(root);
    destroySceneSubtree(root);
    shapes.forEach(destroySceneSubtree);
    expect(parent.children).toEqual([peer]);
    expect(peer.destroyed).toBe(false);
    for (const context of contexts) expect(context.instructions).toBeNull();
    for (const spy of contextDestruction) expect(spy).toHaveBeenCalledExactlyOnceWith(undefined);
    for (const spy of destruction) expect(spy).toHaveBeenCalledExactlyOnceWith();
    parent.destroy({ children: true });
  });

  it("preserves shared and reassigned contexts, textures and a live peer's drawing", () => {
    const source = new PIXI.BufferImageSource({ resource: new Uint8Array(16), width: 2, height: 2 });
    const texture = new PIXI.Texture({ source });
    const shared = new PIXI.GraphicsContext().rect(0, 0, 12, 8).fill({ texture });
    const root = new PIXI.Container();
    const peerRoot = new PIXI.Container();
    root.addChild(new PIXI.Graphics({ context: shared }));
    const reassigned = root.addChild(new PIXI.Graphics());
    const originalContext = reassigned.context;
    reassigned.context = shared;
    root.addChild(new PIXI.Graphics().circle(4, 4, 2).fill({ texture }));
    root.addChild(new PIXI.Sprite(texture));
    const peer = peerRoot.addChild(new PIXI.Graphics({ context: shared }));
    const peerSprite = peerRoot.addChild(new PIXI.Sprite(texture));
    const contextDestroy = vi.spyOn(shared, "destroy");
    const textureDestroy = vi.spyOn(texture, "destroy");
    const sourceDestroy = vi.spyOn(source, "destroy");
    const boundsBefore = peer.getBounds().rectangle.clone();
    try {
      destroySceneSubtree(root);
      expect(originalContext.instructions).toBeNull();
      expect(contextDestroy).not.toHaveBeenCalled();
      expect(textureDestroy).not.toHaveBeenCalled();
      expect(sourceDestroy).not.toHaveBeenCalled();
      expect(peer.context).toBe(shared);
      expect(peer.getBounds().rectangle).toEqual(boundsBefore);
      expect(peer.containsPoint(new PIXI.Point(5, 5))).toBe(true);
      expect(peerSprite.texture).toBe(texture);
      expect(peerSprite.getBounds().width).toBe(2);
      const instructions = shared.instructions.length;
      peer.rect(20, 0, 5, 5).fill(0xff0000);
      expect(shared.instructions.length).toBeGreaterThan(instructions);
      expect(peer.getBounds().width).toBe(25);
    } finally {
      destroySceneSubtree(peerRoot);
      shared.destroy();
      texture.destroy(true);
    }
  });

  it("leaves an independently disposed node alone on later subtree teardown", () => {
    const root = new PIXI.Container();
    const graphic = root.addChild(new PIXI.Graphics().rect(0, 0, 3, 4).stroke(0xffffff));
    const context = graphic.context;
    const destroy = vi.spyOn(context, "destroy");
    graphic.destroy();
    destroySceneSubtree(graphic);
    destroySceneSubtree(root);
    expect(destroy).toHaveBeenCalledExactlyOnceWith(undefined);
    expect(context.instructions).toBeNull();
  });
});


it("detaches retired borrowers over repeated turnover without losing the survivor's update listener", () => {
  const shared = new PIXI.GraphicsContext().rect(0, 0, 8, 8).fill(0x123456);
  const peer = new PIXI.Graphics({ context: shared });
  const contextDestroy = vi.spyOn(shared, "destroy");
  const baseline = shared.listenerCount("update");
  expect(baseline).toBeGreaterThan(0);
  try {
    for (let cycle = 0; cycle < 12; cycle++) {
      const root = new PIXI.Container();
      root.addChild(new PIXI.Graphics({ context: shared }));
      expect(shared.listenerCount("update")).toBe(baseline + 1);
      destroySceneSubtree(root);
      expect(shared.listenerCount("update")).toBe(baseline);
      // These are the public dirty flags consumed/reset by Pixi's render pass.
      shared.dirty = false;
      peer.didViewUpdate = false;
      shared.rect(10 + cycle * 2, 0, 1, 1).fill(0xabcdef);
      expect(peer.didViewUpdate).toBe(true);
      expect(peer.getBounds().width).toBe(11 + cycle * 2);
      expect(contextDestroy).not.toHaveBeenCalled();
    }
    destroySceneSubtree(peer);
    expect(shared.listenerCount("update")).toBe(0);
  } finally {
    destroySceneSubtree(peer);
    shared.destroy();
  }
});
