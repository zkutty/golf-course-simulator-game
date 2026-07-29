import { Assets, Spritesheet, Texture } from "pixi.js";
import type { TerrainAtlasFrame } from "../game/render/terrainMaterials";
import type { TerrainDetailFrame } from "../game/render/terrainDetails";
import { missingNaturalPropFrames, type NaturalPropFrame } from "../game/render/naturalProps";
import type { LandTheme, Terrain } from "../game/models/types";

/**
 * Typed texture-atlas loader (ZKU-147).
 *
 * Atlases are packed by `npm run build:atlas` from the typed terrain and
 * sprite source folders into `public/atlases/` (see ART_GUIDE.md). Frame
 * names are TS unions/templates so a typo is a compile error.
 *
 * Loading is tolerant by design: if an atlas or frame is missing the
 * renderer falls back to its legacy procedural path and warns once — art
 * can land incrementally without code changes.
 */

export type PropFrame = NaturalPropFrame;
export type LegacyBuildingFrame = "clubhouse" | "pro_shop" | "snack_bar" | "cart_rental";
export type BuildingFrame = LegacyBuildingFrame | `${"parkland" | "links" | "desert"}_${LegacyBuildingFrame}_t${1 | 2 | 3}`;
export type DecorationFrame = `${"parkland" | "links" | "desert"}_${"fence" | "bench" | "tee_sign" | "lamp" | "bin" | "parked_cart" | "flower_bed" | "planter" | "ornamental_feature" | "bridge" | "boardwalk" | "bridge_approach"}`;
export type AtlasFrame = PropFrame | BuildingFrame | DecorationFrame;

/**
 * Golfer character frames (ZKU-153) live in their own atlas. Names follow
 * `golfer{variant}_{anim}[_t]_{row}_{col}` where `_t` marks the grayscale
 * clothing layer that gets the palette-swap tint at runtime. Row/column
 * semantics live in src/game/render/golferSprites.ts.
 */
export type GolferAnimName = "walk" | "idle" | "swing" | "putt" | "cheer" | "mad";
export type GolferFrame = `golfer${number}_${GolferAnimName}${"" | "_t"}_${number}_${number}`;

type AtlasQuality = "high" | "medium" | "low";
interface BundleFile {
  json: string;
  image: string;
}
interface FieldFile {
  image: string;
}
interface BiomeBundle {
  buildings: BundleFile;
  terrain: BundleFile;
  details: BundleFile | null;
  props: BundleFile | null;
  fields: Partial<Record<Terrain, FieldFile>>;
}
interface AtlasManifest {
  version: 1;
  core: {
    golfers: BundleFile;
  };
  biomes: Record<LandTheme, Record<AtlasQuality, BiomeBundle>>;
}

const terrainSheets = new Map<string, Spritesheet>();
const terrainDetailsSheets = new Map<string, Spritesheet>();
const naturalPropsSheets = new Map<string, Spritesheet>();
const buildingsSheets = new Map<string, Spritesheet>();
const landscapeFields = new Map<string, Texture>();
let golfersSheet: Spritesheet | null = null;
let manifestPromise: Promise<AtlasManifest> | null = null;
let corePromise: Promise<void> | null = null;
const bundlePromises = new Map<string, Promise<void>>();
let legacyLoadAttempted = false;
const warned = new Set<string>();

const bundleRoot = () => `${import.meta.env.BASE_URL}atlases/biomes/`;

async function loadSheetUrl(url: string, label: string): Promise<Spritesheet | null> {
  try {
    return (await Assets.load(url)) as Spritesheet;
  } catch (err) {
    if (import.meta.env.DEV) {
      console.warn(`[atlas] ${label} atlas unavailable, using procedural fallbacks:`, err);
    }
    return null;
  }
}

