import {
  BIOME_KEYS,
  getBiomeDefinition,
  type ClimatePhenologyRegime,
  type LandTheme,
  type PlantEcologicalFit,
} from "./biomes";
import {
  PLANT_IDS,
  type PlantId,
} from "./plantTypes";
import type {
  Decoration,
  DecorationKind,
  Obstacle,
  ObstacleType,
} from "./types";

export type PlantSeasonalProfile =
  | "deciduous"
  | "evergreen"
  | "flowering"
  | "coastal-heath"
  | "coastal-deciduous"
  | "drought-deciduous"
  | "succulent";

export type PlantSemantics =
  | { kind: "obstacle"; obstacleType: Exclude<ObstacleType, "rock"> }
  | {
    kind: "decoration";
    decorationKind: Extract<
      DecorationKind,
      "flower_bed" | "planter" | "ornamental_feature"
    >;
  };

export interface PlantDefinition {
  id: PlantId;
  label: string;
  semantics: PlantSemantics;
  seasonalProfile: PlantSeasonalProfile;
  phenology: ClimatePhenologyRegime;
  ecologicalFit: Record<LandTheme, PlantEcologicalFit>;
  /** Scale on the biome's semantic feature/decor installation base. */
  installationScale: number;
  /** Daily horticultural care before biome fit. */
  dailyCareCost: number;
  /** Irrigation-demand units before biome and ecological-fit modifiers. */
  waterDemand: number;
  /**
   * Optional exact authored frame when its native biome pack is resident.
   * Other biomes retain the semantic id but use the same-biome fallback.
   */
  nativeVisualFrame?: string;
  safeVisualFallback: PlantSemantics;
}

const fits = (
  native: LandTheme,
  adapted: readonly LandTheme[] = [],
): Record<LandTheme, PlantEcologicalFit> => Object.fromEntries(
  BIOME_KEYS.map((biome) => [
    biome,
    biome === native ? "native" : adapted.includes(biome) ? "adapted" : "imported",
  ]),
) as Record<LandTheme, PlantEcologicalFit>;

function obstaclePlant(
  id: PlantId,
  label: string,
  obstacleType: "tree" | "bush",
  native: LandTheme,
  adapted: readonly LandTheme[],
  seasonalProfile: PlantSeasonalProfile,
  phenology: ClimatePhenologyRegime,
  nativeVisualFrame: string,
  dailyCareCost: number,
  waterDemand: number,
  installationScale = 1,
): PlantDefinition {
  const semantics = { kind: "obstacle" as const, obstacleType };
  return {
    id,
    label,
    semantics,
    seasonalProfile,
    phenology,
    ecologicalFit: fits(native, adapted),
    installationScale,
    dailyCareCost,
    waterDemand,
    nativeVisualFrame,
    safeVisualFallback: semantics,
  };
}

function decorationPlant(
  id: PlantId,
  label: string,
  decorationKind: "flower_bed" | "planter" | "ornamental_feature",
  native: LandTheme,
  adapted: readonly LandTheme[],
  seasonalProfile: PlantSeasonalProfile,
  phenology: ClimatePhenologyRegime,
  dailyCareCost: number,
  waterDemand: number,
  installationScale = 1,
): PlantDefinition {
  const semantics = { kind: "decoration" as const, decorationKind };
  return {
    id,
    label,
    semantics,
    seasonalProfile,
    phenology,
    ecologicalFit: fits(native, adapted),
    installationScale,
    dailyCareCost,
    waterDemand,
    safeVisualFallback: semantics,
  };
}

