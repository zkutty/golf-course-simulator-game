import { DEFAULT_COURSE, DEFAULT_WORLD } from "../models/defaults";
import {
  maintainedAreaDemandUnits,
  quoteDailyBiomeOperatingCosts,
  weatherIrrigationDemandMultiplier,
} from "../models/biomeOperatingCosts";
import { BIOME_KEYS, getBiomeDefinition, type LandTheme } from "../models/biomes";
import { terrainConstructionUnitCost } from "../models/terrainEconomics";
import type { Course, Terrain } from "../models/types";
import {
  DAYS_PER_YEAR,
  biomeClimatePhenologyForDay,
  calendarDate,
  weatherForDay,
  weatherModifiers,
} from "../seasons/seasons";
import { SEASONS, type WeatherKind } from "../seasons/types";
import { hashCanonicalValue } from "../../utils/stateHash";
import {
  M53_SEASONAL_QUALITIES,
  M53_SEASONAL_TERRAIN_FIXTURES,
  M53_SEVERE_WEATHER_FIXTURES,
} from "./m53SeasonalTerrainFixtures";
import { BIOME_REFERENCE_ROTATIONS } from "./biomeAuthoring";

export const M53_CERTIFICATION_ID = "m53-zk571-v1" as const;
export const M53_CERTIFICATION_SEED = 53_571 as const;
export const M53_CERTIFICATION_YEARS = 8 as const;

/**
 * Existing release contracts, collected here without relaxing or replacing
 * their authoritative source assertions.
 */
export const M53_AUTHORITATIVE_BUDGETS = Object.freeze({
  currentSaveJsonCharacters: 5_000_000,
  releaseSaveBytes: 4_000_000,
  seasonalStateJsonCharacters: 180_000,
  surfaceCareJsonCharacters: 600_000,
  surfaceCareAdvanceMilliseconds: 500,
  hundredGolferSnapshotBytes: 1_000_000,
  rendererWorkMilliseconds: 8,
  coldStartupMilliseconds: 5_000,
  selectedBiomePayloadBytes: 6 * 1024 * 1024,
  initialBundleBytes: 8 * 1024 * 1024,
} as const);

export const M53_HUMAN_VERIFICATION_MATRIX = Object.freeze([
  "Review the retained 12 fixed-camera, High-quality desktop captures (3 biomes × 4 seasons) plus the single narrow responsive sample.",
  "Separately perform an interactive review of all four rotations and Low/Medium/High adaptive-quality transitions; these are not represented as 144 retained screenshots.",
  "Human listening review of design, management, and golf music plus biome ambience, weather overlays, transitions, mute, and fallback behavior.",
  "Keyboard-only, screen-reader, reduced-motion, text-scaling, contrast, and color-independent-marking review.",
  "Real-hardware GPU frame pacing and thermal/load review for each biome and adaptive-quality path.",
  "Golf-authenticity and long-horizon balance playtesting for climate strategy, direct golf, live operations, wear, recovery, and repair.",
  "Signed desktop package, provider-backed distribution, and hosted-release verification if required by release operations.",
] as const);

export interface M53Risk {
  id: string;
  status: "open" | "deferred";
  severity: "medium" | "high";
  evidence: string;
  mitigation: string;
}

