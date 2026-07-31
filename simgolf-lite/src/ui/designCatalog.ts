import { TERRAIN_PALETTES, terrainPattern } from "../accessibility/terrainPalettes";
import type { ColorVisionMode } from "../game/onboarding/profile";
import type { ResolvedGraphicsQuality } from "../game/render/graphicsQuality";
import {
  getBiomeDefinition,
  type PlantEcologicalFit,
} from "../game/models/biomes";
import {
  DECORATION_KINDS,
  DECORATION_SPECS,
  decorationCost,
  decorationDailyCareCost,
  decorationPlantWaterDemand,
  decorationRemovalQuote,
  decorationVisual,
  normalizedDecoration,
} from "../game/models/decorations";
import {
  PLANT_REGISTRY,
  dailyPlantCareCost,
  defaultDecorationPlantId,
  defaultObstaclePlantId,
  naturalFeatureInstallationQuote,
  naturalFeatureRemovalQuote,
  plantDefinition,
  plantFitForBiome,
  plantWaterDemand,
} from "../game/models/plantRegistry";
import { PLANT_IDS, type PlantId } from "../game/models/plantTypes";
import {
  terrainConstructionUnitCost,
  terrainMaintenanceWeight,
  terrainSalvageUnitValue,
} from "../game/models/terrainEconomics";
import {
  TERRAIN_KINDS,
  getTerrainMaterial,
  type TerrainAtlasFrame,
} from "../game/render/terrainMaterials";
import { NATURAL_PROP_REGISTRY } from "../game/render/naturalProps";
import {
  seasonalDecorationPlantForm,
  seasonalPlantClimate,
  seasonalPlantPresentation,
  type SeasonalPlantForm,
} from "../game/render/seasonalPlants";
import { seasonalTerrainTreatment } from "../game/render/seasonalTerrainPresentation";
import type { SeasonalVisualState } from "../game/presentation/seasonalVisualState";
import type { DailyWeather, SeasonName } from "../game/seasons/types";
import type {
  Decoration,
  DecorationKind,
  LandTheme,
  ObstacleType,
  Terrain,
} from "../game/models/types";
import type { MessageKey } from "../i18n/catalog";
import type { Translator } from "../i18n/context";
import { translateCurrent } from "../i18n/core";

export const DESIGN_CATEGORIES = ["terrain", "nature", "decor"] as const;
export type DesignCategory = (typeof DESIGN_CATEGORIES)[number];
export type DesignRiskLevel = "low" | "watch" | "high";
export type DesignVisualKind = "terrain" | "prop";

export interface DesignSeasonRisk {
  level: DesignRiskLevel;
  label: string;
}

export interface DesignCatalogItem {
  id: string;
  category: DesignCategory;
  label: string;
  shortLabel: string;
  terrain?: Terrain;
  plantId?: PlantId;
  obstacleType?: ObstacleType;
  decorationKind?: DecorationKind;
  visualKind: DesignVisualKind;
  atlasFrame: string;
  fallbackColor: number;
  fallbackIcon: string;
  fallbackReason?: string;
  previewTint: number;
  previewAlpha: number;
  previewSeasonalVariant: string;
  pattern: ReturnType<typeof terrainPattern>;
  ecologicalFit?: PlantEcologicalFit;
  buildPrice: number;
  salvageValue: number;
  weeklyCare: number;
  weeklyCareUnit: "care weight" | "currency";
  waterDemand: number;
  degradationPath: string;
  seasonalRisk: DesignSeasonRisk;
}

export interface DesignCatalogInput {
  theme?: LandTheme;
  season: SeasonName;
  weatherKind: DailyWeather["kind"];
  costMult?: number;
  colorVision?: ColorVisionMode;
  graphicsQuality?: ResolvedGraphicsQuality;
  reducedMotion?: boolean;
  seasonalVisualState?: SeasonalVisualState;
  decorationSpan?: number;
  t?: Translator;
}

