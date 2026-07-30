import {
  BIOME_DEFINITIONS,
  BIOME_KEYS,
  CLIMATE_CALENDAR_SEASONS,
  CLIMATE_PHENOLOGY_REGIMES,
  type ClimateCalendarSeason,
  type ClimatePhenologyRegime,
  type LandTheme,
} from "../models/biomes";

export const SEASONAL_COVERAGE_CONTRACT_VERSION = 1 as const;

export const SEASONAL_VISUAL_FAMILIES = [
  "terrain-material-fields",
  "terrain-details-ground-cover",
  "natural-props",
  "buildings",
  "decorations-furniture",
  "construction",
  "condition-wear",
  "weather-dressing",
] as const;
export type SeasonalVisualFamily = (typeof SEASONAL_VISUAL_FAMILIES)[number];

export const SEASONAL_TREATMENT_ROUTES = [
  "same-biome-base",
  "palette-material-transform",
  "decal",
  "selective-sprite-variant",
] as const;
export type SeasonalTreatmentRoute = (typeof SEASONAL_TREATMENT_ROUTES)[number];

export const SEASONAL_CLIMATE_SIGNALS = [
  "foliage",
  "flowering",
  "dormancy",
  "moisture",
  "drought",
  "heat",
  "frost",
  "snow",
  "exposure",
] as const;
export type SeasonalClimateSignal = (typeof SEASONAL_CLIMATE_SIGNALS)[number];

export interface SeasonalCoverageTreatment {
  readonly route: SeasonalTreatmentRoute;
  /**
   * Every absent or rejected seasonal asset resolves to the immutable base
   * owned by the same biome. Cross-biome art substitution is not permitted.
   */
  readonly fallback: {
    readonly route: "same-biome-base";
    readonly biome: LandTheme;
  };
  /** Semantic climate inputs; renderers consume these instead of biome branches. */
  readonly signals: readonly SeasonalClimateSignal[];
  /** Short art-direction intent for authoring tools and future asset tickets. */
  readonly intent: string;
}

export interface SeasonalBiomeCoverage {
  readonly biome: LandTheme;
  readonly phenologyRegime: ClimatePhenologyRegime;
  readonly direction: "four-season" | "exposed-muted" | "drought-heat-led";
  readonly seasons: Record<
    ClimateCalendarSeason,
    Record<SeasonalVisualFamily, SeasonalCoverageTreatment>
  >;
}

export interface SeasonalCoverageContract {
  readonly version: typeof SEASONAL_COVERAGE_CONTRACT_VERSION;
  readonly inheritance: "phenology-regime";
  readonly biomes: Record<LandTheme, SeasonalBiomeCoverage>;
}

type ProfileCell = Omit<SeasonalCoverageTreatment, "fallback">;
type ProfileSeason = Record<SeasonalVisualFamily, ProfileCell>;
type Profile = Record<ClimateCalendarSeason, ProfileSeason>;

const base = (
  intent: string,
  signals: readonly SeasonalClimateSignal[] = [],
): ProfileCell => ({ route: "same-biome-base", signals, intent });
const palette = (
  intent: string,
  signals: readonly SeasonalClimateSignal[],
): ProfileCell => ({ route: "palette-material-transform", signals, intent });
const decal = (
  intent: string,
  signals: readonly SeasonalClimateSignal[],
): ProfileCell => ({ route: "decal", signals, intent });
const sprite = (
  intent: string,
  signals: readonly SeasonalClimateSignal[],
): ProfileCell => ({ route: "selective-sprite-variant", signals, intent });

function seasonProfile(
  values: Partial<Record<SeasonalVisualFamily, ProfileCell>>,
  defaultIntent: string,
): ProfileSeason {
  return Object.fromEntries(SEASONAL_VISUAL_FAMILIES.map((family) => [
    family,
    values[family] ?? base(defaultIntent),
  ])) as ProfileSeason;
}