export const M53_UNRESOLVED_RISKS: readonly M53Risk[] = Object.freeze([
  {
    id: "ZK571-R1",
    status: "open",
    severity: "medium",
    evidence: "The combined legacy browser audio suite has a known timing-sensitive flake when many audio scenarios share one long run.",
    mitigation: "Keep ZK-570 audio certification isolated and deterministic; do not treat a legacy combined-suite retry as listening evidence.",
  },
  {
    id: "ZK571-R2",
    status: "deferred",
    severity: "high",
    evidence: "Machine pixel/state assertions cannot establish visual quality, legibility, golf authenticity, or absence of subtle compositing artifacts.",
    mitigation: `${M53_HUMAN_VERIFICATION_MATRIX[0]} ${M53_HUMAN_VERIFICATION_MATRIX[1]}`,
  },
  {
    id: "ZK571-R3",
    status: "deferred",
    severity: "high",
    evidence: "Automated audio state and asset checks cannot establish mix quality, clipping perception, fatigue, or transition musicality.",
    mitigation: M53_HUMAN_VERIFICATION_MATRIX[2],
  },
  {
    id: "ZK571-R4",
    status: "deferred",
    severity: "high",
    evidence: "Headless software rendering reports frame spacing but does not assert physical-GPU frame pacing.",
    mitigation: M53_HUMAN_VERIFICATION_MATRIX[4],
  },
  {
    id: "ZK571-R5",
    status: "deferred",
    severity: "medium",
    evidence: "Automated roles, names, state, and focus checks do not replace assistive-technology and human accessibility review.",
    mitigation: M53_HUMAN_VERIFICATION_MATRIX[3],
  },
  {
    id: "ZK571-R6",
    status: "deferred",
    severity: "medium",
    evidence: "Provider signing, storefront distribution, and hosted release state are outside the local repository certification boundary.",
    mitigation: M53_HUMAN_VERIFICATION_MATRIX[6],
  },
  {
    id: "ZK571-R7",
    status: "deferred",
    severity: "high",
    evidence: "ZK-379 and supporting M53 issue/milestone statuses remain pending final human validation and Linear reconciliation.",
    mitigation: "Reconcile the prerequisite and supporting Linear statuses only after final human validation; do not close ZK-571 from machine evidence alone.",
  },
]);

interface StrategySpec {
  id: LandTheme;
  mix: readonly (readonly [Terrain, number])[];
}

const STRATEGIES: readonly StrategySpec[] = [
  {
    id: "parkland",
    mix: [
      ["fairway", 1_600],
      ["green", 300],
      ["tee", 200],
      ["rough", 1_900],
    ],
  },
  {
    id: "links",
    mix: [
      ["fairway", 1_200],
      ["green", 200],
      ["tee", 160],
      ["deep_rough", 2_000],
      ["waste_area", 440],
    ],
  },
  {
    id: "desert",
    mix: [
      ["fairway", 700],
      ["green", 150],
      ["tee", 120],
      ["waste_area", 2_000],
      ["sand", 1_030],
    ],
  },
] as const;

function strategyCourse(theme: LandTheme, strategy: StrategySpec): Course {
  const tiles = strategy.mix.flatMap(([terrain, count]) =>
    new Array<Terrain>(count).fill(terrain));
  return {
    ...DEFAULT_COURSE,
    name: `${theme} ${strategy.id} certification strategy`,
    width: 100,
    height: 40,
    tiles,
    elevations: new Array(tiles.length).fill(0),
    holes: [],
    layouts: [],
    obstacles: [],
    buildings: [],
    decorations: [],
    theme,
    estate: undefined,
    property: undefined,
  };
}

function constructionCost(course: Course): number {
  return course.tiles.reduce((total, terrain) =>
    total + terrainConstructionUnitCost(terrain, course.theme, 1), 0);
}

function weatherEvidence() {
  const days = M53_CERTIFICATION_YEARS * DAYS_PER_YEAR;
  const rows = BIOME_KEYS.map((biome) => {
    const timeline = Array.from({ length: days }, (_, absoluteDay) =>
      weatherForDay(M53_CERTIFICATION_SEED, biome, absoluteDay));
    return {
      biome,
      hash: hashCanonicalValue(timeline),
      seasons: Object.fromEntries(SEASONS.map((season) => [
        season,
        timeline.filter((weather) => weather.season === season).length,
      ])),
      weatherKinds: [...new Set(timeline.map((weather) => weather.kind))].sort(),
      maximumSeverity: Math.max(...timeline.map((weather) => weather.severity)),
    };
  });
  const repeat = BIOME_KEYS.map((biome) =>
    hashCanonicalValue(Array.from({ length: days }, (_, absoluteDay) =>
      weatherForDay(M53_CERTIFICATION_SEED, biome, absoluteDay))));
  const allKinds = [...new Set(rows.flatMap((row) => row.weatherKinds))].sort();
  return {
    years: M53_CERTIFICATION_YEARS,
    daysPerBiome: days,
    rows,
    repeatHashes: repeat,
    allKinds,
  };
}

