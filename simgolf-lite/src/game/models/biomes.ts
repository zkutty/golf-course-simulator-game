import type { Terrain } from "./types";

/**
 * The four-season club calendar is stable save/gameplay state. Biomes map
 * their own phenology onto it instead of introducing presentation seasons.
 */
export const CLIMATE_CALENDAR_SEASONS = ["spring", "summer", "autumn", "winter"] as const;
export type ClimateCalendarSeason = (typeof CLIMATE_CALENDAR_SEASONS)[number];

export type ClimateFoliagePhase =
  | "dormant"
  | "emerging"
  | "full"
  | "turning"
  | "sparse";
export type ClimateMoistureRegime = "dry" | "balanced" | "wet";

/**
 * A biome's presentation/vegetation rhythm. The last two entries deliberately
 * describe future content contracts; they do not make tropical or alpine
 * playable biome keys before their authored packages exist.
 */
export type ClimatePhenologyRegime =
  | "temperate-four-season"
  | "coastal-four-season"
  | "arid-heat-drought"
  | "tropical-wet-dry"
  | "alpine-frost-snow";

export type ClimateExposure = "sheltered" | "moderate" | "exposed";

export const CLIMATE_PHENOLOGY_REGIMES: readonly ClimatePhenologyRegime[] = [
  "temperate-four-season",
  "coastal-four-season",
  "arid-heat-drought",
  "tropical-wet-dry",
  "alpine-frost-snow",
];
const CLIMATE_EXPOSURES: readonly ClimateExposure[] = ["sheltered", "moderate", "exposed"];

export interface ClimatePhenologyProfile {
  regime: ClimatePhenologyRegime;
  exposure: ClimateExposure;
}

export interface ClimateSeasonProfile {
  temperatureOffsetF: number;
  precipitationChanceOffset: number;
  windMphOffset: number;
  stormChance: number;
  droughtChance: number;
  dormancy: number;
  foliage: ClimateFoliagePhase;
  flowering: number;
  moisture: ClimateMoistureRegime;
  frost: {
    enabled: boolean;
    maximumTemperatureF: number;
    precipitationChanceMultiplier: number;
  };
  snow: {
    enabled: boolean;
    maximumTemperatureF: number;
    chance: number;
  };
}

export interface ClimateProfile {
  temperatureBaseF: number;
  precipitationBaseChance: number;
  windBaseMph: number;
  stormChanceModifier: number;
  heatThresholdF: number;
  /**
   * Semantic contract for render/audio/vegetation consumers. It is separate
   * from the club's fixed four-season calendar and supports future wet/dry
   * tropical and frost/snow alpine content without adding their biome keys.
   */
  phenology: ClimatePhenologyProfile;
  seasons: Record<ClimateCalendarSeason, ClimateSeasonProfile>;
}

export interface ThemeGenConfig {
  deepRough: { clustersMin: number; clustersMax: number; sizeMin: number; sizeMax: number };
  water: {
    bodiesMin: number;
    bodiesMax: number;
    fracMin: number;
    fracMax: number;
    /** Links: convert a noisy band along one map edge to coastal water. */
    coastalEdge: boolean;
  };
  sand: { pocketsMin: number; pocketsMax: number; sizeMin: number; sizeMax: number };
  environmental: { wetlandEdgeChance: number; wasteAreaEdgeChance: number };
  obstacles: {
    density: number;
    treeRatio: number;
    bushRatio: number;
    rockRatio: number;
    clustersMin: number;
    clustersMax: number;
    lineBias: number;
    shoreBushChance: number;
    shoreTreeChance: number;
  };
  /** elevation = clamp(0, maxStep, round(noise * amplitude + offset)) */
  elevation: { amplitude: number; offset: number; maxStep: number };
}

