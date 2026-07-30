import { Assets, Spritesheet, Texture } from "pixi.js";
import type { TerrainAtlasFrame } from "../game/render/terrainMaterials";
import type { TerrainDetailFrame } from "../game/render/terrainDetails";
import { missingNaturalPropFrames, type NaturalPropFrame } from "../game/render/naturalProps";
import type { LandTheme, Terrain } from "../game/models/types";
import { BIOME_KEYS, getBiomeDefinition } from "../game/models/biomes";
import type { SeasonName } from "../game/seasons/types";
import {
  normalizeAtlasManifest,
  type AtlasManifest,
  type AtlasQuality,
  type AtlasSeasonalOverlay,
} from "./atlasManifest";

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
export type BuildingFrame = LegacyBuildingFrame | `${LandTheme}_${LegacyBuildingFrame}_t${1 | 2 | 3}`;
export type DecorationFrame = `${LandTheme}_${"fence" | "bench" | "tee_sign" | "lamp" | "bin" | "parked_cart" | "flower_bed" | "planter" | "ornamental_feature" | "bridge" | "boardwalk" | "bridge_approach"}`;
export type AtlasFrame = PropFrame | BuildingFrame | DecorationFrame;

/**
 * Golfer character frames (ZKU-153) live in their own atlas. Names follow
 * `golfer{variant}_{anim}[_t]_{row}_{col}` where `_t` marks the grayscale
 * clothing layer that gets the palette-swap tint at runtime. Row/column
 * semantics live in src/game/render/golferSprites.ts.
 */
export type GolferAnimName = "walk" | "idle" | "swing" | "putt" | "cheer" | "mad";
export type GolferFrame = `golfer${number}_${GolferAnimName}${"" | "_t"}_${number}_${number}`;

const terrainSheets = new Map<string, Spritesheet>();
const terrainDetailsSheets = new Map<string, Spritesheet>();
const naturalPropsSheets = new Map<string, Spritesheet>();
const buildingsSheets = new Map<string, Spritesheet>();
const landscapeFields = new Map<string, Texture>();
const seasonalPropsSheets = new Map<string, Spritesheet>();
const seasonalDecalSheets = new Map<string, Spritesheet>();
const seasonalLandscapeFields = new Map<string, Texture>();
let golfersSheet: Spritesheet | null = null;
let manifestPromise: Promise<AtlasManifest> | null = null;
let corePromise: Promise<void> | null = null;
const bundlePromises = new Map<string, Promise<void>>();
const overlayPromises = new Map<string, Promise<void>>();
const loadedBiomeBundles = new Set<string>();
const loadedSeasonalOverlays = new Set<string>();
let activeBundleKey: string | null = null;
let activeOverlayKey: string | null = null;
let activeLoadRequest = 0;
let legacyLoadAttempted = false;
const warned = new Set<string>();
export interface AtlasFallbackDiagnostic {
  requestedBiome: LandTheme;
  quality: AtlasQuality;
  season?: SeasonName;
  reason: string;
}
const fallbackDiagnostics: AtlasFallbackDiagnostic[] = [];

function recordFallback(diagnostic: AtlasFallbackDiagnostic): void {
  if (!fallbackDiagnostics.some((entry) =>
    entry.requestedBiome === diagnostic.requestedBiome
    && entry.quality === diagnostic.quality
    && entry.season === diagnostic.season
    && entry.reason === diagnostic.reason
  )) fallbackDiagnostics.push(diagnostic);
}

/** Bounded, read-only evidence that a biome used renderer-native fallback. */
export function atlasFallbackDiagnostics(): readonly AtlasFallbackDiagnostic[] {
  return fallbackDiagnostics.slice(-32);
}

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

