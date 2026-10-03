import { describe, expect, it } from "vitest";
import { Container, Mesh, MeshGeometry, Texture } from "pixi.js";
import { destroySceneSubtree } from "./destroySceneSubtree";
import { ownSceneMeshGeometry } from "./ownedSceneMeshGeometry";
import { createParklandComposableMesh, destroyParklandPresentationLayer } from "../../game/render/parklandComposable";

function geometry() {
  return new MeshGeometry({
    positions: new Float32Array([0, 0, 10, 0, 0, 10]),
    uvs: new Float32Array([0, 0, 1, 0, 0, 1]),
    indices: new Uint32Array([0, 1, 2]),
  });
}

function observeGeometry(geo: MeshGeometry) {
  const buffers = [...new Set([...geo.buffers, geo.indexBuffer!])];
  let geometryEvents = 0;
  let bufferEvents = 0;
  geo.on("destroy", () => geometryEvents++);
  for (const buffer of buffers) buffer.on("destroy", () => bufferEvents++);
  return { buffers, counts: () => ({ geometryEvents, bufferEvents }) };
}

describe("exclusive scene Mesh geometry", () => {
  it("disposes exclusive geometry and every buffer once without borrowing textures", () => {
    const geo = geometry();
    const observed = observeGeometry(geo);
    const mesh = ownSceneMeshGeometry(new Mesh({ geometry: geo, texture: Texture.WHITE }));
    const root = new Container();
    root.addChild(mesh);
    destroySceneSubtree(root);
    destroySceneSubtree(root);
    destroySceneSubtree(mesh);
    expect(mesh.destroyed).toBe(true);
    expect(observed.counts()).toEqual({ geometryEvents: 1, bufferEvents: 3 });
    expect(observed.buffers.every((buffer) => buffer.destroyed)).toBe(true);
    expect(Texture.WHITE.destroyed).toBe(false);
    expect(Texture.WHITE.source.destroyed).toBe(false);
  });

  it("leaves unmarked shared geometry and the live sibling update binding intact", () => {
    const geo = geometry();
    const observed = observeGeometry(geo);
    const first = new Mesh({ geometry: geo, texture: Texture.WHITE });
    const sibling = new Mesh({ geometry: geo, texture: Texture.WHITE });
    destroySceneSubtree(first);
    expect(observed.counts()).toEqual({ geometryEvents: 0, bufferEvents: 0 });
    expect(observed.buffers.every((buffer) => !buffer.destroyed)).toBe(true);
    expect(sibling.geometry).toBe(geo);
    expect(sibling.destroyed).toBe(false);
    sibling.didViewUpdate = false;
    geo.emit("update", geo);
    expect(sibling.didViewUpdate).toBe(true);
    destroySceneSubtree(sibling);
    expect(observed.counts()).toEqual({ geometryEvents: 0, bufferEvents: 0 });
    geo.destroy(true);
  });

  it("releases a registered low-material Mesh through parkland layer disposal", () => {
    const mesh = createParklandComposableMesh(Texture.WHITE, [0], 1, 1,
      (entry) => entry, (_entry, x, y) => ({ x, y }), false)!;
    expect(mesh).not.toBeNull();
    const observed = observeGeometry(mesh.geometry as MeshGeometry);
    const layer = new Container();
    layer.addChild(mesh);
    expect(destroyParklandPresentationLayer(layer)).toBeNull();
    expect(observed.counts()).toEqual({ geometryEvents: 1, bufferEvents: 3 });
    expect(observed.buffers.every((buffer) => buffer.destroyed)).toBe(true);
  });
});
