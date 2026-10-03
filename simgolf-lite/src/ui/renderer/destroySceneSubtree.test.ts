import { describe, expect, it, vi } from "vitest";
import * as PIXI from "pixi.js";
import { destroySceneSubtree } from "./destroySceneSubtree";

describe("scene subtree ownership", () => {
  it("destroys owned contexts exactly once and unregisters renderer ownership", () => {
    const root = new PIXI.Container();
    const graphics = root.addChild(new PIXI.Graphics().rect(0, 0, 8, 8).fill(0xffffff));
    const context = graphics.context;
    const system = new PIXI.GraphicsContextSystem({
      renderableGC: { addManagedHash: vi.fn() },
    } as unknown as ConstructorParameters<typeof PIXI.GraphicsContextSystem>[0]);
    system.getGpuContext(context);
    expect(context.listenerCount("destroy")).toBe(1);
    const destroy = vi.spyOn(context, "destroy");
    destroySceneSubtree(root);
    destroySceneSubtree(root);
    expect(graphics.destroyed).toBe(true);
    expect(destroy).toHaveBeenCalledExactlyOnceWith(undefined);
    expect(context.listenerCount("destroy")).toBe(0);
    system.destroy();
    expect(destroy).toHaveBeenCalledTimes(1);
    expect(context.listenerCount("update")).toBe(0);
  });

  it("detaches destroyed shared instances while siblings and clones remain usable", () => {
    const context = new PIXI.GraphicsContext().rect(0, 0, 8, 8).fill(0xffffff);
    const survivor = new PIXI.Graphics({ context });
    const doomed = new PIXI.Graphics({ context });
    const clone = doomed.clone();
    const destroy = vi.spyOn(context, "destroy");
    expect(context.listenerCount("update")).toBe(3);
    const root = new PIXI.Container(); root.addChild(doomed);
    destroySceneSubtree(root);
    expect(destroy).not.toHaveBeenCalled();
    expect(context.listenerCount("update")).toBe(2);
    survivor.didViewUpdate = false; clone.didViewUpdate = false;
    context.dirty = false;
    context.rect(10, 10, 4, 4).fill(0xff0000);
    expect(survivor.didViewUpdate).toBe(true);
    expect(clone.didViewUpdate).toBe(true);
    expect(survivor.context).toBe(context);
    expect(clone.context).toBe(context);
    destroySceneSubtree(survivor); destroySceneSubtree(clone);
    expect(context.listenerCount("update")).toBe(0);
    expect(destroy).not.toHaveBeenCalled();
    context.destroy(); expect(destroy).toHaveBeenCalledTimes(1);
  });

  it("preserves borrowed sprite and mesh textures and geometry", () => {
    const source = new PIXI.TextureSource({ width: 1, height: 1 });
    const texture = new PIXI.Texture({ source });
    const geometry = new PIXI.MeshGeometry({ positions: new Float32Array([0, 0, 1, 0, 0, 1]), uvs: new Float32Array([0, 0, 1, 0, 0, 1]), indices: new Uint32Array([0, 1, 2]) });
    const textureDestroy = vi.spyOn(texture, "destroy");
    const sourceDestroy = vi.spyOn(source, "destroy");
    const geometryDestroy = vi.spyOn(geometry, "destroy");
    const root = new PIXI.Container();
    const sprite = root.addChild(new PIXI.Sprite(texture));
    const mesh = root.addChild(new PIXI.Mesh({ texture, geometry }));
    destroySceneSubtree(root);
    expect(sprite.destroyed).toBe(true); expect(mesh.destroyed).toBe(true);
    expect(textureDestroy).not.toHaveBeenCalled();
    expect(sourceDestroy).not.toHaveBeenCalled();
    expect(geometryDestroy).not.toHaveBeenCalled();
    geometry.destroy(); texture.destroy(true);
  });

  it("releases descendants before their parent render group and remains idempotent", () => {
    const root = new PIXI.Container(); root.enableRenderGroup();
    const group = root.renderGroup;
    const groupDestroy = vi.spyOn(group, "destroy");
    const nested = root.addChild(new PIXI.Container());
    const child = nested.addChild(new PIXI.Graphics()); const order: string[] = [];
    child.on("destroyed", () => {
      order.push("child"); expect(child.parent).toBeNull();
      expect(root.destroyed).toBe(false); expect(groupDestroy).not.toHaveBeenCalled();
    });
    nested.on("destroyed", () => { order.push("nested"); expect(child.destroyed).toBe(true); });
    root.on("destroyed", () => { order.push("root"); expect(nested.destroyed).toBe(true); });
    destroySceneSubtree(root); destroySceneSubtree(root);
    expect(order).toEqual(["child", "nested", "root"]);
    expect(groupDestroy).toHaveBeenCalledTimes(1);
  });
});