interface ResolvedDesignCatalogInput {
  theme: LandTheme;
  season: SeasonName;
  weatherKind: DailyWeather["kind"];
  costMult: number;
  colorVision: ColorVisionMode;
  graphicsQuality: ResolvedGraphicsQuality;
  reducedMotion: boolean;
  seasonalVisualState?: SeasonalVisualState;
  decorationSpan: number;
  t: Translator;
}

const TERRAIN_LABEL_KEYS: Record<Terrain, MessageKey> = {
  fairway: "designDock.terrain.fairway",
  rough: "designDock.terrain.rough",
  deep_rough: "designDock.terrain.deepRough",
  sand: "designDock.terrain.sand",
  waste_area: "designDock.terrain.wasteArea",
  water: "designDock.terrain.water",
  wetland: "designDock.terrain.wetland",
  green: "designDock.terrain.green",
  tee: "designDock.terrain.tee",
  path: "designDock.terrain.path",
};

const PLANT_LABEL_KEYS: Record<PlantId, MessageKey> = {
  "parkland-oak": "designDock.plant.parklandOak",
  "parkland-wild-shrub": "designDock.plant.parklandWildShrub",
  "parkland-perennial-bed": "designDock.plant.parklandPerennialBed",
  "parkland-annual-planter": "designDock.plant.parklandAnnualPlanter",
  "parkland-specimen-tree": "designDock.plant.parklandSpecimenTree",
  "links-hawthorn": "designDock.plant.linksHawthorn",
  "links-gorse": "designDock.plant.linksGorse",
  "links-heather-bed": "designDock.plant.linksHeatherBed",
  "links-coastal-planter": "designDock.plant.linksCoastalPlanter",
  "links-windbreak": "designDock.plant.linksWindbreak",
  "desert-mesquite": "designDock.plant.desertMesquite",
  "desert-agave": "designDock.plant.desertAgave",
  "desert-xeric-bed": "designDock.plant.desertXericBed",
  "desert-succulent-planter": "designDock.plant.desertSucculentPlanter",
  "desert-sculptural-cactus": "designDock.plant.desertSculpturalCactus",
};

const DECOR_LABEL_KEYS: Record<DecorationKind, MessageKey> = {
  fence: "designDock.decor.fence",
  bench: "designDock.decor.bench",
  tee_sign: "designDock.decor.teeSign",
  lamp: "designDock.decor.lamp",
  bin: "designDock.decor.bin",
  parked_cart: "designDock.decor.parkedCart",
  flower_bed: "designDock.decor.flowerBed",
  planter: "designDock.decor.planter",
  ornamental_feature: "designDock.decor.ornamentalFeature",
  bridge: "designDock.decor.bridge",
  boardwalk: "designDock.decor.boardwalk",
};

const BIOME_LABEL_KEYS: Record<LandTheme, MessageKey> = {
  parkland: "designDock.biome.parkland",
  links: "designDock.biome.links",
  desert: "designDock.biome.desert",
};

const TERRAIN_ICONS: Record<Terrain, string> = {
  fairway: "▥",
  rough: "≋",
  deep_rough: "♒",
  sand: "◒",
  waste_area: "◌",
  water: "≈",
  wetland: "⌇",
  green: "●",
  tee: "◆",
  path: "═",
};

const DECOR_ICONS: Record<DecorationKind, string> = {
  fence: "╫",
  bench: "▰",
  tee_sign: "⚑",
  lamp: "♢",
  bin: "▣",
  parked_cart: "▱",
  flower_bed: "✿",
  planter: "❀",
  ornamental_feature: "♣",
  bridge: "▤",
  boardwalk: "▥",
};