function economicsEvidence() {
  const clearSummer = {
    absoluteDay: 64,
    kind: "clear" as const,
    temperatureF: 75,
    windMph: 8,
    rainInches: 0,
    severity: 0.08,
    theme: "parkland" as const,
    season: "summer" as const,
  };
  const home = Object.fromEntries(STRATEGIES.map((strategy) => {
    const course = strategyCourse(strategy.id, strategy);
    const quote = quoteDailyBiomeOperatingCosts({
      course,
      season: "summer",
      currentWeather: { ...clearSummer, theme: strategy.id },
      publishedForecast: [{ ...clearSummer, theme: strategy.id }],
      policy: "balanced",
      drainageLevel: 0,
      costMult: 1,
    });
    return [strategy.id, {
      maintainedAreaUnits: maintainedAreaDemandUnits(course),
      maintainedPlayingSurfaceTiles: course.tiles.filter((terrain) =>
        terrain === "fairway" || terrain === "green" || terrain === "tee").length,
      dailyOperatingCost: quote.total,
      weeklyOperatingCost: quote.total * 7,
      constructionCost: constructionCost(course),
      terrainVector: Object.fromEntries(strategy.mix),
    }];
  })) as Record<LandTheme, {
    maintainedAreaUnits: number;
    maintainedPlayingSurfaceTiles: number;
    dailyOperatingCost: number;
    weeklyOperatingCost: number;
    constructionCost: number;
    terrainVector: Record<string, number>;
  }>;

  const crossBiome = Object.fromEntries(BIOME_KEYS.map((hostBiome) => [
    hostBiome,
    Object.fromEntries(STRATEGIES.map((strategy) => {
      const course = strategyCourse(hostBiome, strategy);
      return [strategy.id, {
        dailyOperatingCost: quoteDailyBiomeOperatingCosts({
          course,
          season: "summer",
          currentWeather: { ...clearSummer, theme: hostBiome },
          publishedForecast: [{ ...clearSummer, theme: hostBiome }],
          policy: "balanced",
          drainageLevel: 0,
          costMult: 1,
        }).total,
        constructionCost: constructionCost(course),
      }];
    })),
  ])) as Record<LandTheme, Record<LandTheme, {
    dailyOperatingCost: number;
    constructionCost: number;
  }>>;

  return { home, crossBiome };
}

export interface M53CertificationCheck {
  id: string;
  passed: boolean;
  detail: string;
  sources: readonly string[];
  observed: unknown;
  contract: unknown;
}

export interface M53CertificationReport {
  version: 1;
  certificationId: typeof M53_CERTIFICATION_ID;
  checks: M53CertificationCheck[];
  evidence: {
    fixtureStates: number;
    biomes: number;
    seasons: number;
    rotations: number;
    qualities: number;
    weather: ReturnType<typeof weatherEvidence>;
    economics: ReturnType<typeof economicsEvidence>;
    climateProfiles: Record<LandTheme, string>;
    severeWeatherHash: string;
    strategyHash: string;
  };
  budgets: typeof M53_AUTHORITATIVE_BUDGETS;
  unresolvedRisks: readonly M53Risk[];
  humanVerificationMatrix: readonly string[];
  determinismHash: string;
  passed: boolean;
}

const check = (id: string, passed: boolean, detail: string): M53CertificationCheck =>
  ({ id, passed, detail, sources: [], observed: null, contract: null });

