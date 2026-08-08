import { Assets, Spritesheet, Texture } from "pixi.js";
import type { TerrainAtlasFrame } from "../game/render/terrainMaterials";
import type { TerrainDetailFrame } from "../game/render/terrainDetails";
import {
  NATURAL_PROP_FRAMES,
  missingNaturalPropFrames,
  type NaturalPropFrame,
} from "../game/render/naturalProps";
import type { LandTheme, Terrain } from "../game/models/types";
import { BIOME_KEYS, getBiomeDefinition } from "../game/models/biomes";
import type { SeasonName } from "../game/seasons/types";
import {
  normalizeAtlasManifest,
  type AtlasManifest,
  type AtlasQuality,
  type AtlasSeasonalFrameFamily,
  type AtlasSeasonalOverlay,
} from "./atlasManifest";

export type { AtlasQuality } from "./atlasManifest";

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
const seasonalFrameSheets = new Map<string, Spritesheet>();
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
let activeActivationRequest = 0;
let activeGeneration = 0;
let legacyLoadAttempted = false;
const warned = new Set<string>();
export interface AtlasFallbackDiagnostic {
  requestedBiome: LandTheme;
  quality: AtlasQuality;
  season?: SeasonName;
  reason: string;
}
const fallbackDiagnostics: AtlasFallbackDiagnostic[] = [];

export type AtlasActivationStatus = "activated" | "fallback" | "superseded";

export interface AtlasRenderContext {
  readonly biome: LandTheme;
  readonly quality: AtlasQuality;
  readonly season: SeasonName | null;
  readonly bundleKey: string;
  readonly overlayKey: string | null;
  readonly generation: number;
  readonly requestId: number;
  readonly status: Exclude<AtlasActivationStatus, "superseded">;
}

export interface AtlasLoadResult {
  readonly status: AtlasActivationStatus;
  readonly requestId: number;
  readonly context: AtlasRenderContext | null;
}

export interface AtlasActivationSnapshot {
  /** Request that produced the active generation. */
  readonly requestId: number;
  /** Most recently started request; differs while a transition is in flight. */
  readonly latestRequestId: number;
  readonly generation: number;
  readonly bundleKey: string | null;
  readonly overlayKey: string | null;
}

