import type { LandTheme, Terrain } from "../game/models/types";
import { SEASONS, type SeasonName } from "../game/seasons/types";

export const ATLAS_QUALITIES = ["high", "medium", "low"] as const;
export type AtlasQuality = (typeof ATLAS_QUALITIES)[number];

export interface AtlasBundleFile {
  readonly json: string;
  readonly image: string;
  readonly jsonBytes?: number;
  readonly imageBytes?: number;
  readonly frames?: number;
  readonly width?: number;
  readonly height?: number;
}

export interface AtlasFieldFile {
  readonly image: string;
  readonly bytes?: number;
  readonly width?: number;
  readonly height?: number;
}

export interface AtlasBaseBundle {
  readonly buildings: AtlasBundleFile;
  readonly terrain: AtlasBundleFile;
  readonly details: AtlasBundleFile | null;
  readonly props: AtlasBundleFile | null;
  readonly fields: Partial<Record<Terrain, AtlasFieldFile>>;
}

export interface AtlasSeasonalOverlay {
  /** Replacement landscape material fields for the current season only. */
  readonly materials: Partial<Record<Terrain, AtlasFieldFile>>;
  /** Optional vegetation/ground-prop sprites layered ahead of base props. */
  readonly props: AtlasBundleFile | null;
  /** Optional non-gameplay dressing layered ahead of base details. */
  readonly decals: AtlasBundleFile | null;
}

export interface AtlasTierBundle {
  readonly base: AtlasBaseBundle;
  readonly seasonal: Partial<Record<SeasonName, AtlasSeasonalOverlay>>;
}

export interface AtlasManifest {
  readonly version: 2;
  readonly sourceVersion: 1 | 2;
  readonly generatedBy?: string;
  readonly core: {
    readonly golfers: AtlasBundleFile;
  };
  readonly biomes: Record<LandTheme, Record<AtlasQuality, AtlasTierBundle>>;
}

type JsonObject = Record<string, unknown>;

function object(value: unknown, label: string): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as JsonObject;
}

function text(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}

function bundleFile(value: unknown, label: string): AtlasBundleFile {
  const source = object(value, label);
  return {
    ...source,
    json: text(source.json, `${label}.json`),
    image: text(source.image, `${label}.image`),
  } as unknown as AtlasBundleFile;
}

function optionalBundleFile(value: unknown, label: string): AtlasBundleFile | null {
  return value == null ? null : bundleFile(value, label);
}

function fields(value: unknown, label: string): Partial<Record<Terrain, AtlasFieldFile>> {
  const source = object(value ?? {}, label);
  return Object.fromEntries(Object.entries(source).map(([terrain, raw]) => {
    const field = object(raw, `${label}.${terrain}`);
    return [terrain, {
      ...field,
      image: text(field.image, `${label}.${terrain}.image`),
    }];
  })) as Partial<Record<Terrain, AtlasFieldFile>>;
}

function baseBundle(value: unknown, label: string): AtlasBaseBundle {
  const source = object(value, label);
  return {
    buildings: bundleFile(source.buildings, `${label}.buildings`),
    terrain: bundleFile(source.terrain, `${label}.terrain`),
    details: optionalBundleFile(source.details, `${label}.details`),
    props: optionalBundleFile(source.props, `${label}.props`),
    fields: fields(source.fields, `${label}.fields`),
  };
}

function seasonalOverlay(value: unknown, label: string): AtlasSeasonalOverlay {
  const source = object(value, label);
  return {
    materials: fields(source.materials, `${label}.materials`),
    props: optionalBundleFile(source.props, `${label}.props`),
    decals: optionalBundleFile(source.decals, `${label}.decals`),
  };
}

/**
 * Validates the current manifest and explicitly migrates the M35 v1 shape to
 * the v2 base/seasonal shape in memory. The stable discovery URL does not
 * change, so already-installed clients can continue to read old deployments.
 */
export function normalizeAtlasManifest(
  value: unknown,
  registeredBiomes: readonly LandTheme[],
): AtlasManifest {
  const source = object(value, "atlas manifest");
  if (source.version !== 1 && source.version !== 2) {
    throw new Error(`unsupported atlas manifest ${String(source.version)}`);
  }
  const sourceVersion = source.version;
  const core = object(source.core, "atlas manifest.core");
  const sourceBiomes = object(source.biomes, "atlas manifest.biomes");
  const biomes = {} as Record<LandTheme, Record<AtlasQuality, AtlasTierBundle>>;

  for (const biome of registeredBiomes) {
    const sourceTiers = object(sourceBiomes[biome], `atlas manifest.biomes.${biome}`);
    const tiers = {} as Record<AtlasQuality, AtlasTierBundle>;
    for (const quality of ATLAS_QUALITIES) {
      const rawTier = object(sourceTiers[quality], `atlas manifest.biomes.${biome}.${quality}`);
      if (sourceVersion === 1) {
        tiers[quality] = {
          base: baseBundle(rawTier, `atlas manifest.biomes.${biome}.${quality}`),
          seasonal: {},
        };
        continue;
      }
      const rawSeasonal = object(rawTier.seasonal ?? {}, `atlas manifest.biomes.${biome}.${quality}.seasonal`);
      for (const season of Object.keys(rawSeasonal)) {
        if (!SEASONS.includes(season as SeasonName)) {
          throw new Error(`atlas manifest.biomes.${biome}.${quality} has unknown season "${season}"`);
        }
      }
      if (quality === "low" && Object.keys(rawSeasonal).length > 0) {
        throw new Error(`atlas manifest.biomes.${biome}.low must omit seasonal detail overlays`);
      }
      tiers[quality] = {
        base: baseBundle(rawTier.base, `atlas manifest.biomes.${biome}.${quality}.base`),
        seasonal: Object.fromEntries(Object.entries(rawSeasonal).map(([season, overlay]) => [
          season,
          seasonalOverlay(overlay, `atlas manifest.biomes.${biome}.${quality}.seasonal.${season}`),
        ])) as Partial<Record<SeasonName, AtlasSeasonalOverlay>>,
      };
    }
    biomes[biome] = tiers;
  }

  return {
    version: 2,
    sourceVersion,
    generatedBy: typeof source.generatedBy === "string" ? source.generatedBy : undefined,
    core: { golfers: bundleFile(core.golfers, "atlas manifest.core.golfers") },
    biomes,
  };
}

export function selectedOverlay(
  manifest: AtlasManifest,
  biome: LandTheme,
  quality: AtlasQuality,
  season: SeasonName | null | undefined,
): AtlasSeasonalOverlay | null {
  if (!season) return null;
  return manifest.biomes[biome][quality].seasonal[season] ?? null;
}