export interface BiomeDefinition<Key extends string = string> {
  key: Key;
  label: string;
  blurb: string;
  generation: ThemeGenConfig;
  climate: ClimateProfile;
  seasonalArt: {
    /**
     * Seasonal art inherits a declarative phenology profile. This keeps
     * renderers free of biome-specific branches and lets future biomes reuse
     * a climate rhythm without borrowing another biome's assets.
     */
    profile: ClimatePhenologyRegime;
    contractVersion: 1;
  };
  presentation: {
    /** Flat-color overrides of the renderer COLORS table (Pixi hex numbers). */
    tileTints: Partial<Record<Terrain, number>>;
    /** Theme-authored exposed soil/rock faces for the two visible iso sides. */
    cliffFaces: { sw: number; se: number };
    preview: {
      icon: string;
      propTints: Record<"tree" | "bush" | "rock", number>;
    };
  };
  content: {
    materials: {
      terrain: Key;
      details: Key;
      fields: Key;
    };
    props: {
      natural: Key;
    };
    structures: {
      buildings: Key;
      decorations: Key;
    };
    audio: {
      designMusic: `build-${Key}`;
      ambience: Key;
    };
  };
  compatibility: {
    /** Stable value serialized on Course.theme. */
    saveKey: Key;
    /** Historical/import aliases accepted by a future package migration. */
    legacyAliases: readonly string[];
    /** Safe visual/gameplay fallback when optional content is unavailable. */
    fallbackBiome: string;
    contentVersion: number;
  };
}

function defineBiomes<const Definitions extends Record<string, BiomeDefinition<string>>>(
  definitions: Definitions & {
    readonly [Key in keyof Definitions]: BiomeDefinition<Key & string>;
  },
): Definitions {
  return definitions;
}

const season = (
  values: Omit<ClimateSeasonProfile, "frost" | "snow">,
): ClimateSeasonProfile => ({
  ...values,
  frost: {
    enabled: true,
    maximumTemperatureF: 34,
    precipitationChanceMultiplier: 0.7,
  },
  // Existing CourseCraft weather has no snow WeatherKind. The explicit zero
  // keeps current behavior while reserving a typed contract for later content.
  snow: {
    enabled: false,
    maximumTemperatureF: 32,
    chance: 0,
  },
});

/**
 * The authoritative biome registry. Adding a key here derives LandTheme and
 * BIOME_KEYS; every required generation, climate, presentation, ownership,
 * audio, preview, and compatibility field is checked at this declaration.
 */