/** Exact active generation consumed by the live renderer and browser evidence. */
export function atlasActivationSnapshot(): AtlasActivationSnapshot {
  return {
    requestId: activeActivationRequest,
    latestRequestId: activeLoadRequest,
    generation: activeGeneration,
    bundleKey: activeBundleKey,
    overlayKey: activeOverlayKey,
  };
}

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
  const [frameSheets, materials] = await Promise.all([
    Promise.all(Object.entries(overlay.frames).map(async ([family, file]) => [
      family as AtlasSeasonalFrameFamily,
      await loadRequiredSheetUrl(`${bundleRoot()}${file.json}`),
    ] as const)),
    loadFields(overlay.materials),
  ]);
  for (const [family, sheet] of frameSheets) {
    seasonalFrameSheets.set(`${overlayKey}:${family}`, sheet);
  }
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
): Promise<AtlasLoadResult> {
  const requestId = ++activeLoadRequest;
  const bundleKey = `${theme}:${quality}`;
  const superseded = (): AtlasLoadResult => ({
    status: "superseded",
    requestId,
    context: null,
  });
  try {
    const manifest = await loadManifest();
    await loadCore(manifest);
    const key = bundleKey;
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
    if (requestId !== activeLoadRequest) return superseded();
    let nextOverlayKey: string | null = null;

    if (season) {
      // Seasonal ownership is stricter than base content routing: an overlay
      // always belongs to the requested biome and may never borrow another
      // biome's vegetation, structures, or dressing.
      const overlay = manifest.biomes[theme]?.[quality]?.seasonal[season];
      if (overlay && (
        Object.keys(overlay.materials).length > 0
        || Object.keys(overlay.frames).length > 0
      )) {
        const overlayKey = `${key}:${season}`;
        let overlayPromise = overlayPromises.get(overlayKey);
        if (!overlayPromise) {
          overlayPromise = loadOptionalOverlay(overlay, overlayKey);
          overlayPromises.set(overlayKey, overlayPromise);
        }
        try {
          await overlayPromise;
          if (requestId === activeLoadRequest) nextOverlayKey = overlayKey;
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
    if (requestId !== activeLoadRequest) return superseded();
    activeBundleKey = key;
    activeOverlayKey = nextOverlayKey;
    activeActivationRequest = requestId;
    const context: AtlasRenderContext = {
      biome: theme,
      quality,
      season: season ?? null,
      bundleKey: key,
      overlayKey: nextOverlayKey,
      generation: ++activeGeneration,
      requestId,
      status: "activated",
    };
    return { status: "activated", requestId, context };
  } catch (error) {
    if (requestId !== activeLoadRequest) return superseded();
    recordFallback({
      requestedBiome: theme,
      quality,
      reason: error instanceof Error ? error.message : String(error),
    });
    if (import.meta.env.DEV) {
      console.warn("[atlas] M35 bundle manifest unavailable; loading legacy atlases", error);
    }
    await loadLegacyAtlases();
    if (requestId !== activeLoadRequest) return superseded();
    // Publish one explicit procedural/legacy generation rather than leaving
    // a prior biome bundle selected behind a newly requested course context.
    activeBundleKey = null;
    activeOverlayKey = null;
    activeActivationRequest = requestId;
    const context: AtlasRenderContext = {
      biome: theme,
      quality,
      season: season ?? null,
      bundleKey,
      overlayKey: null,
      generation: ++activeGeneration,
      requestId,
      status: "fallback",
    };
    return { status: "fallback", requestId, context };
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

function requestedBundleKey(theme: LandTheme | undefined, quality: AtlasQuality): string {
  return `${getBiomeDefinition(theme).key}:${quality}`;
}

function activeOverlayFor(theme: LandTheme | undefined, quality: AtlasQuality): string | null {
  const key = requestedBundleKey(theme, quality);
  return activeBundleKey === key && activeOverlayKey?.startsWith(`${key}:`)
    ? activeOverlayKey
    : null;
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

/**
 * The bundle currently selected by the renderer. This is deliberately
 * distinct from residency: several biome/quality bundles may be cached, but
 * exactly one may supply frames to the live scene.
 */
export function activeBiomeBundle(): string | null {
  return activeBundleKey;
}

/** True only when that optional overlay exists and finished loading. */
export function loadedSeasonalOverlay(
  theme: LandTheme,
  quality: AtlasQuality,
  season: SeasonName,
): boolean {
  return loadedSeasonalOverlays.has(`${theme}:${quality}:${season}`);
}

export interface AtlasResidencySnapshot {
  readonly baseBundles: readonly string[];
  readonly seasonalOverlays: readonly string[];
  readonly seasonalFrameMaps: readonly string[];
  readonly materialFields: number;
  readonly seasonalMaterialFields: number;
}

/** Bounded key/count evidence; loaded textures remain cached across transitions. */
export function atlasResidencySnapshot(): AtlasResidencySnapshot {
  return {
    baseBundles: [...loadedBiomeBundles].sort(),
    seasonalOverlays: [...loadedSeasonalOverlays].sort(),
    seasonalFrameMaps: [...seasonalFrameSheets.keys()].sort(),
    materialFields: landscapeFields.size,
    seasonalMaterialFields: seasonalLandscapeFields.size,
  };
}

const naturalPropFrameNames: ReadonlySet<string> = new Set(NATURAL_PROP_FRAMES);

function frameFamily(name: AtlasFrame): "natural-props" | "buildings" | "decorations" {
  if (naturalPropFrameNames.has(name)) return "natural-props";
  if (
    name === "clubhouse"
    || name === "pro_shop"
    || name === "snack_bar"
    || name === "cart_rental"
    || /_(?:clubhouse|pro_shop|snack_bar|cart_rental)_t[123]$/u.test(name)
  ) return "buildings";
  return "decorations";
}

/** Typed seasonal lookup reserved for later family-specific renderers. */
export function getSeasonalFrame(
  theme: LandTheme | undefined,
  quality: AtlasQuality,
  family: AtlasSeasonalFrameFamily,
  name: string,
): Texture | null {
  const overlayKey = activeOverlayFor(theme, quality);
  if (!overlayKey) return null;
  return seasonalFrameSheets.get(`${overlayKey}:${family}`)?.textures[name] ?? null;
}

/**
 * A frame texture, or null when unavailable (caller uses its fallback).
 * Warns once per missing frame in dev.
 */
export function getPropFrame(name: AtlasFrame): Texture | null;
export function getPropFrame(theme: LandTheme | undefined, quality: AtlasQuality, name: AtlasFrame): Texture | null;
export function getPropFrame(
  themeOrName: LandTheme | AtlasFrame | undefined,
  quality?: AtlasQuality,
  explicitName?: AtlasFrame,
): Texture | null {
  const key = explicitName ? requestedBundleKey(themeOrName as LandTheme | undefined, quality!) : activeBundleKey;
  const name = explicitName ?? themeOrName as AtlasFrame;
  const family = frameFamily(name);
  const seasonal = explicitName
    ? getSeasonalFrame(themeOrName as LandTheme | undefined, quality!, family, name)
    : activeOverlayKey
      ? seasonalFrameSheets.get(`${activeOverlayKey}:${family}`)?.textures[name] ?? null
      : null;
  const base = explicitName
    ? family === "natural-props"
      ? (key ? naturalPropsSheets.get(key)?.textures[name] ?? null : null)
      : (key ? buildingsSheets.get(key)?.textures[name] ?? null : null)
    : family === "natural-props"
      ? (activeBundleKey ? naturalPropsSheets.get(activeBundleKey)?.textures[name] ?? null : null)
        ?? naturalPropsSheets.get("legacy")?.textures[name]
        ?? null
      : (activeBundleKey ? buildingsSheets.get(activeBundleKey)?.textures[name] ?? null : null)
        ?? buildingsSheets.get("legacy")?.textures[name]
        ?? null;
  const tex = seasonal ?? base;
  if (!tex) warnMissing(name, `[atlas] missing frame "${name}" — falling back to procedural sprite`);
  return tex;
}

/** Authored @2× terrain texture, kept at 64×32 logical world size. */
export function getTerrainFrame(name: TerrainAtlasFrame): Texture | null;
export function getTerrainFrame(theme: LandTheme | undefined, quality: AtlasQuality, name: TerrainAtlasFrame): Texture | null;
export function getTerrainFrame(
  themeOrName: LandTheme | TerrainAtlasFrame | undefined,
  quality?: AtlasQuality,
  explicitName?: TerrainAtlasFrame,
): Texture | null {
  const name = explicitName ?? themeOrName as TerrainAtlasFrame;
  const key = explicitName ? requestedBundleKey(themeOrName as LandTheme | undefined, quality!) : activeBundleKey;
  const tex = explicitName
    ? (key ? terrainSheets.get(key)?.textures[name] ?? null : null)
    : (activeBundleKey ? terrainSheets.get(activeBundleKey)?.textures[name] ?? null : null)
      ?? terrainSheets.get("legacy")?.textures[name]
      ?? null;
  if (!tex) warnMissing(name, `[atlas] missing terrain frame "${name}" — using safe material fallback`);
  return tex;
}

/** Optional @2× terrain-dressing sprite. Missing detail never affects play. */
export function getTerrainDetailFrame(
  theme: LandTheme | undefined,
  quality: AtlasQuality,
  name: TerrainDetailFrame,
): Texture | null {
  const tex = getSeasonalFrame(theme, quality, "terrain-details", name)
    ?? terrainDetailsSheets.get(requestedBundleKey(theme, quality))?.textures[name]
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
  seasonalFrameSheets.clear();
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
  activeActivationRequest = 0;
  activeGeneration = 0;
  legacyLoadAttempted = false;
  warned.clear();
  fallbackDiagnostics.length = 0;
}