async function loadLegacyAtlases(): Promise<void> {
  if (legacyLoadAttempted) return;
  legacyLoadAttempted = true;
  const load = async (name: string): Promise<Spritesheet | null> => {
    try {
      const url = `${import.meta.env.BASE_URL}atlases/${name}.json`;
      return (await Assets.load(url)) as Spritesheet;
    } catch (err) {
      if (import.meta.env.DEV) {
        console.warn(`[atlas] ${name} atlas unavailable, using procedural fallbacks:`, err);
      }
      return null;
    }
  };
  const [terrainSheet, terrainDetailsSheet, naturalPropsSheet, buildings, golfers] = await Promise.all([
    load("terrain"),
    load("terrain-details"),
    load("natural-props"),
    load("buildings-decor"),
    load("golfers"),
  ]);
  if (terrainSheet) terrainSheets.set("legacy", terrainSheet);
  if (terrainDetailsSheet) terrainDetailsSheets.set("legacy", terrainDetailsSheet);
  if (naturalPropsSheet) naturalPropsSheets.set("legacy", naturalPropsSheet);
  if (buildings) buildingsSheets.set("legacy", buildings);
  golfersSheet = golfers;
}

async function loadManifest(): Promise<AtlasManifest> {
  if (!manifestPromise) {
    manifestPromise = fetch(`${bundleRoot()}manifest.json`, { cache: "no-cache" }).then(async (response) => {
      if (!response.ok) throw new Error(`manifest request failed (${response.status})`);
      const manifest = await response.json() as AtlasManifest;
      if (manifest.version !== 1) throw new Error(`unsupported atlas manifest ${String(manifest.version)}`);
      return manifest;
    });
  }
  return manifestPromise;
}

async function loadCore(manifest: AtlasManifest): Promise<void> {
  if (!corePromise) {
    corePromise = (async () => {
      golfersSheet = await loadSheetUrl(
        `${bundleRoot()}${manifest.core.golfers.json}`,
        "core golfers",
      );
    })();
  }
  return corePromise;
}

/** Loads only the selected biome/tier; subsequent selections stay memory/browser cached. */
export async function loadAtlases(
  theme: LandTheme = "parkland",
  quality: AtlasQuality = "high",
): Promise<void> {
  try {
    const manifest = await loadManifest();
    await loadCore(manifest);
    const key = `${theme}:${quality}`;
    let promise = bundlePromises.get(key);
    if (!promise) {
      promise = (async () => {
        const bundle = manifest.biomes[theme][quality];
        const [buildings, terrain, details, props, fields] = await Promise.all([
          loadSheetUrl(`${bundleRoot()}${bundle.buildings.json}`, `${key} buildings and decor`),
          loadSheetUrl(`${bundleRoot()}${bundle.terrain.json}`, `${key} terrain`),
          bundle.details
            ? loadSheetUrl(`${bundleRoot()}${bundle.details.json}`, `${key} terrain details`)
            : Promise.resolve(null),
          bundle.props
            ? loadSheetUrl(`${bundleRoot()}${bundle.props.json}`, `${key} natural props`)
            : Promise.resolve(null),
          quality === "low"
            ? Promise.resolve([])
            : Promise.all(Object.entries(bundle.fields).map(async ([terrainName, asset]) => {
              const texture = await Assets.load(`${bundleRoot()}${asset.image}`) as Texture;
              texture.source.style.addressMode = "repeat";
              texture.source.style.scaleMode = "linear";
              return [terrainName as Terrain, texture] as const;
            })),
        ]);
        if (buildings) buildingsSheets.set(key, buildings);
        if (terrain) terrainSheets.set(key, terrain);
        if (details) terrainDetailsSheets.set(key, details);
        if (props) naturalPropsSheets.set(key, props);
        for (const [terrainName, texture] of fields) {
          landscapeFields.set(`${key}:${terrainName}`, texture);
        }
      })();
      bundlePromises.set(key, promise);
    }
    try {
      await promise;
    } catch (error) {
      // A transient network/offline failure must not poison this key forever;
      // the next theme/quality request should be able to retry the bundle.
      if (bundlePromises.get(key) === promise) bundlePromises.delete(key);
      throw error;
    }
    const props = naturalPropsSheets.get(key);
    if (props && import.meta.env.DEV) {
      const missing = missingNaturalPropFrames((frame) => (
        !frame.startsWith(`${theme}_`) || Boolean(props.textures[frame])
      ));
      if (missing.length > 0) console.warn(`[atlas] ${key} natural-props atlas is missing ${missing.length} registry frames`, missing);
    }
  } catch (error) {
    if (import.meta.env.DEV) {
      console.warn("[atlas] M35 bundle manifest unavailable; loading legacy atlases", error);
    }
    await loadLegacyAtlases();
  }
}