function seasonalRisk(input: {
  theme: LandTheme;
  season: SeasonName;
  weatherKind: DailyWeather["kind"];
  waterDemand: number;
  fit?: PlantEcologicalFit;
  flowering?: boolean;
  maintainedTurf?: boolean;
  t: Translator;
}): DesignSeasonRisk {
  const season = getBiomeDefinition(input.theme).climate.seasons[input.season];
  let score = 0;
  const reasons: string[] = [];
  if (input.fit === "imported") {
    score += 2;
    reasons.push(input.t("designDock.risk.importedFit"));
  } else if (input.fit === "adapted") {
    score += 1;
    reasons.push(input.t("designDock.risk.adaptedFit"));
  }
  if (
    input.waterDemand > 0.9
    && (
      season.moisture === "dry"
      || season.droughtChance >= 0.12
      || input.weatherKind === "heat"
      || input.weatherKind === "drought"
    )
  ) {
    score += 2;
    reasons.push(input.t("designDock.risk.heatDrought"));
  }
  if (
    input.maintainedTurf
    && (
      input.weatherKind === "heavy_rain"
      || input.weatherKind === "storm"
      || season.moisture === "wet"
    )
  ) {
    score += 1;
    reasons.push(input.t("designDock.risk.saturation"));
  }
  if (
    input.flowering
    && (season.flowering <= 0.1 || input.weatherKind === "frost")
  ) {
    score += 1;
    reasons.push(input.t("designDock.risk.bloomWindow"));
  }
  if (score >= 3) return { level: "high", label: reasons.join(" · ") };
  if (score >= 1) return { level: "watch", label: reasons.join(" · ") };
  return { level: "low", label: input.t("designDock.risk.aligned") };
}

function terrainDegradation(terrain: Terrain, t: Translator): string {
  if (terrain === "green" || terrain === "tee" || terrain === "fairway") {
    return t("designDock.degradation.maintainedTurf");
  }
  if (terrain === "rough" || terrain === "deep_rough") {
    return t("designDock.degradation.rough");
  }
  if (terrain === "sand" || terrain === "waste_area") {
    return t("designDock.degradation.sand");
  }
  if (terrain === "water" || terrain === "wetland") {
    return t("designDock.degradation.water");
  }
  return t("designDock.degradation.path");
}

function plantFallbackFrame(
  theme: LandTheme,
  plantId: PlantId,
  t: Translator,
): { frame: string; reason?: string; icon: string; color: number } {
  const definition = plantDefinition(plantId);
  const tint = getBiomeDefinition(theme).presentation.preview.propTints;
  if (definition.semantics.kind === "obstacle") {
    const authored = definition.nativeVisualFrame;
    if (authored?.startsWith(`${theme}_`)) {
      return {
        frame: authored,
        icon: definition.semantics.obstacleType === "tree" ? "♣" : "♧",
        color: tint[definition.semantics.obstacleType],
      };
    }
    const fallbackId = defaultObstaclePlantId(
      theme,
      definition.semantics.obstacleType,
    );
    return {
      frame: plantDefinition(fallbackId).nativeVisualFrame
        ?? NATURAL_PROP_REGISTRY[theme][definition.semantics.obstacleType][0].frame,
      reason: t("designDock.fallback.obstacle", {
        biome: t(BIOME_LABEL_KEYS[theme]),
        type: t(
          definition.semantics.obstacleType === "tree"
            ? "designDock.nature.tree"
            : "designDock.nature.bush",
        ),
        plant: definition.label,
      }),
      icon: definition.semantics.obstacleType === "tree" ? "♣" : "♧",
      color: tint[definition.semantics.obstacleType],
    };
  }
  const example: Decoration = {
    kind: definition.semantics.decorationKind,
    x: 0,
    y: 0,
    rotation: 0,
    plantId,
    origin: "player",
  };
  return {
    frame: decorationVisual(example, theme).frame,
    reason: t("designDock.fallback.planting"),
    icon: DECOR_ICONS[definition.semantics.decorationKind],
    color: tint.bush,
  };
}

function multiplyColor(left: number, right: number): number {
  const channel = (shift: number) =>
    Math.round(((left >>> shift) & 0xff) * ((right >>> shift) & 0xff) / 255);
  return (channel(16) << 16) | (channel(8) << 8) | channel(0);
}

function seasonalPlantForm(
  theme: LandTheme,
  plantId: PlantId,
  frame: string,
): SeasonalPlantForm {
  const definition = plantDefinition(plantId);
  if (definition.semantics.kind === "decoration") {
    return seasonalDecorationPlantForm(
      definition.semantics.decorationKind,
      definition.seasonalProfile,
    );
  }
  const variant = NATURAL_PROP_REGISTRY[theme][
    definition.semantics.obstacleType
  ].find((candidate) => candidate.frame === frame)
    ?? NATURAL_PROP_REGISTRY[theme][definition.semantics.obstacleType][0];
  return variant.plantForm === "non-plant"
    ? definition.semantics.obstacleType === "tree" ? "canopy" : "shrub"
    : variant.plantForm;
}

