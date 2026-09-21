import { describe, expect, it, vi } from "vitest";
import type * as PIXI from "pixi.js";
import type { ParklandHabitatAtlasCatalog } from "../game/render/habitatFieldTopology";
import {
  PARKLAND_HABITAT_ATLAS_URLS,
  PARKLAND_HABITAT_CATALOGS,
  PARKLAND_HABITAT_MANIFEST,
  applyHabitatPaletteTransform,
  createHabitatFieldAtlasLoader,
  habitatAtlasParityDiagnostics,
} from "./habitatFieldAtlas";

function texture(width: number, height: number) {
  return {
    width,
    height,
    source: {},
    destroy: vi.fn(),
  } as unknown as PIXI.Texture;
}

function onePixelCatalog(): ParklandHabitatAtlasCatalog {
  return {
    schema: "ParklandHabitatFieldAtlasV1",
    version: 1,
    tier: "low",
    image: "test.png",
    width: 2,
    height: 1,
    gutterPx: 0,
    frameCount: 1,
    frames: {
      "woodland_floor--interior-0": {
        id: "woodland_floor--interior-0",
        family: "woodland_floor",
        topologyRole: "interior",
        direction: null,
        corner: null,
        variant: 0,
        anchor: { x: 0, y: 0 },
        edgeAnchors: ["n", "e", "s", "w"],
        frame: { x: 0, y: 0, width: 2, height: 1 },
        sourceSha256: "test",
      },
    },
  };
}

describe("Parkland habitat atlas runtime", () => {
  it("validates frame IDs, semantics, normalized anchors, and footprints across every tier", () => {
    expect(habitatAtlasParityDiagnostics()).toEqual([]);
    const broken = structuredClone(PARKLAND_HABITAT_CATALOGS) as unknown as Record<
      "high" | "medium" | "low",
      ParklandHabitatAtlasCatalog
    >;
    const first = Object.keys(broken.medium.frames)[0];
    const record = broken.medium.frames[first];
    (record.anchor as { x: number }).x += 1;
    expect(habitatAtlasParityDiagnostics(broken)).toContain(`${first ? `medium:${first}` : "medium"}: normalized anchor differs`);
  });

  it("applies every declared color-mode mapping deterministically without changing alpha or transparent RGB", () => {
    const catalog = onePixelCatalog();
    const sourceColor = PARKLAND_HABITAT_MANIFEST.paletteTransforms.standard.woodland_floor.mappings[0].from;
    const source = new Uint8ClampedArray([
      ...sourceColor, 117,
      201, 202, 203, 0,
    ]);
    for (const mode of ["standard", "deuteranopia", "protanopia", "tritanopia"] as const) {
      const first = applyHabitatPaletteTransform(source, 2, catalog, mode);
      const second = applyHabitatPaletteTransform(source, 2, catalog, mode);
      expect(first).toEqual(second);
      const expected = PARKLAND_HABITAT_MANIFEST.paletteTransforms[mode].woodland_floor.mappings[0].to;
      expect([...first.slice(0, 3)]).toEqual(mode === "standard" ? [...sourceColor] : [...expected]);
      expect(first[3]).toBe(117);
      expect([...first.slice(4)]).toEqual([201, 202, 203, 0]);
    }
  });

  it("loads only requested static tier URLs, shares subtexture sources, bounds residency, and preserves Assets textures", async () => {
    const loaded: string[] = [];
    const bases: PIXI.Texture[] = [];
    const owned: PIXI.Texture[] = [];
    const subtextures: Array<PIXI.Texture & { source: unknown }> = [];
    const loader = createHabitatFieldAtlasLoader({
      maxEntries: 2,
      loadTexture: async (url) => {
        loaded.push(url);
        const tier = (Object.entries(PARKLAND_HABITAT_ATLAS_URLS).find(([, value]) => value === url)?.[0] ?? "high") as "high" | "medium" | "low";
        const catalog = PARKLAND_HABITAT_CATALOGS[tier];
        const base = texture(catalog.width, catalog.height);
        bases.push(base);
        return base;
      },
      createPaletteTexture: (_source, catalog) => {
        const result = texture(catalog.width, catalog.height);
        owned.push(result);
        return result;
      },
      createSubTexture: (source) => {
        const result = { ...texture(64, 32), source: source.source } as PIXI.Texture & { source: unknown };
        subtextures.push(result);
        return result;
      },
    });

    const high = await loader.load("high", "standard");
    const ids = Object.keys(high.catalog.frames);
    expect(high.frameTexture(ids[0])?.source).toBe(high.frameTexture(ids[1])?.source);
    await loader.load("medium", "deuteranopia");
    await loader.load("low", "protanopia");

    expect(loaded).toEqual([
      PARKLAND_HABITAT_ATLAS_URLS.high,
      PARKLAND_HABITAT_ATLAS_URLS.medium,
      PARKLAND_HABITAT_ATLAS_URLS.low,
    ]);
    expect(loader.residency()).toEqual(["medium:deuteranopia", "low:protanopia"]);
    expect(bases.every((base) => vi.mocked(base.destroy).mock.calls.length === 0)).toBe(true);
    expect(subtextures[0].destroy).toHaveBeenCalledWith(false);

    loader.destroy();
    await Promise.resolve();
    expect(bases.every((base) => vi.mocked(base.destroy).mock.calls.length === 0)).toBe(true);
    expect(owned.every((item) => vi.mocked(item.destroy).mock.calls.some(([destroySource]) => destroySource === true))).toBe(true);
  });
});