export const PLANT_REGISTRY = {
  "parkland-oak": obstaclePlant(
    "parkland-oak", "Oak", "tree", "parkland", ["links"], "deciduous",
    "temperate-four-season", "parkland_tree_oak", 0.18, 2.4,
  ),
  "parkland-wild-shrub": obstaclePlant(
    "parkland-wild-shrub", "Wild shrub", "bush", "parkland", ["links"],
    "deciduous", "temperate-four-season", "parkland_bush_wild_shrub", 0.08, 1.1,
  ),
  "parkland-perennial-bed": decorationPlant(
    "parkland-perennial-bed", "Perennial bed", "flower_bed", "parkland", ["links"],
    "flowering", "temperate-four-season", 0.22, 2.2,
  ),
  "parkland-annual-planter": decorationPlant(
    "parkland-annual-planter", "Annual planter", "planter", "parkland", ["links"],
    "flowering", "temperate-four-season", 0.2, 1.8, 0.9,
  ),
  "parkland-specimen-tree": decorationPlant(
    "parkland-specimen-tree", "Specimen tree", "ornamental_feature", "parkland",
    ["links"], "deciduous", "temperate-four-season", 0.3, 3.1, 1.15,
  ),
  "links-hawthorn": obstaclePlant(
    "links-hawthorn", "Wind-shaped hawthorn", "tree", "links", ["parkland"],
    "coastal-deciduous", "coastal-four-season", "links_tree_hawthorn", 0.14, 1.5,
  ),
  "links-gorse": obstaclePlant(
    "links-gorse", "Gorse", "bush", "links", ["parkland"], "coastal-heath",
    "coastal-four-season", "links_bush_gorse", 0.06, 0.65,
  ),
  "links-heather-bed": decorationPlant(
    "links-heather-bed", "Heather bed", "flower_bed", "links", ["parkland"],
    "coastal-heath", "coastal-four-season", 0.16, 1.1,
  ),
  "links-coastal-planter": decorationPlant(
    "links-coastal-planter", "Coastal planter", "planter", "links", ["parkland"],
    "coastal-heath", "coastal-four-season", 0.14, 0.9, 0.9,
  ),
  "links-windbreak": decorationPlant(
    "links-windbreak", "Native windbreak", "ornamental_feature", "links",
    ["parkland"], "evergreen", "coastal-four-season", 0.22, 1.7, 1.1,
  ),
  "desert-mesquite": obstaclePlant(
    "desert-mesquite", "Mesquite", "tree", "desert", [], "drought-deciduous",
    "arid-heat-drought", "desert_tree_mesquite", 0.1, 0.65,
  ),
  "desert-agave": obstaclePlant(
    "desert-agave", "Agave", "bush", "desert", [], "succulent",
    "arid-heat-drought", "desert_bush_agave", 0.045, 0.22,
  ),
  "desert-xeric-bed": decorationPlant(
    "desert-xeric-bed", "Xeric flower bed", "flower_bed", "desert", [],
    "succulent", "arid-heat-drought", 0.09, 0.4,
  ),
  "desert-succulent-planter": decorationPlant(
    "desert-succulent-planter", "Succulent planter", "planter", "desert", [],
    "succulent", "arid-heat-drought", 0.08, 0.3, 0.9,
  ),
  "desert-sculptural-cactus": decorationPlant(
    "desert-sculptural-cactus", "Sculptural cactus", "ornamental_feature",
    "desert", [], "succulent", "arid-heat-drought", 0.12, 0.45, 1.05,
  ),
} satisfies Record<PlantId, PlantDefinition>;

type PlantableObstacleType = "tree" | "bush";
type PlantingDecorationKind = "flower_bed" | "planter" | "ornamental_feature";

const DEFAULT_PLANTS: Record<LandTheme, {
  obstacles: Record<PlantableObstacleType, PlantId>;
  decorations: Record<PlantingDecorationKind, PlantId>;
}> = {
  parkland: {
    obstacles: { tree: "parkland-oak", bush: "parkland-wild-shrub" },
    decorations: {
      flower_bed: "parkland-perennial-bed",
      planter: "parkland-annual-planter",
      ornamental_feature: "parkland-specimen-tree",
    },
  },
  links: {
    obstacles: { tree: "links-hawthorn", bush: "links-gorse" },
    decorations: {
      flower_bed: "links-heather-bed",
      planter: "links-coastal-planter",
      ornamental_feature: "links-windbreak",
    },
  },
  desert: {
    obstacles: { tree: "desert-mesquite", bush: "desert-agave" },
    decorations: {
      flower_bed: "desert-xeric-bed",
      planter: "desert-succulent-planter",
      ornamental_feature: "desert-sculptural-cactus",
    },
  },
};