const temperateFourSeason: Profile = {
  spring: seasonProfile({
    "terrain-material-fields": palette("Fresh, rain-fed turf and cool soils.", ["moisture", "flowering"]),
    "terrain-details-ground-cover": decal("Sparse blossom and fresh ground cover.", ["flowering", "moisture"]),
    "natural-props": sprite("Selective emerging foliage and flowering variants.", ["foliage", "flowering"]),
    buildings: palette("Cool, damp material response without changing architecture.", ["moisture"]),
    "decorations-furniture": decal("Restrained spring planting and damp dressing.", ["flowering", "moisture"]),
    "weather-dressing": decal("Rain and light frost dressing only when climate state permits.", ["moisture", "frost"]),
  }, "Keep the Parkland base treatment where spring enrichment is absent."),
  summer: seasonProfile({
    "terrain-material-fields": palette("Full turf color with restrained dry variation.", ["heat", "moisture"]),
    "terrain-details-ground-cover": decal("Full but controlled ground cover.", ["foliage", "heat"]),
    "natural-props": sprite("Full-canopy variants for selected vegetation.", ["foliage"]),
    "condition-wear": decal("Heat and traffic wear remain localized.", ["heat"]),
    "weather-dressing": decal("Warm haze or storm dressing only when weather requests it.", ["heat", "moisture"]),
  }, "Preserve the Parkland summer base where no selective treatment is authored."),
  autumn: seasonProfile({
    "terrain-material-fields": palette("Cooler, muted turf and leaf-stained soils.", ["dormancy", "foliage"]),
    "terrain-details-ground-cover": decal("Scattered leaf litter without blanket coverage.", ["foliage"]),
    "natural-props": sprite("Selective turning foliage; evergreen species retain base.", ["foliage", "dormancy"]),
    buildings: palette("Subtle cool material shift without geometry replacement.", ["dormancy"]),
    "decorations-furniture": decal("Autumn planting and fallen-leaf accents.", ["foliage"]),
    construction: palette("Seasonal mud and muted construction materials.", ["moisture"]),
    "condition-wear": decal("Localized leaf, traffic, and damp wear.", ["foliage", "moisture"]),
    "weather-dressing": decal("Mist, rain, or first-frost dressing when semantically valid.", ["moisture", "frost"]),
  }, "Use the Parkland base for families without autumn enrichment."),
  winter: seasonProfile({
    "terrain-material-fields": palette("Dormant turf and cold, desaturated soils.", ["dormancy", "frost"]),
    "terrain-details-ground-cover": decal("Sparse frost and dormant ground cover; snow is weather-gated.", ["dormancy", "frost", "snow"]),
    "natural-props": sprite("Selective bare deciduous silhouettes; evergreen species retain base.", ["foliage", "dormancy"]),
    buildings: palette("Cold material response without replacing the building family.", ["frost"]),
    "decorations-furniture": palette("Muted winter furniture and planting materials.", ["dormancy"]),
    construction: palette("Cold, damp construction treatment.", ["moisture", "frost"]),
    "condition-wear": decal("Localized frost and dormant wear, never automatic blanket snow.", ["frost", "snow"]),
    "weather-dressing": decal("Frost or snow dressing only when the climate/weather contract enables it.", ["frost", "snow"]),
  }, "Use the Parkland base where winter variants are unavailable."),
};