export const BIOME_DEFINITIONS = defineBiomes({
  // Parkland is the identity theme: generation values are exactly the
  // pre-theme constants, preserving bit-identical output for the same seed.
  parkland: {
    key: "parkland",
    label: "Parkland",
    blurb: "Classic tree-lined golf: gentle hills, ponds, and generous turf.",
    generation: {
      deepRough: { clustersMin: 4, clustersMax: 10, sizeMin: 8, sizeMax: 20 },
      water: { bodiesMin: 1, bodiesMax: 2, fracMin: 0.03, fracMax: 0.08, coastalEdge: false },
      sand: { pocketsMin: 3, pocketsMax: 8, sizeMin: 2, sizeMax: 6 },
      environmental: { wetlandEdgeChance: 0.2, wasteAreaEdgeChance: 0.12 },
      obstacles: { density: 0.03, treeRatio: 0.55, bushRatio: 0.35, rockRatio: 0.1, clustersMin: 10, clustersMax: 18, lineBias: 0.28, shoreBushChance: 0.34, shoreTreeChance: 0.08 },
      elevation: { amplitude: 4.6, offset: -0.3, maxStep: 4 },
    },
    climate: {
      temperatureBaseF: 59,
      precipitationBaseChance: 0.26,
      windBaseMph: 6,
      stormChanceModifier: 0.008,
      heatThresholdF: 91,
      phenology: { regime: "temperate-four-season", exposure: "moderate" },
      seasons: {
        spring: season({ temperatureOffsetF: 3, precipitationChanceOffset: 0.08, windMphOffset: 0, stormChance: 0.018, droughtChance: 0, dormancy: 0.15, foliage: "emerging", flowering: 0.85, moisture: "wet" }),
        summer: season({ temperatureOffsetF: 17, precipitationChanceOffset: -0.04, windMphOffset: 0, stormChance: 0.025, droughtChance: 0.07, dormancy: 0, foliage: "full", flowering: 0.45, moisture: "balanced" }),
        autumn: season({ temperatureOffsetF: 5, precipitationChanceOffset: 0, windMphOffset: 0, stormChance: 0.035, droughtChance: 0, dormancy: 0.25, foliage: "turning", flowering: 0.1, moisture: "balanced" }),
        winter: season({ temperatureOffsetF: -12, precipitationChanceOffset: 0, windMphOffset: 3, stormChance: 0.018, droughtChance: 0, dormancy: 0.85, foliage: "dormant", flowering: 0, moisture: "balanced" }),
      },
    },
    seasonalArt: { profile: "temperate-four-season", contractVersion: 1 },
    presentation: {
      tileTints: {},
      cliffFaces: { sw: 0x6b4f33, se: 0x8a6844 },
      preview: {
        icon: "🌳",
        propTints: { tree: 0x214e2c, bush: 0x477d35, rock: 0x66685f },
      },
    },
    content: {
      materials: { terrain: "parkland", details: "parkland", fields: "parkland" },
      props: { natural: "parkland" },
      structures: { buildings: "parkland", decorations: "parkland" },
      audio: { designMusic: "build-parkland", ambience: "parkland" },
    },
    compatibility: {
      saveKey: "parkland",
      legacyAliases: [],
      fallbackBiome: "parkland",
      contentVersion: 1,
    },
  },
  links: {
    key: "links",
    label: "Links",
    blurb: "Windswept coastal dunes, deep rough, and barely a tree in sight.",
    generation: {
      deepRough: { clustersMin: 8, clustersMax: 14, sizeMin: 12, sizeMax: 28 },
      water: { bodiesMin: 0, bodiesMax: 0, fracMin: 0, fracMax: 0, coastalEdge: true },
      sand: { pocketsMin: 7, pocketsMax: 12, sizeMin: 3, sizeMax: 8 },
      environmental: { wetlandEdgeChance: 0.12, wasteAreaEdgeChance: 0.18 },
      obstacles: { density: 0.022, treeRatio: 0.12, bushRatio: 0.53, rockRatio: 0.35, clustersMin: 4, clustersMax: 8, lineBias: 0.42, shoreBushChance: 0.16, shoreTreeChance: 0.01 },
      elevation: { amplitude: 3.4, offset: -0.4, maxStep: 3 },
    },
    climate: {
      temperatureBaseF: 55,
      precipitationBaseChance: 0.32,
      windBaseMph: 12,
      stormChanceModifier: 0.025,
      heatThresholdF: 91,
      phenology: { regime: "coastal-four-season", exposure: "exposed" },
      seasons: {
        spring: season({ temperatureOffsetF: 3, precipitationChanceOffset: 0.08, windMphOffset: 0, stormChance: 0.018, droughtChance: 0, dormancy: 0.2, foliage: "emerging", flowering: 0.55, moisture: "wet" }),
        summer: season({ temperatureOffsetF: 17, precipitationChanceOffset: -0.04, windMphOffset: 0, stormChance: 0.025, droughtChance: 0, dormancy: 0.05, foliage: "full", flowering: 0.35, moisture: "balanced" }),
        autumn: season({ temperatureOffsetF: 5, precipitationChanceOffset: 0, windMphOffset: 0, stormChance: 0.035, droughtChance: 0, dormancy: 0.3, foliage: "turning", flowering: 0.15, moisture: "wet" }),
        winter: season({ temperatureOffsetF: -12, precipitationChanceOffset: 0, windMphOffset: 3, stormChance: 0.018, droughtChance: 0, dormancy: 0.65, foliage: "sparse", flowering: 0, moisture: "wet" }),
      },
    },
    seasonalArt: { profile: "coastal-four-season", contractVersion: 1 },
    presentation: {
      tileTints: {
        fairway: 0x6aa84f,
        rough: 0x5d8a3c,
        deep_rough: 0x6e7a30,
        sand: 0xe3d6a4,
        waste_area: 0xa58d5e,
        water: 0x2b6f9e,
        wetland: 0x4e7a69,
        green: 0x66bb6a,
      },
      cliffFaces: { sw: 0x59605a, se: 0x7a786a },
      preview: {
        icon: "🌾",
        propTints: { tree: 0x294f34, bush: 0x9a8b38, rock: 0x59646a },
      },
    },
    content: {
      materials: { terrain: "links", details: "links", fields: "links" },
      props: { natural: "links" },
      structures: { buildings: "links", decorations: "links" },
      audio: { designMusic: "build-links", ambience: "links" },
    },
    compatibility: {
      saveKey: "links",
      legacyAliases: [],
      fallbackBiome: "links",
      contentVersion: 1,
    },
  },
  desert: {
    key: "desert",
    label: "Desert",
    blurb: "Sand washes and rocky mesas — water is scarce and precious.",
    generation: {
      deepRough: { clustersMin: 2, clustersMax: 4, sizeMin: 4, sizeMax: 9 },
      water: { bodiesMin: 1, bodiesMax: 1, fracMin: 0.004, fracMax: 0.015, coastalEdge: false },
      sand: { pocketsMin: 10, pocketsMax: 16, sizeMin: 6, sizeMax: 16 },
      environmental: { wetlandEdgeChance: 0.05, wasteAreaEdgeChance: 0.35 },
      obstacles: { density: 0.035, treeRatio: 0.08, bushRatio: 0.32, rockRatio: 0.6, clustersMin: 6, clustersMax: 11, lineBias: 0.12, shoreBushChance: 0.18, shoreTreeChance: 0.22 },
      elevation: { amplitude: 6, offset: -0.9, maxStep: 4 },
    },
    climate: {
      temperatureBaseF: 72,
      precipitationBaseChance: 0.09,
      windBaseMph: 8,
      stormChanceModifier: -0.006,
      heatThresholdF: 100,
      phenology: { regime: "arid-heat-drought", exposure: "sheltered" },
      seasons: {
        spring: season({ temperatureOffsetF: 3, precipitationChanceOffset: 0.08, windMphOffset: 0, stormChance: 0.018, droughtChance: 0, dormancy: 0.05, foliage: "full", flowering: 0.7, moisture: "balanced" }),
        summer: season({ temperatureOffsetF: 17, precipitationChanceOffset: -0.04, windMphOffset: 0, stormChance: 0.025, droughtChance: 0.22, dormancy: 0.35, foliage: "sparse", flowering: 0.1, moisture: "dry" }),
        autumn: season({ temperatureOffsetF: 5, precipitationChanceOffset: 0, windMphOffset: 0, stormChance: 0.035, droughtChance: 0, dormancy: 0.1, foliage: "full", flowering: 0.25, moisture: "dry" }),
        winter: season({ temperatureOffsetF: -12, precipitationChanceOffset: 0, windMphOffset: 3, stormChance: 0.018, droughtChance: 0, dormancy: 0.2, foliage: "sparse", flowering: 0.05, moisture: "dry" }),
      },
    },
    seasonalArt: { profile: "arid-heat-drought", contractVersion: 1 },
    presentation: {
      tileTints: {
        fairway: 0x55a24c,
        rough: 0x8a8a4c,
        deep_rough: 0x70703a,
        sand: 0xdcb97c,
        waste_area: 0xb18a55,
        water: 0x3a9ec2,
        wetland: 0x5b8b68,
        path: 0xa89778,
        tee: 0x9a7a58,
      },
      cliffFaces: { sw: 0x7a4934, se: 0xa2603f },
      preview: {
        icon: "🌵",
        propTints: { tree: 0x315e32, bush: 0x6f7436, rock: 0x714633 },
      },
    },
    content: {
      materials: { terrain: "desert", details: "desert", fields: "desert" },
      props: { natural: "desert" },
      structures: { buildings: "desert", decorations: "desert" },
      audio: { designMusic: "build-desert", ambience: "desert" },
    },
    compatibility: {
      saveKey: "desert",
      legacyAliases: [],
      fallbackBiome: "desert",
      contentVersion: 1,
    },
  },
});