function terrainItems(input: ResolvedDesignCatalogInput): DesignCatalogItem[] {
  const biome = getBiomeDefinition(input.theme);
  return TERRAIN_KINDS.map((terrain) => {
    const irrigation = biome.economy.terrain[terrain].irrigationDemand;
    const risk = seasonalRisk({
      theme: biome.key,
      season: input.season,
      weatherKind: input.weatherKind,
      waterDemand: irrigation,
      maintainedTurf: ["fairway", "green", "tee"].includes(terrain),
      t: input.t,
    });
    const baseColor = input.colorVision === "standard"
      ? biome.presentation.tileTints[terrain]
        ?? TERRAIN_PALETTES.standard[terrain]
      : TERRAIN_PALETTES[input.colorVision][terrain];
    const treatment = input.seasonalVisualState
      ? seasonalTerrainTreatment({
        state: input.seasonalVisualState,
        terrain,
        quality: input.graphicsQuality,
        colorVision: input.colorVision,
        baseColor,
        reducedMotion: input.reducedMotion,
      })
      : null;
    const label = input.t(TERRAIN_LABEL_KEYS[terrain]);
    return {
      id: `terrain:${terrain}`,
      category: "terrain",
      label,
      shortLabel: label,
      terrain,
      visualKind: "terrain",
      atlasFrame: getTerrainMaterial(biome.key, terrain).baseFrames[0].frame,
      fallbackColor: treatment?.color ?? baseColor,
      fallbackIcon: TERRAIN_ICONS[terrain],
      previewTint: treatment?.textureTint ?? 0xffffff,
      previewAlpha: 1,
      previewSeasonalVariant: treatment?.signature ?? `${input.season}:base`,
      pattern: terrainPattern(terrain),
      buildPrice: terrainConstructionUnitCost(
        terrain,
        biome.key,
        input.costMult,
      ),
      salvageValue: terrainSalvageUnitValue(
        terrain,
        biome.key,
        input.costMult,
      ),
      weeklyCare: terrainMaintenanceWeight(terrain, biome.key),
      weeklyCareUnit: "care weight",
      waterDemand: irrigation,
      degradationPath: terrainDegradation(terrain, input.t),
      seasonalRisk: risk,
    };
  });
}

