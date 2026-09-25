import * as PIXI from "pixi.js";
import manifestJson from "../assets/terrain/parkland-habitat-4x/manifest.json";
import manifestHashText from "../assets/terrain/parkland-habitat-4x/manifest.sha256?raw";
import highAtlasUrl from "../assets/terrain/parkland-habitat-4x/high/habitat-atlas.png?url";
import mediumAtlasUrl from "../assets/terrain/parkland-habitat-4x/medium/habitat-atlas.png?url";
import lowAtlasUrl from "../assets/terrain/parkland-habitat-4x/low/habitat-atlas.png?url";
import type { ColorVisionMode } from "../game/onboarding/profile";
import type {
  ParklandHabitatAtlasCatalog,
  ParklandHabitatAtlasFrame,
  ParklandHabitatFamily,
} from "../game/render/habitatFieldTopology";

export type HabitatAtlasTier = "high" | "medium" | "low";

interface PaletteMapping {
  readonly from: readonly [number, number, number];
  readonly to: readonly [number, number, number];
}

interface PaletteTransform {
  readonly patternId: string;
  readonly mappings: readonly PaletteMapping[];
}

interface HabitatManifest {
  readonly schema: "ParklandHabitatFieldManifestV1";
  readonly version: 1;
  readonly paletteTransforms: Readonly<Record<
    ColorVisionMode,
    Readonly<Record<ParklandHabitatFamily, PaletteTransform>>
  >>;
  readonly tiers: Readonly<Record<HabitatAtlasTier, {
    readonly tier: HabitatAtlasTier;
    readonly scale: number;
    readonly width: number;
    readonly height: number;
    readonly frameCount: number;
    readonly gutterPx: number;
    readonly image: string;
    readonly json: string;
    readonly frames: Readonly<Record<string, ParklandHabitatAtlasFrame>>;
  }>>;
}

export const PARKLAND_HABITAT_MANIFEST = manifestJson as unknown as HabitatManifest;
export const PARKLAND_HABITAT_MANIFEST_HASH = manifestHashText.trim().split(/\s+/)[0] ?? "";

function catalogFromManifest(tier: HabitatAtlasTier): ParklandHabitatAtlasCatalog {
  const source = PARKLAND_HABITAT_MANIFEST.tiers[tier];
  return {
    schema: "ParklandHabitatFieldAtlasV1",
    version: 1,
    tier,
    image: source.image.split("/").at(-1) ?? "habitat-atlas.png",
    width: source.width,
    height: source.height,
    gutterPx: source.gutterPx,
    frameCount: source.frameCount,
    frames: source.frames,
  };
}

export const PARKLAND_HABITAT_CATALOGS: Readonly<Record<HabitatAtlasTier, ParklandHabitatAtlasCatalog>> = {
  high: catalogFromManifest("high"),
  medium: catalogFromManifest("medium"),
  low: catalogFromManifest("low"),
};

export const PARKLAND_HABITAT_ATLAS_URLS: Readonly<Record<HabitatAtlasTier, string>> = {
  high: highAtlasUrl,
  medium: mediumAtlasUrl,
  low: lowAtlasUrl,
};

function semanticFrame(frame: ParklandHabitatAtlasFrame): string {
  return JSON.stringify({
    id: frame.id,
    family: frame.family,
    topologyRole: frame.topologyRole,
    direction: frame.direction,
    corner: frame.corner,
    variant: frame.variant,
    canonicalMask: frame.canonicalMask ?? null,
    edgeAnchors: frame.edgeAnchors,
  });
}

function normalizedAnchor(frame: ParklandHabitatAtlasFrame): readonly [number, number] {
  return [frame.anchor.x / frame.frame.width, frame.anchor.y / frame.frame.height];
}

function sameNumber(left: number, right: number): boolean {
  return Math.abs(left - right) <= Number.EPSILON * 8;
}