const coastalFourSeason: Profile = {
  spring: seasonProfile({
    "terrain-material-fields": palette("Muted coastal greens with wet, wind-exposed variation.", ["moisture", "exposure"]),
    "terrain-details-ground-cover": decal("Sparse coastal flowering and wind-combed cover.", ["flowering", "exposure"]),
    "natural-props": sprite("Selective fresh growth retaining wind-shaped silhouettes.", ["foliage", "exposure"]),
    "condition-wear": decal("Localized wind and salt wear.", ["exposure", "moisture"]),
    "weather-dressing": decal("Sea mist and rain dressing when weather requests it.", ["exposure", "moisture"]),
  }, "Retain the muted Links base instead of borrowing Parkland enrichment."),
  summer: seasonProfile({
    "terrain-material-fields": palette("Sun-bleached, muted links turf without lush saturation.", ["heat", "exposure"]),
    "terrain-details-ground-cover": decal("Dry fescue accents and exposed sand detail.", ["heat", "exposure"]),
    "natural-props": palette("Keep species silhouettes; apply restrained sun and salt response.", ["heat", "exposure"]),
    "condition-wear": decal("Wind and traffic wear remain sparse.", ["heat", "exposure"]),
    "weather-dressing": decal("Salt haze or squalls only when weather requests them.", ["exposure", "moisture"]),
  }, "Use the Links base as the summer fallback."),
  autumn: seasonProfile({
    "terrain-material-fields": palette("Cool ochre-green links materials.", ["dormancy", "exposure"]),
    "terrain-details-ground-cover": decal("Muted heather, fescue, and storm-tossed detail.", ["foliage", "exposure"]),
    "natural-props": palette("Muted vegetation response without temperate forest substitution.", ["foliage", "exposure"]),
    construction: palette("Damp, salt-exposed construction materials.", ["moisture", "exposure"]),
    "condition-wear": decal("Localized storm, salt, and traffic wear.", ["moisture", "exposure"]),
    "weather-dressing": decal("Mist and rain remain event-driven.", ["moisture", "exposure"]),
  }, "Use the Links base where autumn enrichment is absent."),
  winter: seasonProfile({
    "terrain-material-fields": palette("Cold, desaturated exposed turf and sand.", ["dormancy", "frost", "exposure"]),
    "terrain-details-ground-cover": decal("Sparse frost and flattened fescue; snow remains weather-gated.", ["frost", "snow", "exposure"]),
    "natural-props": palette("Muted, wind-exposed vegetation without Parkland bare-tree substitution.", ["dormancy", "exposure"]),
    buildings: palette("Cold salt-weathered material response.", ["frost", "exposure"]),
    "decorations-furniture": palette("Muted coastal winter materials.", ["dormancy", "exposure"]),
    construction: palette("Cold wet construction materials.", ["frost", "moisture"]),
    "condition-wear": decal("Localized frost, salt, and storm wear.", ["frost", "exposure"]),
    "weather-dressing": decal("Frost, mist, or snow only when climate and weather permit.", ["frost", "snow", "exposure"]),
  }, "Use the same-biome Links base as winter fallback."),
};

const aridHeatDrought: Profile = {
  spring: seasonProfile({
    "terrain-material-fields": palette("Brief moisture response while desert soils remain dominant.", ["moisture", "flowering"]),
    "terrain-details-ground-cover": decal("Short-lived bloom and wash detail.", ["flowering", "moisture"]),
    "natural-props": sprite("Selective flowering variants for arid species only.", ["flowering", "foliage"]),
    "weather-dressing": decal("Rain-wash dressing only when weather requests it.", ["moisture"]),
  }, "Retain the Desert base rather than substituting temperate spring art."),
  summer: seasonProfile({
    "terrain-material-fields": palette("Drought- and heat-led materials with protected irrigated turf.", ["drought", "heat"]),
    "terrain-details-ground-cover": decal("Dry wash, dust, and heat detail.", ["drought", "heat"]),
    "natural-props": palette("Heat-stressed arid vegetation without species replacement.", ["drought", "heat"]),
    buildings: palette("Sun-baked material response without structure replacement.", ["heat"]),
    "decorations-furniture": palette("Sun-faded furniture and planting materials.", ["heat", "drought"]),
    construction: palette("Dry dust and sun-exposed construction materials.", ["drought", "heat"]),
    "condition-wear": decal("Localized drought, dust, and irrigation-edge wear.", ["drought", "heat"]),
    "weather-dressing": decal("Heat shimmer or dust only when climate/weather requests it.", ["drought", "heat"]),
  }, "Use the Desert base where heat enrichment is absent."),
  autumn: seasonProfile({
    "terrain-material-fields": palette("Muted dry-season materials without temperate leaf color.", ["drought", "heat"]),
    "terrain-details-ground-cover": decal("Dry seed heads and wash detail.", ["drought"]),
    "natural-props": palette("Subtle arid dormancy response.", ["dormancy", "drought"]),
    "condition-wear": decal("Localized dry wear and dust.", ["drought"]),
    "weather-dressing": decal("Dust or rain-wash dressing only when requested.", ["drought", "moisture"]),
  }, "Retain the Desert base; never import an autumn forest treatment."),
  winter: seasonProfile({
    "terrain-material-fields": palette("Cooler desert materials with no blanket snow assumption.", ["dormancy", "frost"]),
    "terrain-details-ground-cover": decal("Sparse cold-desert detail; frost remains event-gated.", ["dormancy", "frost"]),
    "natural-props": palette("Cool, sparse arid vegetation treatment.", ["dormancy", "frost"]),
    buildings: palette("Cool desert material response.", ["frost"]),
    "decorations-furniture": palette("Cool muted furniture materials.", ["frost"]),
    construction: palette("Cool dry construction treatment.", ["frost"]),
    "condition-wear": decal("Localized frost only when climate state permits it.", ["frost"]),
    "weather-dressing": decal("Cold, wind, or frost dressing; no blanket snow route.", ["frost", "exposure"]),
  }, "Use the Desert base for winter; snow is not a default seasonal layer."),
};