export function runM53Certification(): M53CertificationReport {
  const weather = weatherEvidence();
  const economics = economicsEvidence();
  const severeRows = BIOME_KEYS.flatMap((biome) =>
    SEASONS.map((season) => {
      const fixture = M53_SEVERE_WEATHER_FIXTURES[biome][season];
      const projected = weatherForDay(fixture.seed, biome, fixture.absoluteDay);
      return {
        biome,
        season,
        expected: fixture.weather,
        actual: projected.kind,
        modifiers: weatherModifiers(projected),
      };
    }));
  const climateProfiles = Object.fromEntries(BIOME_KEYS.map((biome) => [
    biome,
    getBiomeDefinition(biome).climate.phenology.regime,
  ])) as Record<LandTheme, string>;
  const seasonalRegistrySignatures = Object.fromEntries(BIOME_KEYS.map((biome) => [
    biome,
    Object.fromEntries(SEASONS.map((season, seasonIndex) => [
      season,
      hashCanonicalValue(biomeClimatePhenologyForDay(
        biome,
        seasonIndex * (DAYS_PER_YEAR / 4) + DAYS_PER_YEAR / 8,
      )),
    ])),
  ])) as Record<LandTheme, Record<(typeof SEASONS)[number], string>>;
  const climateBoundaryRows = BIOME_KEYS.flatMap((biome) =>
    Array.from({ length: M53_CERTIFICATION_YEARS * 4 }, (_, boundary) => {
      const absoluteDay = boundary * (DAYS_PER_YEAR / 4);
      return [-1, 0, 1].map((offset) =>
        biomeClimatePhenologyForDay(biome, absoluteDay + offset));
    }).flat());
  const expectedWeatherKinds: WeatherKind[] = [
    "clear",
    "cloudy",
    "rain",
    "heavy_rain",
    "storm",
    "heat",
    "drought",
    "frost",
  ];
  const strategyVectors = Object.values(economics.home).map((row) =>
    hashCanonicalValue(row.terrainVector));
  const homeOperating = Object.fromEntries(BIOME_KEYS.map((biome) => [
    biome,
    economics.home[biome].dailyOperatingCost,
  ]));
  const homePlayingCapacity = Object.fromEntries(BIOME_KEYS.map((biome) => [
    biome,
    economics.home[biome].maintainedPlayingSurfaceTiles,
  ]));
  const operatingWinner = BIOME_KEYS.reduce((best, biome) =>
    homeOperating[biome] < homeOperating[best] ? biome : best);
  const playingCapacityWinner = BIOME_KEYS.reduce((best, biome) =>
    homePlayingCapacity[biome] > homePlayingCapacity[best] ? biome : best);

  const baseChecks = [
    check(
      "canonical-144-state-matrix",
      M53_SEASONAL_TERRAIN_FIXTURES.length
        === BIOME_KEYS.length * SEASONS.length
          * BIOME_REFERENCE_ROTATIONS.length * M53_SEASONAL_QUALITIES.length,
      "The canonical matrix contains every biome × season × rotation × adaptive-quality state.",
    ),
    check(
      "authoritative-severe-weather-fixtures",
      severeRows.every((row) => row.expected === row.actual),
      "Every severe-weather fixture is reproduced by authoritative weather projection; no renderer-only override is accepted.",
    ),
    check(
      "deterministic-eight-year-climate",
      weather.rows.every((row, index) => row.hash === weather.repeatHashes[index]),
      "Each biome reproduces the same eight-year daily weather hash from the fixed certification seed.",
    ),
    check(
      "all-weather-kinds",
      expectedWeatherKinds.every((kind) => weather.allKinds.includes(kind)),
      `The cross-biome climate timeline exercises all ${expectedWeatherKinds.length} authoritative weather kinds.`,
    ),
    check(
      "seasonal-calendar-coverage",
      weather.rows.every((row) =>
        SEASONS.every((season) =>
          row.seasons[season] === M53_CERTIFICATION_YEARS * DAYS_PER_YEAR / 4)),
      "Every biome contains the same complete, deterministic four-season calendar without skipped or duplicated days.",
    ),
    check(
      "bounded-climate-transitions",
      climateBoundaryRows.every((state) =>
        state.transition.blend >= 0
        && state.transition.blend <= 1
        && Number.isFinite(state.climate.targetTemperatureF)
        && Number.isFinite(state.climate.precipitationChance))
        && BIOME_KEYS.every((biome) =>
          new Set(Object.values(seasonalRegistrySignatures[biome])).size
            === SEASONS.length),
      "All multi-year season-boundary projections stay finite/bounded, and fixed-camera seasonal differentiation comes from four distinct registry states per biome.",
    ),
    check(
      "distinct-climate-strategies",
      new Set(Object.values(climateProfiles)).size === BIOME_KEYS.length
        && new Set(strategyVectors).size === BIOME_KEYS.length,
      "Parkland, Links, and Desert have distinct registry climate regimes and distinct climate-appropriate terrain strategies.",
    ),
    check(
      "shared-maintenance-viability",
      BIOME_KEYS.every((biome) =>
        economics.home[biome].weeklyOperatingCost < DEFAULT_WORLD.maintenanceBudget),
      "All three climate-appropriate strategies fit the authoritative default weekly maintenance envelope.",
    ),
    check(
      "desert-xeric-parity",
      economics.home.desert.dailyOperatingCost
        < economics.home.parkland.dailyOperatingCost * 1.25,
      "The xeric Desert strategy remains below the existing authoritative 1.25× Parkland operating-cost contract.",
    ),
    check(
      "no-single-biome-economic-dominance",
      operatingWinner !== playingCapacityWinner,
      "No home strategy is simultaneously cheapest to operate and largest in maintained playing-surface capacity, preserving a cost/capacity tradeoff without a universal winner.",
    ),
    check(
      "weather-demand-bounds",
      severeRows.every((row) => {
        const fixture = M53_SEVERE_WEATHER_FIXTURES[row.biome][row.season];
        const sample = weatherForDay(fixture.seed, row.biome, fixture.absoluteDay);
        const multiplier = weatherIrrigationDemandMultiplier(sample, [sample]);
        return multiplier >= 0.75 && multiplier <= 1.25;
      }),
      "Every severe climate sample stays within the authoritative 0.75–1.25 irrigation-demand range.",
    ),
    check(
      "risk-register-is-explicit",
      M53_UNRESOLVED_RISKS.length > 0
        && M53_UNRESOLVED_RISKS.every((risk) =>
          risk.status === "open" || risk.status === "deferred"),
      "Unresolved human, GPU, audio, accessibility, provider, and legacy timing risks remain open or deferred rather than inferred passing.",
    ),
  ];
  const checkEvidence: Record<string, Pick<
    M53CertificationCheck,
    "sources" | "observed" | "contract"
  >> = {
    "canonical-144-state-matrix": {
      sources: [
        "src/game/testing/m53SeasonalTerrainFixtures.ts",
        "src/game/testing/m53SeasonalTerrainFixtures.test.ts",
      ],
      observed: {
        states: M53_SEASONAL_TERRAIN_FIXTURES.length,
        biomes: BIOME_KEYS.length,
        seasons: SEASONS.length,
        rotations: BIOME_REFERENCE_ROTATIONS.length,
        qualities: M53_SEASONAL_QUALITIES.length,
      },
      contract: { states: 144, biomes: 3, seasons: 4, rotations: 4, qualities: 3 },
    },
    "authoritative-severe-weather-fixtures": {
      sources: [
        "src/game/testing/m53SeasonalTerrainFixtures.ts#M53_SEVERE_WEATHER_FIXTURES",
        "src/game/seasons/seasons.ts#weatherForDay",
      ],
      observed: {
        matches: severeRows.filter((row) => row.expected === row.actual).length,
        cases: severeRows.length,
        hash: hashCanonicalValue(severeRows),
      },
      contract: { matches: 12, cases: 12 },
    },
    "deterministic-eight-year-climate": {
      sources: ["src/game/seasons/seasons.ts#weatherForDay"],
      observed: {
        years: weather.years,
        daysPerBiome: weather.daysPerBiome,
        hashes: weather.rows.map((row) => row.hash),
        repeatHashes: weather.repeatHashes,
      },
      contract: { years: 8, daysPerBiome: 1_792, repeatHashesEqual: true },
    },
    "all-weather-kinds": {
      sources: ["src/game/seasons/types.ts#WeatherKind", "src/game/seasons/seasons.ts#weatherForDay"],
      observed: weather.allKinds,
      contract: expectedWeatherKinds,
    },
    "seasonal-calendar-coverage": {
      sources: ["src/game/seasons/seasons.ts#calendarDate"],
      observed: Object.fromEntries(weather.rows.map((row) => [row.biome, row.seasons])),
      contract: { daysPerSeasonPerBiome: 448 },
    },
    "bounded-climate-transitions": {
      sources: [
        "src/game/seasons/seasons.ts#biomeClimatePhenologyForDay",
        "src/game/models/biomes.ts#climate",
      ],
      observed: {
        boundarySamples: climateBoundaryRows.length,
        seasonalRegistrySignatures,
      },
      contract: {
        blendMinimum: 0,
        blendMaximum: 1,
        distinctSeasonalRegistryStatesPerBiome: 4,
      },
    },
    "distinct-climate-strategies": {
      sources: [
        "src/game/models/biomes.ts#BIOMES",
        "src/game/models/biomeEconomics.test.ts#climate-appropriate-starter-landscapes",
      ],
      observed: { climateProfiles, strategyVectors },
      contract: { distinctClimateProfiles: 3, distinctTerrainVectors: 3 },
    },
    "shared-maintenance-viability": {
      sources: [
        "src/game/models/biomeEconomics.test.ts#climate-appropriate-starter-landscapes",
        "src/game/models/defaults.ts#DEFAULT_WORLD.maintenanceBudget",
      ],
      observed: Object.fromEntries(BIOME_KEYS.map((biome) => [
        biome,
        economics.home[biome].weeklyOperatingCost,
      ])),
      contract: { eachLessThanWeeklyMaintenanceBudget: DEFAULT_WORLD.maintenanceBudget },
    },
    "desert-xeric-parity": {
      sources: ["src/game/models/biomeEconomics.test.ts#climate-appropriate-starter-landscapes"],
      observed: {
        desertDaily: economics.home.desert.dailyOperatingCost,
        parklandDaily: economics.home.parkland.dailyOperatingCost,
        ratio: economics.home.desert.dailyOperatingCost
          / economics.home.parkland.dailyOperatingCost,
      },
      contract: { ratioLessThan: 1.25 },
    },
    "no-single-biome-economic-dominance": {
      sources: [
        "src/game/models/biomeOperatingCosts.ts#quoteDailyBiomeOperatingCosts",
        "src/game/models/terrainEconomics.ts#terrainConstructionUnitCost",
      ],
      observed: {
        operatingWinner,
        playingCapacityWinner,
        homeOperating,
        homePlayingCapacity,
      },
      contract: { operatingWinnerMustDifferFromPlayingCapacityWinner: true },
    },
    "weather-demand-bounds": {
      sources: [
        "src/game/models/biomeOperatingCosts.ts#weatherIrrigationDemandMultiplier",
        "src/game/models/biomeEconomics.test.ts#weather-demand",
      ],
      observed: severeRows.map((row) => {
        const fixture = M53_SEVERE_WEATHER_FIXTURES[row.biome][row.season];
        const sample = weatherForDay(fixture.seed, row.biome, fixture.absoluteDay);
        return {
          biome: row.biome,
          season: row.season,
          multiplier: weatherIrrigationDemandMultiplier(sample, [sample]),
        };
      }),
      contract: { minimum: 0.75, maximum: 1.25 },
    },
    "risk-register-is-explicit": {
      sources: ["src/game/testing/m53Certification.ts#M53_UNRESOLVED_RISKS"],
      observed: M53_UNRESOLVED_RISKS.map((risk) => ({
        id: risk.id,
        status: risk.status,
        severity: risk.severity,
      })),
      contract: { unresolvedRisks: 7, allowedStatuses: ["open", "deferred"] },
    },
  };
  const checks = baseChecks.map((candidate) => ({
    ...candidate,
    ...checkEvidence[candidate.id],
  }));

  const deterministicEvidence = {
    fixtureIds: M53_SEASONAL_TERRAIN_FIXTURES.map((fixture) => fixture.id),
    weather,
    economics,
    climateProfiles,
    seasonalRegistrySignatures,
    severeRows,
    calendarProbe: Array.from({ length: M53_CERTIFICATION_YEARS * 4 }, (_, index) =>
      calendarDate(index * DAYS_PER_YEAR / 4)),
  };
  const unhashedReport = {
    version: 1 as const,
    certificationId: M53_CERTIFICATION_ID,
    checks,
    evidence: {
      fixtureStates: M53_SEASONAL_TERRAIN_FIXTURES.length,
      biomes: BIOME_KEYS.length,
      seasons: SEASONS.length,
      rotations: BIOME_REFERENCE_ROTATIONS.length,
      qualities: M53_SEASONAL_QUALITIES.length,
      weather,
      economics,
      climateProfiles,
      severeWeatherHash: hashCanonicalValue(severeRows),
      strategyHash: hashCanonicalValue(economics),
    },
    budgets: M53_AUTHORITATIVE_BUDGETS,
    unresolvedRisks: M53_UNRESOLVED_RISKS,
    humanVerificationMatrix: M53_HUMAN_VERIFICATION_MATRIX,
    passed: checks.every((candidate) => candidate.passed),
  };
  return {
    ...unhashedReport,
    determinismHash: hashCanonicalValue({
      ...unhashedReport,
      deterministicEvidence,
    }),
  };
}