export type LandTheme = keyof typeof BIOME_DEFINITIONS;

/** Runtime enumeration derived from the authoritative registry keys. */
export const BIOME_KEYS = Object.freeze(
  Object.keys(BIOME_DEFINITIONS) as LandTheme[],
);

/**
 * Portable compatibility evidence stored with saves, round snapshots, and
 * authored packages. The key remains the gameplay identity; the remaining
 * fields prove that the importing build understands the same authored
 * content and climate semantics.
 */
export const BIOME_COMPATIBILITY_VERSION = 1 as const;

export interface BiomeCompatibilityMetadata {
  version: typeof BIOME_COMPATIBILITY_VERSION;
  biome: LandTheme;
  contentVersion: number;
  climate: {
    phenologyRegime: ClimatePhenologyRegime;
    exposure: ClimateExposure;
  };
}

export type BiomeCompatibilityValidation =
  | { ok: true; metadata: BiomeCompatibilityMetadata; migrated: boolean }
  | { ok: false; kind: "corrupt" | "unsupported"; error: string };

/**
 * Historical files sometimes used a display label rather than the stable
 * lowercase save key. Resolve those spellings without allowing an unknown
 * identifier to collapse silently to Parkland.
 */
export function normalizeBiomeKey(value: unknown): LandTheme | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  for (const key of BIOME_KEYS) {
    const definition = BIOME_DEFINITIONS[key];
    if (
      normalized === key.toLowerCase()
      || normalized === definition.compatibility.saveKey.toLowerCase()
      || normalized === definition.label.trim().toLowerCase()
      || (definition.compatibility.legacyAliases as readonly string[])
        .some((alias) => alias.trim().toLowerCase() === normalized)
    ) {
      return key;
    }
  }
  return null;
}