/**
 * Future biome packages inherit one of these semantic profiles. Tropical and
 * alpine profiles intentionally remain base-safe until their asset packages
 * are authored, avoiding hard-coded renderer branches.
 */
const baseSafeProfile = (label: string): Profile => Object.fromEntries(
  CLIMATE_CALENDAR_SEASONS.map((calendarSeason) => [
    calendarSeason,
    seasonProfile({}, `${label} seasonal package is absent; retain the same-biome base.`),
  ]),
) as Profile;

export const SEASONAL_PHENOLOGY_PROFILES = {
  "temperate-four-season": temperateFourSeason,
  "coastal-four-season": coastalFourSeason,
  "arid-heat-drought": aridHeatDrought,
  "tropical-wet-dry": baseSafeProfile("Tropical wet/dry"),
  "alpine-frost-snow": baseSafeProfile("Alpine frost/snow"),
} satisfies Record<ClimatePhenologyRegime, Profile>;

function directionFor(regime: ClimatePhenologyRegime): SeasonalBiomeCoverage["direction"] {
  if (regime === "coastal-four-season") return "exposed-muted";
  if (regime === "arid-heat-drought") return "drought-heat-led";
  return "four-season";
}

function buildBiomeCoverage(biome: LandTheme): SeasonalBiomeCoverage {
  const phenologyRegime = BIOME_DEFINITIONS[biome].seasonalArt.profile;
  const profile = SEASONAL_PHENOLOGY_PROFILES[phenologyRegime];
  return {
    biome,
    phenologyRegime,
    direction: directionFor(phenologyRegime),
    seasons: Object.fromEntries(CLIMATE_CALENDAR_SEASONS.map((calendarSeason) => [
      calendarSeason,
      Object.fromEntries(SEASONAL_VISUAL_FAMILIES.map((family) => [
        family,
        {
          ...profile[calendarSeason][family],
          fallback: { route: "same-biome-base", biome },
        },
      ])),
    ])) as SeasonalBiomeCoverage["seasons"],
  };
}

export const SEASONAL_COVERAGE_CONTRACT: SeasonalCoverageContract = {
  version: SEASONAL_COVERAGE_CONTRACT_VERSION,
  inheritance: "phenology-regime",
  biomes: Object.fromEntries(BIOME_KEYS.map((biome) => [
    biome,
    buildBiomeCoverage(biome),
  ])) as SeasonalCoverageContract["biomes"],
};

export function seasonalCoverageFor(
  biome: LandTheme,
  season: ClimateCalendarSeason,
  family: SeasonalVisualFamily,
): SeasonalCoverageTreatment {
  return SEASONAL_COVERAGE_CONTRACT.biomes[biome].seasons[season][family];
}