export function getLandscapeMaterialField(
  theme: LandTheme | undefined,
  terrain: Terrain,
  quality: Exclude<AtlasQuality, "low">,
): Texture | null {
  return landscapeFields.get(`${theme ?? "parkland"}:${quality}:${terrain}`) ?? null;
}

function textureFromSheets<T extends string>(
  sheets: Iterable<Spritesheet>,
  name: T,
): Texture | null {
  for (const sheet of sheets) {
    const texture = sheet.textures[name];
    if (texture) return texture;
  }
  return null;
}

function warnMissing(name: string, message: string): void {
  if (import.meta.env.DEV && !warned.has(name)) {
    warned.add(name);
    console.warn(message);
  }
}

/** Preload validation for the selected biome bundle. */
export function loadedBiomeBundle(theme: LandTheme, quality: AtlasQuality): boolean {
  return terrainSheets.has(`${theme}:${quality}`);
}

/**
 * A frame texture, or null when unavailable (caller uses its fallback).
 * Warns once per missing frame in dev.
 */
export function getPropFrame(name: AtlasFrame): Texture | null {
  const tex = textureFromSheets(naturalPropsSheets.values(), name)
    ?? textureFromSheets(buildingsSheets.values(), name);
  if (!tex) warnMissing(name, `[atlas] missing frame "${name}" — falling back to procedural sprite`);
  return tex;
}

/** Authored @2× terrain texture, kept at 64×32 logical world size. */
export function getTerrainFrame(name: TerrainAtlasFrame): Texture | null {
  const tex = textureFromSheets(terrainSheets.values(), name);
  if (!tex) warnMissing(name, `[atlas] missing terrain frame "${name}" — using safe material fallback`);
  return tex;
}

/** Optional @2× terrain-dressing sprite. Missing detail never affects play. */
export function getTerrainDetailFrame(name: TerrainDetailFrame): Texture | null {
  const tex = textureFromSheets(terrainDetailsSheets.values(), name);
  if (!tex && terrainDetailsSheets.size > 0) {
    warnMissing(name, `[atlas] missing terrain detail frame "${name}" — omitting optional dressing`);
  }
  return tex;
}

/** True when the golfer character atlas loaded (else render the dot tier). */
export function golfersAtlasReady(): boolean {
  return golfersSheet !== null;
}

/** A golfer frame texture, or null when unavailable. Warns once in dev. */
export function getGolferFrame(name: GolferFrame): Texture | null {
  const tex = golfersSheet?.textures[name] ?? null;
  if (!tex && golfersSheet && import.meta.env.DEV && !warned.has(name)) {
    warned.add(name);
    console.warn(`[atlas] missing golfer frame "${name}"`);
  }
  return tex;
}

/** Test hook: reset module state (unit tests only). */
export function __resetAtlasForTests(): void {
  terrainSheets.clear();
  terrainDetailsSheets.clear();
  naturalPropsSheets.clear();
  buildingsSheets.clear();
  landscapeFields.clear();
  golfersSheet = null;
  manifestPromise = null;
  corePromise = null;
  bundlePromises.clear();
  legacyLoadAttempted = false;
  warned.clear();
}