async function loadRequiredSheetUrl(url: string): Promise<Spritesheet> {
  return (await Assets.load(url)) as Spritesheet;
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
    const request = fetch(`${bundleRoot()}manifest.json`, { cache: "no-cache" }).then(async (response) => {
      if (!response.ok) throw new Error(`manifest request failed (${response.status})`);
      return normalizeAtlasManifest(await response.json(), BIOME_KEYS);
    });
    manifestPromise = request;
    void request.catch(() => {
      if (manifestPromise === request) manifestPromise = null;
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

async function loadFields(
  files: Partial<Record<Terrain, { image: string }>>,
): Promise<Array<readonly [Terrain, Texture]>> {
  return Promise.all(Object.entries(files).map(async ([terrainName, asset]) => {
    const texture = await Assets.load(`${bundleRoot()}${asset.image}`) as Texture;
    texture.source.style.addressMode = "repeat";
    texture.source.style.scaleMode = "linear";
    return [terrainName as Terrain, texture] as const;
  }));
}

async function loadOptionalOverlay(
  overlay: AtlasSeasonalOverlay,
  overlayKey: string,
): Promise<void> {
  const [props, decals, materials] = await Promise.all([
    overlay.props
      ? loadRequiredSheetUrl(`${bundleRoot()}${overlay.props.json}`)
      : Promise.resolve(null),
    overlay.decals
      ? loadRequiredSheetUrl(`${bundleRoot()}${overlay.decals.json}`)
      : Promise.resolve(null),
    loadFields(overlay.materials),
  ]);
  if (props) seasonalPropsSheets.set(overlayKey, props);
  if (decals) seasonalDecalSheets.set(overlayKey, decals);
  for (const [terrainName, texture] of materials) {
    seasonalLandscapeFields.set(`${overlayKey}:${terrainName}`, texture);
  }
  loadedSeasonalOverlays.add(overlayKey);
}

/**
 * Loads only the selected biome/tier and, when available, the requested
 * season's incremental overlay. Base and overlay promises have separate cache
 * identities so a missing optional overlay cannot poison the playable base.
 */
export async function loadAtlases(
  theme: LandTheme = BIOME_KEYS[0],
  quality: AtlasQuality = "high",
  season?: SeasonName | null,
): Promise<void> {
  const requestId = ++activeLoadRequest;
  try {
    const manifest = await loadManifest();
    await loadCore(manifest);
    const key = `${theme}:${quality}`;
    const content = getBiomeDefinition(theme).content;
    let promise = bundlePromises.get(key);
    if (!promise) {
      promise = (async () => {
        const buildingsBundle = manifest.biomes[content.structures.buildings]?.[quality]?.base;
        const terrainBundle = manifest.biomes[content.materials.terrain]?.[quality]?.base;
        const detailsBundle = manifest.biomes[content.materials.details]?.[quality]?.base;
        const propsBundle = manifest.biomes[content.props.natural]?.[quality]?.base;
        const fieldsBundle = manifest.biomes[content.materials.fields]?.[quality]?.base;
        if (!buildingsBundle || !terrainBundle || !detailsBundle || !propsBundle || !fieldsBundle) {
          throw new Error(`manifest has no complete "${theme}" ${quality} content-owner route`);
        }
        const [buildings, terrain, details, props, fields] = await Promise.all([
          loadRequiredSheetUrl(`${bundleRoot()}${buildingsBundle.buildings.json}`),
          loadRequiredSheetUrl(`${bundleRoot()}${terrainBundle.terrain.json}`),
          detailsBundle.details
            ? loadRequiredSheetUrl(`${bundleRoot()}${detailsBundle.details.json}`)
            : Promise.resolve(null),
          propsBundle.props
            ? loadRequiredSheetUrl(`${bundleRoot()}${propsBundle.props.json}`)
            : Promise.resolve(null),
          quality === "low"
            ? Promise.resolve([])
            : loadFields(fieldsBundle.fields),
        ]);
        if (buildings) buildingsSheets.set(key, buildings);
        if (terrain) terrainSheets.set(key, terrain);
        if (details) terrainDetailsSheets.set(key, details);
        if (props) naturalPropsSheets.set(key, props);
        for (const [terrainName, texture] of fields) {
          landscapeFields.set(`${key}:${terrainName}`, texture);
        }
        loadedBiomeBundles.add(key);
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
    // A theme/quality/season transition may have started while this base was
    // loading. Keep the completed bundle cached, but never let an older
    // request activate its base or begin downloading a now-stale overlay.
    if (requestId !== activeLoadRequest) return;
    activeBundleKey = key;
    activeOverlayKey = null;

    if (season) {
      const materialsOverlay = manifest.biomes[content.materials.fields]?.[quality]?.seasonal[season];
      const propsOverlay = manifest.biomes[content.props.natural]?.[quality]?.seasonal[season];
      const decalsOverlay = manifest.biomes[content.materials.details]?.[quality]?.seasonal[season];
      const overlay: AtlasSeasonalOverlay = {
        materials: materialsOverlay?.materials ?? {},
        props: propsOverlay?.props ?? null,
        decals: decalsOverlay?.decals ?? null,
      };
      if (Object.keys(overlay.materials).length > 0 || overlay.props || overlay.decals) {
        const overlayKey = `${key}:${season}`;
        let overlayPromise = overlayPromises.get(overlayKey);
        if (!overlayPromise) {
          overlayPromise = loadOptionalOverlay(overlay, overlayKey);
          overlayPromises.set(overlayKey, overlayPromise);
        }
        try {
          await overlayPromise;
          if (requestId === activeLoadRequest) activeOverlayKey = overlayKey;
        } catch (error) {
          // Optional overlays fail independently. Keep the base active and let
          // a later request retry the same seasonal identity.
          if (overlayPromises.get(overlayKey) === overlayPromise) overlayPromises.delete(overlayKey);
          if (requestId === activeLoadRequest) {
            recordFallback({
              requestedBiome: theme,
              quality,
              season,
              reason: `optional seasonal overlay unavailable: ${error instanceof Error ? error.message : String(error)}`,
            });
          }
        }
      }
    }
    const props = naturalPropsSheets.get(key);
    if (props && import.meta.env.DEV) {
      const missing = missingNaturalPropFrames((frame) => (
        !frame.startsWith(`${theme}_`) || Boolean(props.textures[frame])
      ));
      if (missing.length > 0) console.warn(`[atlas] ${key} natural-props atlas is missing ${missing.length} registry frames`, missing);
    }
  } catch (error) {
    if (requestId !== activeLoadRequest) return;
    recordFallback({
      requestedBiome: theme,
      quality,
      reason: error instanceof Error ? error.message : String(error),
    });
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
  const requested = getBiomeDefinition(theme).key;
  const key = `${requested}:${quality}`;
  const overlay = activeBundleKey === key && activeOverlayKey
    ? seasonalLandscapeFields.get(`${activeOverlayKey}:${terrain}`)
    : null;
  return overlay ?? landscapeFields.get(`${key}:${terrain}`) ?? null;
}

function warnMissing(name: string, message: string): void {
  if (import.meta.env.DEV && !warned.has(name)) {
    warned.add(name);
    console.warn(message);
  }
}

/** Preload validation for the selected biome bundle. */
export function loadedBiomeBundle(theme: LandTheme, quality: AtlasQuality): boolean {
  return loadedBiomeBundles.has(`${theme}:${quality}`);
}

/** True only when that optional overlay exists and finished loading. */
export function loadedSeasonalOverlay(
  theme: LandTheme,
  quality: AtlasQuality,
  season: SeasonName,
): boolean {
  return loadedSeasonalOverlays.has(`${theme}:${quality}:${season}`);
}

/**
 * A frame texture, or null when unavailable (caller uses its fallback).
 * Warns once per missing frame in dev.
 */
export function getPropFrame(name: AtlasFrame): Texture | null {
  const tex = (activeOverlayKey
    ? seasonalPropsSheets.get(activeOverlayKey)?.textures[name] ?? null
    : null)
    ?? (activeBundleKey ? naturalPropsSheets.get(activeBundleKey)?.textures[name] ?? null : null)
    ?? (activeBundleKey ? buildingsSheets.get(activeBundleKey)?.textures[name] ?? null : null)
    ?? naturalPropsSheets.get("legacy")?.textures[name]
    ?? buildingsSheets.get("legacy")?.textures[name]
    ?? null;
  if (!tex) warnMissing(name, `[atlas] missing frame "${name}" — falling back to procedural sprite`);
  return tex;
}

/** Authored @2× terrain texture, kept at 64×32 logical world size. */
export function getTerrainFrame(name: TerrainAtlasFrame): Texture | null {
  const tex = (activeBundleKey ? terrainSheets.get(activeBundleKey)?.textures[name] ?? null : null)
    ?? terrainSheets.get("legacy")?.textures[name]
    ?? null;
  if (!tex) warnMissing(name, `[atlas] missing terrain frame "${name}" — using safe material fallback`);
  return tex;
}

/** Optional @2× terrain-dressing sprite. Missing detail never affects play. */
export function getTerrainDetailFrame(name: TerrainDetailFrame): Texture | null {
  const tex = (activeOverlayKey
    ? seasonalDecalSheets.get(activeOverlayKey)?.textures[name] ?? null
    : null)
    ?? (activeBundleKey ? terrainDetailsSheets.get(activeBundleKey)?.textures[name] ?? null : null)
    ?? terrainDetailsSheets.get("legacy")?.textures[name]
    ?? null;
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
  seasonalPropsSheets.clear();
  seasonalDecalSheets.clear();
  seasonalLandscapeFields.clear();
  golfersSheet = null;
  manifestPromise = null;
  corePromise = null;
  bundlePromises.clear();
  overlayPromises.clear();
  loadedBiomeBundles.clear();
  loadedSeasonalOverlays.clear();
  activeBundleKey = null;
  activeOverlayKey = null;
  activeLoadRequest = 0;
  legacyLoadAttempted = false;
  warned.clear();
  fallbackDiagnostics.length = 0;
}