function record(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

/** Runtime authoring validation; returns every malformed or missing cell. */
export function auditSeasonalCoverageContract(value: unknown): string[] {
  const errors: string[] = [];
  const contract = record(value);
  if (!contract) return ["seasonal coverage contract must be an object"];
  if (contract.version !== SEASONAL_COVERAGE_CONTRACT_VERSION) {
    errors.push(`seasonal coverage contract version must be ${SEASONAL_COVERAGE_CONTRACT_VERSION}`);
  }
  if (contract.inheritance !== "phenology-regime") {
    errors.push("seasonal coverage contract must inherit by phenology-regime");
  }
  const biomes = record(contract.biomes);
  if (!biomes) return [...errors, "seasonal coverage contract biomes must be an object"];
  for (const unknownBiome of Object.keys(biomes).filter((key) => !BIOME_KEYS.includes(key as LandTheme))) {
    errors.push(`unknown seasonal coverage biome "${unknownBiome}"`);
  }
  for (const biome of BIOME_KEYS) {
    const coverage = record(biomes[biome]);
    if (!coverage) {
      errors.push(`${biome}: seasonal coverage is missing`);
      continue;
    }
    if (coverage.biome !== biome) errors.push(`${biome}: coverage biome identity must match its registry key`);
    const expectedRegime = BIOME_DEFINITIONS[biome].seasonalArt.profile;
    if (
      typeof coverage.phenologyRegime !== "string"
      || !CLIMATE_PHENOLOGY_REGIMES.includes(coverage.phenologyRegime as ClimatePhenologyRegime)
      || coverage.phenologyRegime !== expectedRegime
    ) {
      errors.push(`${biome}: phenology regime must inherit "${expectedRegime}"`);
    }
    const seasons = record(coverage.seasons);
    if (!seasons) {
      errors.push(`${biome}: seasons must be an object`);
      continue;
    }
    for (const unknownSeason of Object.keys(seasons).filter((key) =>
      !CLIMATE_CALENDAR_SEASONS.includes(key as ClimateCalendarSeason))) {
      errors.push(`${biome}: unknown calendar season "${unknownSeason}"`);
    }
    for (const calendarSeason of CLIMATE_CALENDAR_SEASONS) {
      const families = record(seasons[calendarSeason]);
      if (!families) {
        errors.push(`${biome}/${calendarSeason}: seasonal families are missing`);
        continue;
      }
      for (const unknownFamily of Object.keys(families).filter((key) =>
        !SEASONAL_VISUAL_FAMILIES.includes(key as SeasonalVisualFamily))) {
        errors.push(`${biome}/${calendarSeason}: unknown family "${unknownFamily}"`);
      }
      for (const family of SEASONAL_VISUAL_FAMILIES) {
        const treatment = record(families[family]);
        const label = `${biome}/${calendarSeason}/${family}`;
        if (!treatment) {
          errors.push(`${label}: treatment is missing`);
          continue;
        }
        if (!SEASONAL_TREATMENT_ROUTES.includes(treatment.route as SeasonalTreatmentRoute)) {
          errors.push(`${label}: treatment route is invalid`);
        }
        const fallback = record(treatment.fallback);
        if (fallback?.route !== "same-biome-base" || fallback.biome !== biome) {
          errors.push(`${label}: fallback must use the same-biome "${biome}" base`);
        }
        if (typeof treatment.intent !== "string" || treatment.intent.trim().length === 0) {
          errors.push(`${label}: art-direction intent is required`);
        }
        if (
          !Array.isArray(treatment.signals)
          || treatment.signals.some((signal) =>
            !SEASONAL_CLIMATE_SIGNALS.includes(signal as SeasonalClimateSignal))
        ) {
          errors.push(`${label}: climate signals are invalid`);
        }
        if (
          biome === "desert"
          && Array.isArray(treatment.signals)
          && treatment.signals.includes("snow")
        ) {
          errors.push(`${label}: Desert cannot use blanket snow as a seasonal signal`);
        }
      }
    }
  }
  return errors;
}