export interface EconomyQuote {
  /** Positive cost, or negative credit. */
  net: number;
  charged: number;
  refunded: number;
  gross: number;
  salvage: number;
}

export function isPlantId(value: unknown): value is PlantId {
  return typeof value === "string" && (PLANT_IDS as readonly string[]).includes(value);
}

export function plantDefinition(id: PlantId): PlantDefinition {
  return PLANT_REGISTRY[id];
}

export function plantFitForBiome(
  theme: LandTheme | undefined,
  id: PlantId,
): PlantEcologicalFit {
  return PLANT_REGISTRY[id].ecologicalFit[getBiomeDefinition(theme).key];
}

export function plantFitMultipliers(theme: LandTheme | undefined, id: PlantId) {
  const biome = getBiomeDefinition(theme);
  return biome.economy.plantFit[plantFitForBiome(biome.key, id)];
}

export function defaultObstaclePlantId(
  theme: LandTheme | undefined,
  obstacleType: PlantableObstacleType,
): PlantId {
  return DEFAULT_PLANTS[getBiomeDefinition(theme).key].obstacles[obstacleType];
}

export function defaultDecorationPlantId(
  theme: LandTheme | undefined,
  kind: PlantingDecorationKind,
): PlantId {
  return DEFAULT_PLANTS[getBiomeDefinition(theme).key].decorations[kind];
}

export function resolvedObstaclePlantId(
  theme: LandTheme | undefined,
  obstacle: Pick<Obstacle, "type" | "plantId">,
): PlantId | undefined {
  if (obstacle.type === "rock") return undefined;
  if (isPlantId(obstacle.plantId)) {
    const semantics = PLANT_REGISTRY[obstacle.plantId].semantics;
    if (semantics.kind === "obstacle" && semantics.obstacleType === obstacle.type) {
      return obstacle.plantId;
    }
  }
  return defaultObstaclePlantId(theme, obstacle.type);
}

export function resolvedDecorationPlantId(
  theme: LandTheme | undefined,
  decoration: Pick<Decoration, "kind" | "plantId">,
): PlantId | undefined {
  if (
    decoration.kind !== "flower_bed"
    && decoration.kind !== "planter"
    && decoration.kind !== "ornamental_feature"
  ) return undefined;
  if (isPlantId(decoration.plantId)) {
    const semantics = PLANT_REGISTRY[decoration.plantId].semantics;
    if (
      semantics.kind === "decoration"
      && semantics.decorationKind === decoration.kind
    ) return decoration.plantId;
  }
  return defaultDecorationPlantId(theme, decoration.kind);
}

export function naturalFeatureInstallationQuote(input: {
  theme?: LandTheme;
  obstacleType: ObstacleType;
  plantId?: PlantId;
  costMult?: number;
}): EconomyQuote {
  const biome = getBiomeDefinition(input.theme);
  const feature = biome.economy.naturalFeatures[input.obstacleType];
  const plantId = input.obstacleType === "rock"
    ? undefined
    : resolvedObstaclePlantId(biome.key, {
      type: input.obstacleType,
      plantId: input.plantId,
    });
  const plantScale = plantId ? PLANT_REGISTRY[plantId].installationScale : 1;
  const fit = plantId
    ? biome.economy.plantFit[plantFitForBiome(biome.key, plantId)].installationMultiplier
    : 1;
  const gross = feature.installationCost * plantScale * fit * (input.costMult ?? 1);
  return { net: gross, charged: gross, refunded: 0, gross, salvage: 0 };
}