function plantItems(input: ResolvedDesignCatalogInput): DesignCatalogItem[] {
  const theme = getBiomeDefinition(input.theme).key;
  const items = PLANT_IDS.map((plantId): DesignCatalogItem => {
    const plant = PLANT_REGISTRY[plantId];
    const fit = plantFitForBiome(theme, plantId);
    const visual = plantFallbackFrame(theme, plantId, input.t);
    const waterDemand = plantWaterDemand(theme, plantId);
    const risk = seasonalRisk({
      theme,
      season: input.season,
      weatherKind: input.weatherKind,
      waterDemand,
      fit,
      flowering: plant.seasonalProfile === "flowering",
      t: input.t,
    });
    const presentation = seasonalPlantPresentation({
      identity: plantId,
      profile: plant.seasonalProfile,
      form: seasonalPlantForm(theme, plantId, visual.frame),
      x: 0,
      y: 0,
      cultivated: true,
      elevation: 0,
      nearWater: false,
      ecologicalFit: fit,
      climate: seasonalPlantClimate(input.seasonalVisualState),
    });
    let buildPrice: number;
    let salvageValue: number;
    let obstacleType: ObstacleType | undefined;
    let decorationKind: DecorationKind | undefined;
    if (plant.semantics.kind === "obstacle") {
      obstacleType = plant.semantics.obstacleType;
      buildPrice = naturalFeatureInstallationQuote({
        theme,
        obstacleType,
        plantId,
        costMult: input.costMult,
      }).net;
      salvageValue = naturalFeatureRemovalQuote({
        theme,
        obstacle: { type: obstacleType, plantId, origin: "player" },
        costMult: input.costMult,
      }).salvage;
    } else {
      decorationKind = plant.semantics.decorationKind;
      const decoration: Decoration = {
        kind: decorationKind,
        x: 0,
        y: 0,
        rotation: 0,
        plantId,
        origin: "player",
      };
      buildPrice = decorationCost(decoration, theme, input.costMult);
      salvageValue = decorationRemovalQuote(
        decoration,
        theme,
        input.costMult,
      ).salvage;
    }
    return {
      id: `plant:${plantId}`,
      category: "nature",
      label: input.t(PLANT_LABEL_KEYS[plantId]),
      shortLabel: input.t(PLANT_LABEL_KEYS[plantId]),
      plantId,
      obstacleType,
      decorationKind,
      visualKind: "prop",
      atlasFrame: visual.frame,
      fallbackColor: multiplyColor(visual.color, presentation.tint),
      fallbackIcon: visual.icon,
      fallbackReason: visual.reason,
      previewTint: presentation.tint,
      previewAlpha: presentation.alpha,
      previewSeasonalVariant: presentation.signature,
      pattern: "none",
      ecologicalFit: fit,
      buildPrice,
      salvageValue,
      weeklyCare: dailyPlantCareCost(theme, plantId) * 7 * input.costMult,
      weeklyCareUnit: "currency",
      waterDemand,
      degradationPath: plant.seasonalProfile === "succulent"
        ? input.t("designDock.degradation.succulent")
        : input.t("designDock.degradation.planting"),
      seasonalRisk: risk,
    };
  });
  const rockQuote = naturalFeatureInstallationQuote({
    theme,
    obstacleType: "rock",
    costMult: input.costMult,
  });
  const rockRemoval = naturalFeatureRemovalQuote({
    theme,
    obstacle: { type: "rock", origin: "player" },
    costMult: input.costMult,
  });
  const rock = NATURAL_PROP_REGISTRY[theme].rock[0];
  items.push({
    id: "nature:rock",
    category: "nature",
    label: input.t("designDock.nature.landscapeRock"),
    shortLabel: input.t("designDock.nature.rock"),
    obstacleType: "rock",
    visualKind: "prop",
    atlasFrame: rock.frame,
    fallbackColor: getBiomeDefinition(theme).presentation.preview.propTints.rock,
    fallbackIcon: "◆",
    previewTint: 0xffffff,
    previewAlpha: 1,
    previewSeasonalVariant: `${input.season}:non-plant`,
    pattern: "none",
    buildPrice: rockQuote.net,
    salvageValue: rockRemoval.salvage,
    weeklyCare: 0,
    weeklyCareUnit: "currency",
    waterDemand: 0,
    degradationPath: input.t("designDock.degradation.rock"),
    seasonalRisk: {
      level: "low",
      label: input.t("designDock.risk.weatherStable"),
    },
  });
  return items;
}