export function biomeCompatibilityMetadataFor(theme: LandTheme): BiomeCompatibilityMetadata {
  const definition = BIOME_DEFINITIONS[theme];
  return {
    version: BIOME_COMPATIBILITY_VERSION,
    biome: theme,
    contentVersion: definition.compatibility.contentVersion,
    climate: {
      phenologyRegime: definition.climate.phenology.regime,
      exposure: definition.climate.phenology.exposure,
    },
  };
}

export function validateBiomeCompatibilityMetadata(
  value: unknown,
  expectedTheme?: LandTheme,
): BiomeCompatibilityValidation {
  if (value == null) {
    if (!expectedTheme) {
      return { ok: false, kind: "corrupt", error: "Biome compatibility metadata has no biome identity." };
    }
    return {
      ok: true,
      metadata: biomeCompatibilityMetadataFor(expectedTheme),
      migrated: true,
    };
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, kind: "corrupt", error: "Biome compatibility metadata must be an object." };
  }
  const candidate = value as Partial<BiomeCompatibilityMetadata>;
  const unsupportedField = Object.keys(candidate)
    .find((field) => !["version", "biome", "contentVersion", "climate"].includes(field));
  if (unsupportedField) {
    return {
      ok: false,
      kind: "corrupt",
      error: `Biome compatibility metadata contains unsupported field "${unsupportedField}".`,
    };
  }
  if (!Number.isInteger(candidate.version) || (candidate.version as number) < 1) {
    return { ok: false, kind: "corrupt", error: "Biome compatibility version is invalid." };
  }
  if ((candidate.version as number) > BIOME_COMPATIBILITY_VERSION) {
    return {
      ok: false,
      kind: "unsupported",
      error: `Biome compatibility version ${candidate.version} is newer than this build supports.`,
    };
  }
  const biome = normalizeBiomeKey(candidate.biome);
  if (!biome) {
    return { ok: false, kind: "unsupported", error: `Biome "${String(candidate.biome)}" is not supported by this build.` };
  }
  if (expectedTheme && biome !== expectedTheme) {
    return {
      ok: false,
      kind: "corrupt",
      error: `Biome metadata "${biome}" does not match course biome "${expectedTheme}".`,
    };
  }
  if (!Number.isInteger(candidate.contentVersion) || (candidate.contentVersion as number) < 1) {
    return { ok: false, kind: "corrupt", error: "Biome content version is invalid." };
  }
  const supported = biomeCompatibilityMetadataFor(biome);
  if ((candidate.contentVersion as number) > supported.contentVersion) {
    return {
      ok: false,
      kind: "unsupported",
      error: `Biome "${biome}" content version ${candidate.contentVersion} is newer than supported version ${supported.contentVersion}.`,
    };
  }
  if (!candidate.climate || typeof candidate.climate !== "object") {
    return { ok: false, kind: "corrupt", error: "Biome climate metadata is missing or invalid." };
  }
  const unsupportedClimateField = Object.keys(candidate.climate)
    .find((field) => !["phenologyRegime", "exposure"].includes(field));
  if (unsupportedClimateField) {
    return {
      ok: false,
      kind: "corrupt",
      error: `Biome climate metadata contains unsupported field "${unsupportedClimateField}".`,
    };
  }
  if (
    candidate.climate.phenologyRegime !== supported.climate.phenologyRegime
    || candidate.climate.exposure !== supported.climate.exposure
  ) {
    return {
      ok: false,
      kind: "unsupported",
      error: `Biome "${biome}" climate metadata is not supported by this build.`,
    };
  }
  return {
    ok: true,
    metadata: supported,
    migrated: candidate.biome !== biome
      || candidate.contentVersion !== supported.contentVersion,
  };
}