export function naturalFeatureRemovalQuote(input: {
  theme?: LandTheme;
  obstacle: Pick<Obstacle, "type" | "plantId" | "origin">;
  costMult?: number;
}): EconomyQuote {
  const biome = getBiomeDefinition(input.theme);
  const feature = biome.economy.naturalFeatures[input.obstacle.type];
  const costMult = input.costMult ?? 1;
  if (input.obstacle.origin === "player") {
    const installed = naturalFeatureInstallationQuote({
      theme: biome.key,
      obstacleType: input.obstacle.type,
      plantId: input.obstacle.plantId,
      costMult,
    }).gross;
    const salvage = Math.min(installed * 0.5, installed * feature.salvageRate);
    return { net: -salvage, charged: 0, refunded: salvage, gross: 0, salvage };
  }
  const gross = feature.clearingCost * costMult;
  return { net: gross, charged: gross, refunded: 0, gross, salvage: 0 };
}

export function dailyPlantCareCost(
  theme: LandTheme | undefined,
  plantId: PlantId,
): number {
  const definition = PLANT_REGISTRY[plantId];
  return definition.dailyCareCost * plantFitMultipliers(theme, plantId).careMultiplier;
}

export function plantWaterDemand(
  theme: LandTheme | undefined,
  plantId: PlantId,
): number {
  const biome = getBiomeDefinition(theme);
  const definition = PLANT_REGISTRY[plantId];
  return definition.waterDemand
    * biome.economy.water.plantDemandMultiplier
    * plantFitMultipliers(biome.key, plantId).waterMultiplier;
}

export function auditPlantRegistry(): string[] {
  const errors: string[] = [];
  const registryKeys = Object.keys(PLANT_REGISTRY);
  if (
    registryKeys.length !== PLANT_IDS.length
    || PLANT_IDS.some((id) => !registryKeys.includes(id))
  ) {
    errors.push("Plant registry must define every stable plant id exactly once.");
  }
  const finite = (id: string, field: string, value: number, min: number) => {
    if (!Number.isFinite(value) || value < min) {
      errors.push(`${id}: ${field} must be finite and at least ${min}`);
    }
  };
  for (const id of PLANT_IDS) {
    const definition = PLANT_REGISTRY[id];
    if (definition.id !== id) errors.push(`${id}: definition id must match registry key`);
    if (!definition.label.trim()) errors.push(`${id}: label is required`);
    finite(id, "installation scale", definition.installationScale, 0.01);
    finite(id, "daily care cost", definition.dailyCareCost, 0);
    finite(id, "water demand", definition.waterDemand, 0);
    const fitKeys = Object.keys(definition.ecologicalFit);
    if (
      fitKeys.length !== BIOME_KEYS.length
      || BIOME_KEYS.some((biome) => !fitKeys.includes(biome))
    ) errors.push(`${id}: ecological fit must cover every registered biome`);
    if (
      definition.safeVisualFallback.kind !== definition.semantics.kind
      || (
        definition.semantics.kind === "obstacle"
        && (
          definition.safeVisualFallback.kind !== "obstacle"
          || definition.safeVisualFallback.obstacleType !== definition.semantics.obstacleType
        )
      )
      || (
        definition.semantics.kind === "decoration"
        && (
          definition.safeVisualFallback.kind !== "decoration"
          || definition.safeVisualFallback.decorationKind !== definition.semantics.decorationKind
        )
      )
    ) errors.push(`${id}: safe visual fallback must preserve gameplay semantics`);
  }
  for (const biome of BIOME_KEYS) {
    for (const obstacleType of ["tree", "bush"] as const) {
      const definition = PLANT_REGISTRY[DEFAULT_PLANTS[biome].obstacles[obstacleType]];
      if (
        definition.semantics.kind !== "obstacle"
        || definition.semantics.obstacleType !== obstacleType
        || definition.ecologicalFit[biome] !== "native"
      ) errors.push(`${biome}: default ${obstacleType} plant must be native and semantic`);
    }
    for (const kind of ["flower_bed", "planter", "ornamental_feature"] as const) {
      const definition = PLANT_REGISTRY[DEFAULT_PLANTS[biome].decorations[kind]];
      if (
        definition.semantics.kind !== "decoration"
        || definition.semantics.decorationKind !== kind
        || definition.ecologicalFit[biome] !== "native"
      ) errors.push(`${biome}: default ${kind} plant must be native and semantic`);
    }
  }
  return errors;
}
