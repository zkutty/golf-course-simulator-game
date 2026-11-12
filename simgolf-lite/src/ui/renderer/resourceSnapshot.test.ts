import * as PIXI from "pixi.js";
import { describe, expect, it, vi } from "vitest";
import { createRendererResourceSnapshots, type OwnedShimmer } from "./resourceSnapshot";

function fixture() {
  const stage = new PIXI.Container();
  const world = stage.addChild(new PIXI.Container());
  const fx = world.addChild(new PIXI.Container());
  const source = new PIXI.TextureSource({ width: 2, height: 2 });
  const texture = new PIXI.Texture({ source });
  const sprite = fx.addChild(new PIXI.Sprite(texture));
  world.addChild(new PIXI.Graphics().rect(0, 0, 2, 2).fill(0x008000).stroke({ width: 1 }));
  const managedTextures = [new PIXI.TextureSource({ width: 1, height: 1 })];
  const document = {} as Document;
  const container = {} as HTMLElement;
  const canvas = { isConnected: true, parentElement: container, ownerDocument: document };
  const renderer = { name: "webgl", uid: 10, texture: { _renderer: {} as object, managedTextures } };
  renderer.texture._renderer = renderer;
  const app = { stage, renderer, canvas } as unknown as PIXI.Application;
  const owned: OwnedShimmer = { stage, world, layer: fx, sprite, texture, source };
  const atmosphere = { readOwnedShimmerForTest: vi.fn<() => OwnedShimmer | null>(() => owned) };
  const current = { app, container, world, fx, atmosphere, document, documentTimeOrigin: 100 };
  const readCurrent = vi.fn(() => current);
  const snapshots = createRendererResourceSnapshots(readCurrent);
  return { snapshots, current, readCurrent, atmosphere, stage, world, fx, renderer, canvas, sprite, texture, source, managedTextures };
}

describe("save/load renderer resources and owned shimmer registration", () => {
  it("pairs raw counts and actual zero/one membership in the same callback", () => {
    const f = fixture();
    const resources = f.snapshots.resourceSnapshot();
    expect(resources).toEqual({
      displayObjects: 5, containers: 5, sprites: 1, graphics: 1, meshes: 0, text: 0,
      attachedTextures: 2, attachedTextureSources: 2, managedTextureSources: 1, canvasConnected: true,
    });
    expect(f.atmosphere.readOwnedShimmerForTest).not.toHaveBeenCalled();
    const identity = { status: "qualified", documentTimeOrigin: 100, rendererUid: 10, stageUid: f.stage.uid,
      textureUid: f.texture.uid, sourceUid: f.source.uid };
    expect(f.snapshots.saveLoadResourceSnapshot()).toEqual({ resources, ownedShimmer: { ...identity, registered: 0 } });
    f.sprite.visible = false;
    f.managedTextures.push(f.source);
    expect(f.snapshots.saveLoadResourceSnapshot()).toEqual({
      resources: { ...resources, managedTextureSources: 2 },
      ownedShimmer: { ...identity, registered: 1 },
    });
  });

  const invalid: readonly [string, (f: ReturnType<typeof fixture>) => void][] = [
    ["missing owner", (f) => f.atmosphere.readOwnedShimmerForTest.mockReturnValue(null)],
    ["foreign renderer", (f) => { f.renderer.texture._renderer = {}; }],
    ["disconnected canvas", (f) => { f.canvas.isConnected = false; }],
    ["foreign document", (f) => { f.canvas.ownerDocument = {} as Document; }],
    ["detached stage hierarchy", (f) => { f.stage.removeChild(f.world); }],
    ["detached owned sprite", (f) => { f.fx.removeChild(f.sprite); }],
    ["destroyed owned source", (f) => { f.source.destroy(); }],
    ["shared source", (f) => { f.world.addChild(new PIXI.Sprite(new PIXI.Texture({ source: f.source }))); }],
    ["duplicate owned registration", (f) => { f.managedTextures.push(f.source, f.source); }],
    ["unknown registry row", (f) => { delete f.managedTextures[0]; }],
    ["same UID, different source", (f) => {
      Object.defineProperty(f.managedTextures[0], "uid", { value: f.source.uid });
    }],
    ["changed current generation", (f) => {
      f.readCurrent.mockReturnValueOnce(f.current).mockReturnValueOnce({ ...f.current, atmosphere: { ...f.atmosphere } });
    }],
  ];
  it.each(invalid)("rejects %s while preserving the raw count", (_name, mutate) => {
    const f = fixture();
    mutate(f);
    const result = f.snapshots.saveLoadResourceSnapshot();
    expect(result?.resources.managedTextureSources).toBe(f.managedTextures.length);
    expect(result?.ownedShimmer.status).toBe("unqualified");
  });

  const graphicsConsumers: readonly [string, (texture: PIXI.Texture) => PIXI.Graphics][] = [
    ["texture", (texture) => new PIXI.Graphics().texture(texture)],
    ["fill", (texture) => new PIXI.Graphics().rect(0, 0, 2, 2).fill({ texture })],
    ["stroke", (texture) => new PIXI.Graphics().rect(0, 0, 2, 2).stroke({ texture, width: 1 })],
  ];
  it.each(graphicsConsumers)("rejects a shared shimmer through stock Graphics %s instructions", (action, create) => {
    const f = fixture();
    const graphics = f.world.addChild(create(new PIXI.Texture({ source: f.source })));
    expect(graphics.context.instructions.map((instruction) => instruction.action)).toEqual([action]);
    const raw = f.snapshots.resourceSnapshot();
    const result = f.snapshots.saveLoadResourceSnapshot();
    expect(result?.resources).toEqual(raw);
    expect(result?.ownedShimmer.status).toBe("unqualified");
  });

  it.each(["unknown action", "missing image"])("fails closed on a Graphics instruction with %s", (kind) => {
    const f = fixture();
    const graphics = f.world.addChild(new PIXI.Graphics().texture(PIXI.Texture.WHITE));
    const instruction = graphics.context.instructions[0];
    if (kind === "unknown action") Object.defineProperty(instruction, "action", { value: "unknown" });
    else Reflect.deleteProperty(instruction.data, "image");
    expect(f.snapshots.saveLoadResourceSnapshot()).toEqual({
      resources: f.snapshots.resourceSnapshot(),
      ownedShimmer: { status: "unqualified", reason: "shimmer-attachment" },
    });
  });
});