/** Validates the cross-tier ID, semantic, and normalized-anchor contract before any image load. */
export function habitatAtlasParityDiagnostics(
  catalogs: Readonly<Record<HabitatAtlasTier, ParklandHabitatAtlasCatalog>> = PARKLAND_HABITAT_CATALOGS,
): readonly string[] {
  const diagnostics: string[] = [];
  const reference = catalogs.high;
  const referenceIds = Object.keys(reference.frames).sort();
  for (const tier of ["high", "medium", "low"] as const) {
    const catalog = catalogs[tier];
    const manifestTier = PARKLAND_HABITAT_MANIFEST.tiers[tier];
    if (catalog.schema !== "ParklandHabitatFieldAtlasV1" || catalog.version !== 1) {
      diagnostics.push(`${tier}: invalid atlas schema/version`);
    }
    if (catalog.tier !== tier) diagnostics.push(`${tier}: catalog tier is ${catalog.tier}`);
    if (catalog.width !== manifestTier.width || catalog.height !== manifestTier.height) {
      diagnostics.push(`${tier}: atlas dimensions do not match manifest`);
    }
    if (catalog.frameCount !== manifestTier.frameCount || Object.keys(catalog.frames).length !== catalog.frameCount) {
      diagnostics.push(`${tier}: frame count does not match manifest/catalog`);
    }
    const ids = Object.keys(catalog.frames).sort();
    if (ids.join("\n") !== referenceIds.join("\n")) diagnostics.push(`${tier}: frame IDs differ from high tier`);
    for (const id of referenceIds) {
      const expected = reference.frames[id];
      const actual = catalog.frames[id];
      if (!expected || !actual) continue;
      if (semanticFrame(actual) !== semanticFrame(expected)) diagnostics.push(`${tier}:${id}: semantic metadata differs`);
      const [expectedX, expectedY] = normalizedAnchor(expected);
      const [actualX, actualY] = normalizedAnchor(actual);
      if (!sameNumber(actualX, expectedX) || !sameNumber(actualY, expectedY)) {
        diagnostics.push(`${tier}:${id}: normalized anchor differs`);
      }
      if (!sameNumber(actual.frame.width / manifestTier.scale, expected.frame.width / 4)
        || !sameNumber(actual.frame.height / manifestTier.scale, expected.frame.height / 4)) {
        diagnostics.push(`${tier}:${id}: normalized frame footprint differs`);
      }
    }
  }
  return diagnostics;
}

/** Pure palette application used by the browser loader and deterministic unit tests. */
export function applyHabitatPaletteTransform(
  source: Uint8ClampedArray,
  width: number,
  catalog: ParklandHabitatAtlasCatalog,
  colorMode: ColorVisionMode,
  transforms = PARKLAND_HABITAT_MANIFEST.paletteTransforms,
): Uint8ClampedArray {
  const output = new Uint8ClampedArray(source);
  if (colorMode === "standard") return output;
  for (const frame of Object.values(catalog.frames)) {
    const mappings = transforms[colorMode][frame.family].mappings;
    const maxY = Math.min(catalog.height, frame.frame.y + frame.frame.height);
    const maxX = Math.min(width, frame.frame.x + frame.frame.width);
    for (let y = Math.max(0, frame.frame.y); y < maxY; y += 1) {
      for (let x = Math.max(0, frame.frame.x); x < maxX; x += 1) {
        const offset = (y * width + x) * 4;
        if (output[offset + 3] === 0) continue;
        const mapping = mappings.find(({ from }) => (
          output[offset] === from[0] && output[offset + 1] === from[1] && output[offset + 2] === from[2]
        ));
        if (!mapping) continue;
        output[offset] = mapping.to[0];
        output[offset + 1] = mapping.to[1];
        output[offset + 2] = mapping.to[2];
      }
    }
  }
  return output;
}

export interface LoadedHabitatAtlas {
  readonly tier: HabitatAtlasTier;
  readonly colorMode: ColorVisionMode;
  readonly catalog: ParklandHabitatAtlasCatalog;
  readonly manifestHash: string;
  frameTexture(frameId: string): PIXI.Texture | null;
}

export interface HabitatFieldAtlasLoader {
  load(tier: HabitatAtlasTier, colorMode: ColorVisionMode): Promise<LoadedHabitatAtlas>;
  destroy(): void;
  residency(): readonly string[];
}

export interface HabitatFieldAtlasLoaderDependencies {
  readonly catalogs?: Readonly<Record<HabitatAtlasTier, ParklandHabitatAtlasCatalog>>;
  readonly urls?: Readonly<Record<HabitatAtlasTier, string>>;
  readonly loadTexture?: (url: string) => Promise<PIXI.Texture>;
  readonly createPaletteTexture?: (
    source: PIXI.Texture,
    catalog: ParklandHabitatAtlasCatalog,
    colorMode: ColorVisionMode,
  ) => PIXI.Texture;
  readonly createSubTexture?: (source: PIXI.Texture, frame: ParklandHabitatAtlasFrame) => PIXI.Texture;
  readonly maxEntries?: number;
}

