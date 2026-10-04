import { afterEach, describe, expect, it } from "vitest";
import { TextureSource } from "pixi.js";
import { countManagedTextureSources } from "./countManagedTextureSources";

const sources: TextureSource[] = [];
function source() {
  const value = new TextureSource({ width: 1, height: 1 });
  sources.push(value);
  return value;
}
afterEach(() => {
  for (const value of sources.splice(0)) if (!value.destroyed) value.destroy();
});

describe("public managed texture count", () => {
  it("counts registration, null removal and new registration through the getter", () => {
    const first = source(), second = source();
    let entries: (TextureSource | null)[] = [first];
    const system = { get managedTextures() { return entries; } };
    expect(countManagedTextureSources(system)).toBe(1);
    entries = [null];
    expect(countManagedTextureSources(system)).toBe(0);
    entries = [null, second];
    expect(countManagedTextureSources(system)).toBe(1);
  });

  it("preserves duplicates and non-null destroyed registrations", () => {
    const value = source(); value.destroy();
    expect(countManagedTextureSources({ managedTextures: [value, null, value] })).toBe(2);
  });

  it("counts an empty array and skips null, undefined and sparse slots", () => {
    expect(countManagedTextureSources({ managedTextures: [] })).toBe(0);
    const entries = new Array<TextureSource | null | undefined>(4);
    entries[1] = null; entries[2] = undefined; entries[3] = source();
    expect(countManagedTextureSources({ managedTextures: entries })).toBe(1);
  });

  it("keeps unavailable and malformed data distinct from zero resources", () => {
    for (const value of [null, undefined, {}]) expect(countManagedTextureSources(value)).toBe(-1);
    const malformed = { managedTextures: { length: 3 } };
    expect(countManagedTextureSources(malformed as unknown as Parameters<typeof countManagedTextureSources>[0])).toBe(-1);
    const invalidEntry = { managedTextures: [source(), 1] };
    expect(countManagedTextureSources(invalidEntry as unknown as Parameters<typeof countManagedTextureSources>[0])).toBe(-1);
  });
});