export interface SemanticClimateState {
  biome: LandTheme;
  calendarSeason: ClimateCalendarSeason;
  phenology: ClimatePhenologyProfile;
  temperature: {
    baseF: number;
    seasonalOffsetF: number;
    heatThresholdF: number;
  };
  precipitation: {
    chance: number;
    moisture: ClimateMoistureRegime;
  };
  windBaseMph: number;
  stormChance: number;
  droughtChance: number;
  dormancy: number;
  foliage: ClimateFoliagePhase;
  flowering: number;
  frost: ClimateSeasonProfile["frost"];
  snow: ClimateSeasonProfile["snow"];
}

export function getBiomeDefinition(theme: LandTheme | undefined): BiomeDefinition<LandTheme> {
  return BIOME_DEFINITIONS[theme ?? "parkland"];
}

/** Semantic gameplay state resolved independently of material or prop assets. */
export function climateStateFor(
  theme: LandTheme,
  calendarSeason: ClimateCalendarSeason,
): SemanticClimateState {
  const climate = BIOME_DEFINITIONS[theme].climate;
  const seasonal = climate.seasons[calendarSeason];
  return {
    biome: theme,
    calendarSeason,
    phenology: climate.phenology,
    temperature: {
      baseF: climate.temperatureBaseF,
      seasonalOffsetF: seasonal.temperatureOffsetF,
      heatThresholdF: climate.heatThresholdF,
    },
    precipitation: {
      chance: Math.max(0.04, Math.min(0.42, climate.precipitationBaseChance + seasonal.precipitationChanceOffset)),
      moisture: seasonal.moisture,
    },
    windBaseMph: climate.windBaseMph + seasonal.windMphOffset,
    stormChance: seasonal.stormChance + climate.stormChanceModifier,
    droughtChance: seasonal.droughtChance,
    dormancy: seasonal.dormancy,
    foliage: seasonal.foliage,
    flowering: seasonal.flowering,
    frost: seasonal.frost,
    snow: seasonal.snow,
  };
}

export function isLandTheme(value: unknown): value is LandTheme {
  return typeof value === "string"
    && Object.prototype.hasOwnProperty.call(BIOME_DEFINITIONS, value);
}