function defaultPaletteTexture(
  source: PIXI.Texture,
  catalog: ParklandHabitatAtlasCatalog,
  colorMode: ColorVisionMode,
): PIXI.Texture {
  const canvas = document.createElement("canvas");
  canvas.width = catalog.width;
  canvas.height = catalog.height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Habitat atlas palette canvas is unavailable");
  const resource = (source.source as unknown as { resource?: CanvasImageSource }).resource;
  if (!resource) throw new Error("Habitat atlas texture has no readable image resource");
  context.drawImage(resource, 0, 0, catalog.width, catalog.height);
  const image = context.getImageData(0, 0, catalog.width, catalog.height);
  image.data.set(applyHabitatPaletteTransform(image.data, catalog.width, catalog, colorMode));
  context.putImageData(image, 0, 0);
  return PIXI.Texture.from(canvas);
}

function defaultSubTexture(source: PIXI.Texture, frame: ParklandHabitatAtlasFrame): PIXI.Texture {
  return new PIXI.Texture({
    source: source.source,
    frame: new PIXI.Rectangle(frame.frame.x, frame.frame.y, frame.frame.width, frame.frame.height),
  });
}

interface CacheEntry extends LoadedHabitatAtlas {
  readonly source: PIXI.Texture;
  readonly ownedSource: boolean;
  readonly frames: Map<string, PIXI.Texture>;
  disposed: boolean;
}

/** Selected-tier-only, bounded LRU loader. Assets-owned source textures are never destroyed. */
export function createHabitatFieldAtlasLoader(
  dependencies: HabitatFieldAtlasLoaderDependencies = {},
): HabitatFieldAtlasLoader {
  const catalogs = dependencies.catalogs ?? PARKLAND_HABITAT_CATALOGS;
  const urls = dependencies.urls ?? PARKLAND_HABITAT_ATLAS_URLS;
  const loadTexture = dependencies.loadTexture ?? (async (url) => await PIXI.Assets.load(url) as PIXI.Texture);
  const createPaletteTexture = dependencies.createPaletteTexture ?? defaultPaletteTexture;
  const createSubTexture = dependencies.createSubTexture ?? defaultSubTexture;
  const maxEntries = Math.max(1, Math.floor(dependencies.maxEntries ?? 4));
  const parity = habitatAtlasParityDiagnostics(catalogs);
  const cache = new Map<string, Promise<CacheEntry>>();
  let destroyed = false;

  const disposeEntry = (entry: CacheEntry) => {
    if (entry.disposed) return;
    entry.disposed = true;
    for (const texture of entry.frames.values()) texture.destroy(false);
    entry.frames.clear();
    if (entry.ownedSource) entry.source.destroy(true);
  };

  const evict = (key: string, promise: Promise<CacheEntry>) => {
    if (cache.get(key) === promise) cache.delete(key);
    void promise.then(disposeEntry, () => {});
  };

  return {
    async load(tier, colorMode) {
      if (destroyed) throw new Error("Habitat atlas loader is destroyed");
      if (parity.length > 0) throw new Error(`Habitat atlas tier parity failed: ${parity.join("; ")}`);
      const key = `${tier}:${colorMode}`;
      let promise = cache.get(key);
      if (promise) {
        cache.delete(key);
        cache.set(key, promise);
        return await promise;
      }
      promise = (async (): Promise<CacheEntry> => {
        const catalog = catalogs[tier];
        const sharedSource = await loadTexture(urls[tier]);
        if (sharedSource.width !== catalog.width || sharedSource.height !== catalog.height) {
          throw new Error(`${tier} habitat atlas image dimensions do not match its catalog`);
        }
        const ownedSource = colorMode !== "standard";
        const source = ownedSource
          ? createPaletteTexture(sharedSource, catalog, colorMode)
          : sharedSource;
        const frames = new Map<string, PIXI.Texture>();
        const entry: CacheEntry = {
          tier,
          colorMode,
          catalog,
          manifestHash: PARKLAND_HABITAT_MANIFEST_HASH,
          source,
          ownedSource,
          frames,
          disposed: false,
          frameTexture(frameId) {
            if (entry.disposed) return null;
            const record = catalog.frames[frameId];
            if (!record) return null;
            let texture = frames.get(frameId);
            if (!texture) {
              texture = createSubTexture(source, record);
              frames.set(frameId, texture);
            }
            return texture;
          },
        };
        if (destroyed || cache.get(key) !== promise) disposeEntry(entry);
        return entry;
      })();
      cache.set(key, promise);
      void promise.catch(() => {
        if (cache.get(key) === promise) cache.delete(key);
      });
      while (cache.size > maxEntries) {
        const oldest = cache.entries().next().value as [string, Promise<CacheEntry>] | undefined;
        if (!oldest) break;
        evict(oldest[0], oldest[1]);
      }
      return await promise;
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      for (const [key, promise] of cache) evict(key, promise);
    },
    residency: () => [...cache.keys()],
  };
}