function decorItems(input: ResolvedDesignCatalogInput): DesignCatalogItem[] {
  const theme = getBiomeDefinition(input.theme).key;
  return DECORATION_KINDS.map((kind): DesignCatalogItem => {
    const spec = DECORATION_SPECS[kind];
    const plantId = spec.category === "planting"
      ? defaultDecorationPlantId(
        theme,
        kind as "flower_bed" | "planter" | "ornamental_feature",
      )
      : undefined;
    const decoration: Decoration = normalizedDecoration({
      kind,
      x: 0,
      y: 0,
      rotation: 0,
      ...(plantId ? { plantId, origin: "player" as const } : {}),
      ...(spec.defaultSpan ? { span: input.decorationSpan } : {}),
    });
    const fit = plantId ? plantFitForBiome(theme, plantId) : undefined;
    const waterDemand = decorationPlantWaterDemand(decoration, theme);
    const risk = seasonalRisk({
      theme,
      season: input.season,
      weatherKind: input.weatherKind,
      waterDemand,
      fit,
      flowering: kind === "flower_bed" || kind === "planter",
      t: input.t,
    });
    const plantPresentation = plantId
      ? seasonalPlantPresentation({
        identity: plantId,
        profile: plantDefinition(plantId).seasonalProfile,
        form: seasonalDecorationPlantForm(
          kind,
          plantDefinition(plantId).seasonalProfile,
        ),
        x: 0,
        y: 0,
        cultivated: true,
        elevation: 0,
        nearWater: false,
        ecologicalFit: fit,
        climate: seasonalPlantClimate(input.seasonalVisualState),
      })
      : null;
    const baseFallbackColor = getBiomeDefinition(
      theme,
    ).presentation.preview.propTints[
      spec.category === "structure" ? "rock" : "bush"
    ];
    const label = input.t(DECOR_LABEL_KEYS[kind]);
    return {
      id: `decor:${kind}`,
      category: "decor",
      label,
      shortLabel: label,
      plantId,
      decorationKind: kind,
      visualKind: "prop",
      atlasFrame: decorationVisual(decoration, theme).frame,
      fallbackColor: plantPresentation
        ? multiplyColor(baseFallbackColor, plantPresentation.tint)
        : baseFallbackColor,
      fallbackIcon: DECOR_ICONS[kind],
      fallbackReason: plantId
        ? input.t("designDock.fallback.planting")
        : undefined,
      previewTint: plantPresentation?.tint ?? 0xffffff,
      previewAlpha: plantPresentation?.alpha ?? 1,
      previewSeasonalVariant: plantPresentation?.signature
        ?? `${input.season}:non-plant`,
      pattern: "none",
      ecologicalFit: fit,
      buildPrice: decorationCost(decoration, theme, input.costMult),
      salvageValue: decorationRemovalQuote(
        decoration,
        theme,
        input.costMult,
      ).salvage,
      weeklyCare: decorationDailyCareCost(decoration, theme)
        * 7
        * input.costMult,
      weeklyCareUnit: "currency",
      waterDemand,
      degradationPath: spec.category === "planting"
        ? input.t("designDock.degradation.planting")
        : spec.category === "structure"
          ? input.t("designDock.degradation.structure")
          : input.t("designDock.degradation.furniture"),
      seasonalRisk: risk,
    };
  });
}

export function buildDesignCatalog(
  input: DesignCatalogInput,
): Record<DesignCategory, readonly DesignCatalogItem[]> {
  const normalized: ResolvedDesignCatalogInput = {
    theme: getBiomeDefinition(input.theme).key,
    season: input.season,
    weatherKind: input.weatherKind,
    costMult: Number.isFinite(input.costMult) ? Math.max(0, input.costMult ?? 1) : 1,
    colorVision: input.colorVision ?? "standard",
    graphicsQuality: input.graphicsQuality ?? "high",
    reducedMotion: input.reducedMotion ?? false,
    seasonalVisualState: input.seasonalVisualState,
    decorationSpan: Number.isFinite(input.decorationSpan)
      ? Math.max(1, Math.floor(input.decorationSpan ?? 3))
      : 3,
    t: input.t ?? translateCurrent,
  };
  return {
    terrain: terrainItems(normalized),
    nature: plantItems(normalized),
    decor: decorItems(normalized),
  };
}

export function designCatalogCoverage(
  catalog: Record<DesignCategory, readonly DesignCatalogItem[]>,
): {
  terrain: number;
  plants: number;
  decor: number;
  fallbacks: readonly string[];
} {
  return {
    terrain: catalog.terrain.filter((item) => item.terrain).length,
    plants: catalog.nature.filter((item) => item.plantId).length,
    decor: catalog.decor.filter((item) => item.decorationKind).length,
    fallbacks: [...catalog.terrain, ...catalog.nature, ...catalog.decor]
      .filter((item) => item.fallbackReason)
      .map((item) => `${item.id}: ${item.fallbackReason}`),
  };
}

export function isTerrainAtlasFrame(frame: string): frame is TerrainAtlasFrame {
  return /_(?:fairway|rough|deep_rough|sand|waste_area|water|wetland|green|tee|path)_base_[0-5]$/u.test(frame);
}