/** Runtime content audit complements the declaration's compile-time checks. */
export function auditBiomeDefinitions(
  definitions: Readonly<Record<string, BiomeDefinition<string>>> = BIOME_DEFINITIONS,
): string[] {
  const errors: string[] = [];
  const definitionKeys = Object.keys(definitions);
  const keys = new Set<string>(definitionKeys);
  const saveKeys = new Set<string>();
  const compatibilityClaims = new Map<string, string>();
  const finite = (key: string, field: string, value: number, min: number, max: number) => {
    if (!Number.isFinite(value) || value < min || value > max) {
      errors.push(`${key}: ${field} must be finite and between ${min} and ${max}`);
    }
  };
  const integer = (key: string, field: string, value: number, min = 0) => {
    if (!Number.isInteger(value) || value < min) {
      errors.push(`${key}: ${field} must be an integer at least ${min}`);
    }
  };
  const color = (key: string, field: string, value: number) => {
    if (!Number.isInteger(value) || value < 0 || value > 0xffffff) {
      errors.push(`${key}: ${field} must be a 24-bit color`);
    }
  };
  const compatibilityClaim = (key: string, field: string, value: string) => {
    const normalized = value.trim().toLowerCase();
    if (!normalized) {
      errors.push(`${key}: ${field} must not be empty`);
      return;
    }
    const owner = compatibilityClaims.get(normalized);
    if (owner) errors.push(`${key}: ${field} collides with ${owner}`);
    else compatibilityClaims.set(normalized, `${key} ${field}`);
  };

  for (const key of definitionKeys) {
    compatibilityClaim(key, "registry key", key);
  }

  for (const key of definitionKeys) {
    const definition = definitions[key];
    if (definition.key !== key) errors.push(`${key}: definition key must match registry key`);
    if (!definition.label.trim() || !definition.blurb.trim()) errors.push(`${key}: display copy is required`);
    if (!keys.has(definition.compatibility.fallbackBiome)) errors.push(`${key}: fallback biome is not registered`);
    if (definition.compatibility.fallbackBiome !== key) {
      errors.push(`${key}: fallback biome must retain same-biome ownership`);
    }
    if (definition.compatibility.saveKey !== key) errors.push(`${key}: save key must match registry key`);
    if (saveKeys.has(definition.compatibility.saveKey)) errors.push(`${key}: duplicate save key`);
    saveKeys.add(definition.compatibility.saveKey);
    if (!Number.isInteger(definition.compatibility.contentVersion)
      || definition.compatibility.contentVersion < 1) {
      errors.push(`${key}: content version must be an integer at least 1`);
    }
    for (const alias of definition.compatibility.legacyAliases) {
      compatibilityClaim(key, "legacy alias", alias);
    }

    const owners = [
      ...Object.values(definition.content.materials),
      definition.content.props.natural,
      definition.content.structures.buildings,
      definition.content.structures.decorations,
      definition.content.audio.ambience,
    ];
    if (owners.some((owner) => !keys.has(owner))) errors.push(`${key}: content owner is not registered`);
    if (definition.content.audio.designMusic !== `build-${key}`) errors.push(`${key}: design music context is inconsistent`);

    const generation = definition.generation;
    for (const [field, value] of [
      ["deep rough clusters minimum", generation.deepRough.clustersMin],
      ["deep rough clusters maximum", generation.deepRough.clustersMax],
      ["deep rough size minimum", generation.deepRough.sizeMin],
      ["deep rough size maximum", generation.deepRough.sizeMax],
      ["water bodies minimum", generation.water.bodiesMin],
      ["water bodies maximum", generation.water.bodiesMax],
      ["sand pockets minimum", generation.sand.pocketsMin],
      ["sand pockets maximum", generation.sand.pocketsMax],
      ["sand size minimum", generation.sand.sizeMin],
      ["sand size maximum", generation.sand.sizeMax],
      ["obstacle clusters minimum", generation.obstacles.clustersMin],
      ["obstacle clusters maximum", generation.obstacles.clustersMax],
    ] as const) integer(key, field, value);
    for (const [field, min, max] of [
      ["deep rough clusters", generation.deepRough.clustersMin, generation.deepRough.clustersMax],
      ["deep rough size", generation.deepRough.sizeMin, generation.deepRough.sizeMax],
      ["water bodies", generation.water.bodiesMin, generation.water.bodiesMax],
      ["sand pockets", generation.sand.pocketsMin, generation.sand.pocketsMax],
      ["sand size", generation.sand.sizeMin, generation.sand.sizeMax],
      ["obstacle clusters", generation.obstacles.clustersMin, generation.obstacles.clustersMax],
    ] as const) {
      if (min > max) errors.push(`${key}: ${field} minimum must not exceed maximum`);
    }
    for (const [field, value] of [
      ["water fraction minimum", generation.water.fracMin],
      ["water fraction maximum", generation.water.fracMax],
      ["wetland edge chance", generation.environmental.wetlandEdgeChance],
      ["waste-area edge chance", generation.environmental.wasteAreaEdgeChance],
      ["obstacle density", generation.obstacles.density],
      ["tree ratio", generation.obstacles.treeRatio],
      ["bush ratio", generation.obstacles.bushRatio],
      ["rock ratio", generation.obstacles.rockRatio],
      ["obstacle line bias", generation.obstacles.lineBias],
      ["shore bush chance", generation.obstacles.shoreBushChance],
      ["shore tree chance", generation.obstacles.shoreTreeChance],
    ] as const) finite(key, field, value, 0, 1);
    const obstacleRatio = generation.obstacles.treeRatio
      + generation.obstacles.bushRatio
      + generation.obstacles.rockRatio;
    if (Math.abs(obstacleRatio - 1) > 0.000001) {
      errors.push(`${key}: obstacle ratios must sum to 1`);
    }
    if (generation.water.fracMin > generation.water.fracMax) {
      errors.push(`${key}: water fraction minimum must not exceed maximum`);
    }
    finite(key, "elevation amplitude", generation.elevation.amplitude, 0, 100);
    finite(key, "elevation offset", generation.elevation.offset, -100, 100);
    integer(key, "elevation maximum step", generation.elevation.maxStep);

    const climate = definition.climate;
    if (definition.seasonalArt.contractVersion !== 1) {
      errors.push(`${key}: seasonal art contract version must be 1`);
    }
    if (definition.seasonalArt.profile !== climate.phenology.regime) {
      errors.push(`${key}: seasonal art profile must match the climate phenology regime`);
    }
    finite(key, "base temperature", climate.temperatureBaseF, -100, 160);
    finite(key, "base precipitation chance", climate.precipitationBaseChance, 0, 1);
    finite(key, "base wind", climate.windBaseMph, 0, 100);
    finite(key, "storm chance modifier", climate.stormChanceModifier, -1, 1);
    finite(key, "heat threshold", climate.heatThresholdF, -100, 200);
    if (!CLIMATE_PHENOLOGY_REGIMES.includes(climate.phenology.regime)) {
      errors.push(`${key}: climate phenology regime is not supported`);
    }
    if (!CLIMATE_EXPOSURES.includes(climate.phenology.exposure)) {
      errors.push(`${key}: climate exposure is not supported`);
    }

    if (!definition.presentation.preview.icon.trim()) errors.push(`${key}: preview icon is required`);
    for (const prop of ["tree", "bush", "rock"] as const) {
      color(key, `preview ${prop} color`, definition.presentation.preview.propTints[prop]);
    }
    for (const [terrain, value] of Object.entries(definition.presentation.tileTints)) {
      color(key, `tile ${terrain} color`, value);
    }
    color(key, "southwest cliff color", definition.presentation.cliffFaces.sw);
    color(key, "southeast cliff color", definition.presentation.cliffFaces.se);

    const seasonKeys = Object.keys(definition.climate.seasons);
    if (seasonKeys.length !== CLIMATE_CALENDAR_SEASONS.length
      || CLIMATE_CALENDAR_SEASONS.some((name) => !seasonKeys.includes(name))) {
      errors.push(`${key}: climate must cover every calendar season`);
    }
    for (const name of CLIMATE_CALENDAR_SEASONS) {
      const seasonal = climate.seasons[name];
      finite(`${key}/${name}`, "temperature offset", seasonal.temperatureOffsetF, -150, 150);
      finite(`${key}/${name}`, "precipitation chance offset", seasonal.precipitationChanceOffset, -1, 1);
      finite(`${key}/${name}`, "resolved precipitation chance", climate.precipitationBaseChance + seasonal.precipitationChanceOffset, 0, 1);
      finite(`${key}/${name}`, "wind offset", seasonal.windMphOffset, -100, 100);
      finite(`${key}/${name}`, "storm chance", seasonal.stormChance, 0, 1);
      finite(`${key}/${name}`, "resolved storm chance", seasonal.stormChance + climate.stormChanceModifier, 0, 1);
      finite(`${key}/${name}`, "drought chance", seasonal.droughtChance, 0, 1);
      finite(`${key}/${name}`, "frost maximum temperature", seasonal.frost.maximumTemperatureF, -100, 160);
      finite(`${key}/${name}`, "frost precipitation multiplier", seasonal.frost.precipitationChanceMultiplier, 0, 1);
      finite(`${key}/${name}`, "snow maximum temperature", seasonal.snow.maximumTemperatureF, -100, 160);
      for (const [field, value] of [
        ["dormancy", seasonal.dormancy],
        ["flowering", seasonal.flowering],
        ["snow chance", seasonal.snow.chance],
      ] as const) {
        if (!Number.isFinite(value) || value < 0 || value > 1) {
          errors.push(`${key}/${name}: ${field} must be between zero and one`);
        }
      }
    }
  }
  return errors;
}
