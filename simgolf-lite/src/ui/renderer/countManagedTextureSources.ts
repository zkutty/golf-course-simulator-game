import type { TextureSource } from "pixi.js";

type ManagedTextureSystem = {
  readonly managedTextures?: readonly (TextureSource | null | undefined)[];
};

/** Count public registered entries; Pixi 8.15+ leaves null removal slots. */
export function countManagedTextureSources(system: ManagedTextureSystem | null | undefined): number {
  const sources = system?.managedTextures;
  if (!Array.isArray(sources)) return -1;
  let count = 0;
  for (const source of sources) {
    if (source == null) continue;
    if (typeof source !== "object") return -1;
    // Non-null destroyed entries remain evidence of a registration.
    count++;
  }
  return count;
}
