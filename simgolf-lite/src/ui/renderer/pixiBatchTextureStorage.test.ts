import { expect, it } from "vitest";
import * as PIXI from "pixi.js";

function addSource(table: PIXI.BatchTextureArray, source: PIXI.TextureSource) {
  table.ids[source.uid] = table.count;
  table.textures[table.count++] = source;
}

it("128 distinct source UIDs do not accumulate after clearing the same texture table", () => {
  const table = new PIXI.BatchTextureArray();
  const ids = table.ids;
  const sources: PIXI.TextureSource[] = [];
  const remainingKeys: number[] = [];
  try {
    for (let i = 0; i < 128; i++) {
      const source = new PIXI.TextureSource({ width: 16, height: 16 });
      sources.push(source);
      addSource(table, source);
      expect(table.ids[source.uid]).toBe(0);
      table.clear();
      expect(table.ids).toBe(ids);
      expect(table.count).toBe(0);
      expect(table.textures[0]).toBeNull();
      remainingKeys.push(Object.keys(table.ids).length);
    }
    expect(new Set(sources.map(source => source.uid)).size).toBe(128);
    expect(sources.every(source => !source.destroyed)).toBe(true);
    expect(remainingKeys).toEqual(Array(128).fill(0));
  } finally {
    for (const source of sources) source.destroy();
  }
});

it("clearing one table preserves a live shared source and restores lookup at index zero on reuse", () => {
  const batch = new PIXI.Batch();
  const peer = new PIXI.BatchTextureArray();
  const shared = new PIXI.TextureSource({ width: 16, height: 16 });
  const second = new PIXI.TextureSource({ width: 16, height: 16 });
  const texture = new PIXI.Texture({ source: shared });
  const element = { _batch: batch, texture, _textureId: -1 } as Parameters<PIXI.Batcher["checkAndUpdateTexture"]>[0];
  // This lookup reads only the supplied element's actual batch table.
  const lookup = () => PIXI.Batcher.prototype.checkAndUpdateTexture.call(null, element, texture);
  try {
    addSource(batch.textures, shared);
    addSource(batch.textures, second);
    addSource(peer, shared);
    expect(batch.textures.ids[shared.uid]).toBe(0);
    expect(batch.textures.ids[second.uid]).toBe(1);
    expect(lookup()).toBe(true);
    expect(element._textureId).toBe(0);
    batch.textures.clear();
    expect(lookup()).toBe(false);
    expect(Object.hasOwn(batch.textures.ids, shared.uid)).toBe(false);
    expect(Object.hasOwn(batch.textures.ids, second.uid)).toBe(false);
    expect(peer.count).toBe(1);
    expect(peer.textures[0]).toBe(shared);
    expect(peer.ids[shared.uid]).toBe(0);
    expect(texture.destroyed || shared.destroyed || second.destroyed).toBe(false);
    addSource(batch.textures, shared);
    expect(lookup()).toBe(true);
    expect(element._textureId).toBe(0);
    expect(Object.keys(batch.textures.ids)).toEqual([String(shared.uid)]);
    batch.textures.clear();
    expect(Object.keys(batch.textures.ids)).toHaveLength(0);
  } finally {
    batch.textures.clear();
    peer.clear();
    batch.destroy();
    texture.destroy();
    shared.destroy();
    second.destroy();
  }
});
